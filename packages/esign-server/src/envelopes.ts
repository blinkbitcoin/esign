// The envelope service: the domain rules around a provider and a store -
// authorization and ownership, input bounds, atomic persistence with an
// audit trail, the restart rule, and the webhook state machine. Framework
// neutral: a GraphQL or HTTP layer maps its inputs onto these calls.

import { randomUUID } from 'node:crypto';
import {
  type AuditAction,
  type AuditEntry,
  type AuditMetadata,
  sanitizeAuditMetadata,
} from './audit';
import { Errors, getErrorCode } from './errors';
import { consoleLogger, type Logger, sanitizeForLog } from './log';
import type { ESignProvider } from './provider';
import type { EnvelopeStore } from './store';
import { noopTracing, type Tracing } from './tracing';
import type {
  CreateEnvelopeInput,
  EnvelopeResult,
  GetSigningUrlInput,
  SigningUrlResult,
  WebhookEvent,
} from './types';
import {
  requireId,
  validateContractType,
  validateRecipient,
} from './validation';

export interface EnvelopeServiceDeps {
  provider: ESignProvider;
  store: EnvelopeStore;
  tracing?: Tracing;
  logger?: Logger;
  // Id generator (UUIDs by default; injectable for deterministic tests)
  newId?: () => string;
}

// What a client may see of an envelope - never the provider's id
export interface EnvelopeView {
  id: string;
  status: string;
  contractType: string;
  createdAt: Date;
}

// How a webhook event was handled (also recorded on the span)
export type WebhookOutcome =
  | 'ignored_unknown_status'
  | 'unknown_envelope'
  | 'unchanged'
  | 'rejected_terminal'
  | 'updated';

export interface EnvelopeService {
  // Create an envelope at the provider and persist it; returns the INTERNAL id
  createEnvelope(
    userId: string | null,
    input: CreateEnvelopeInput,
  ): Promise<EnvelopeResult>;
  // A fresh signing URL for an envelope still being signed (session restart)
  getSigningUrl(
    userId: string | null,
    input: GetSigningUrlInput,
  ): Promise<SigningUrlResult>;
  getEnvelope(userId: string | null, id: string): Promise<EnvelopeView>;
  // Newest first
  getAuditLogs(
    userId: string | null,
    envelopeId: string,
  ): Promise<AuditEntry[]>;
  // Sync a verified, parsed provider event into the stored status
  handleWebhookEvent(event: WebhookEvent): Promise<WebhookOutcome>;
}

// Terminal statuses: no transition out of them (blocks a replayed older
// signed webhook from downgrading a finished envelope)
const TERMINAL_STATUSES = new Set<string>(['completed', 'voided', 'declined']);

export const createEnvelopeService = (
  deps: EnvelopeServiceDeps,
): EnvelopeService => {
  const { provider, store } = deps;
  const tracing = deps.tracing ?? noopTracing;
  const logger = deps.logger ?? consoleLogger;
  const newId = deps.newId ?? randomUUID;

  const requireUser = (userId: string | null): string => {
    if (!userId) {
      throw Errors.unauthorized();
    }
    return userId;
  };

  const requireOwned = async (envelopeId: string, userId: string) => {
    const envelope = await store.getEnvelopeByIdForUser(envelopeId, userId);
    if (!envelope) {
      throw Errors.envelopeNotFound();
    }
    return envelope;
  };

  const audit = (
    target: EnvelopeStore,
    envelopeId: string,
    action: AuditAction,
    metadata?: AuditMetadata,
  ) =>
    target.appendAuditEntry({
      id: newId(),
      envelopeId,
      action,
      metadata: sanitizeAuditMetadata(metadata),
    });

  return {
    async createEnvelope(userId, input) {
      const owner = requireUser(userId);
      const contractType = validateContractType(input.contractType);
      const recipient = validateRecipient(input.recipient);

      let providerResult: EnvelopeResult;
      try {
        providerResult = await provider.createEnvelope(
          owner,
          contractType,
          recipient,
        );
      } catch (providerError) {
        // Logged as an object (util.inspect quotes fields), no PII
        logger.error('Envelope creation failed:', {
          action: 'creation_failed',
          errorCode: getErrorCode(providerError),
          contractType,
          userId: owner,
          timestamp: new Date().toISOString(),
        });
        throw providerError;
      }

      // Envelope + audit entry commit together or not at all
      try {
        const created = await store.transaction(async tx => {
          const record = await tx.createEnvelope({
            id: newId(),
            providerEnvelopeId: providerResult.envelopeId,
            userId: owner,
            contractType,
            status: 'sent',
          });
          await audit(tx, record.id, 'initiated', {
            contractType,
            userId: owner,
          });
          return record;
        });
        return {
          envelopeId: created.id,
          signingUrl: providerResult.signingUrl,
        };
      } catch (error) {
        logger.error(
          'Failed to persist envelope:',
          error instanceof Error ? error.message : error,
        );
        throw Errors.persistenceFailed();
      }
    },

    async getSigningUrl(userId, input) {
      const owner = requireUser(userId);
      const envelopeId = requireId(input.envelopeId, 'envelopeId');
      const recipient = validateRecipient(input.recipient);
      const envelope = await requireOwned(envelopeId, owner);

      // Only an envelope still being signed can restart
      if (envelope.status !== 'sent') {
        throw Errors.validationError(
          'Cannot restart signing for completed or voided envelope',
        );
      }

      const result = await provider.getSigningUrl(
        envelope.providerEnvelopeId,
        recipient,
      );
      await audit(store, envelope.id, 'session_restart', { userId: owner });
      return { signingUrl: result.signingUrl };
    },

    async getEnvelope(userId, id) {
      const owner = requireUser(userId);
      const envelope = await requireOwned(requireId(id, 'id'), owner);
      return {
        id: envelope.id,
        status: envelope.status,
        contractType: envelope.contractType,
        createdAt: envelope.createdAt,
      };
    },

    async getAuditLogs(userId, envelopeId) {
      const owner = requireUser(userId);
      const envelope = await requireOwned(
        requireId(envelopeId, 'envelopeId'),
        owner,
      );
      return store.listAuditEntries(envelope.id);
    },

    // Idempotent: a repeated event with the same status changes nothing, so
    // provider retries (after a 500) are safe
    handleWebhookEvent(event) {
      return tracing.withSpan(
        'esign.webhook.process',
        {
          'esign.provider_envelope_id': event.providerEnvelopeId,
          'esign.webhook.raw_status': event.rawStatus,
        },
        async span => {
          const finish = (outcome: WebhookOutcome): WebhookOutcome => {
            span.setAttribute('esign.webhook.outcome', outcome);
            return outcome;
          };

          if (!event.status) {
            logger.warn(
              `Webhook received with unknown status: ${sanitizeForLog(event.rawStatus)} for envelope ${sanitizeForLog(event.providerEnvelopeId)}`,
            );
            return finish('ignored_unknown_status');
          }
          const newStatus = event.status;
          span.setAttribute('esign.webhook.status', newStatus);

          const envelope = await store.getEnvelopeByProviderEnvelopeId(
            event.providerEnvelopeId,
          );
          if (!envelope) {
            // May be from another environment or already deleted: acknowledged
            logger.warn(
              `Webhook received for unknown envelope: ${sanitizeForLog(event.providerEnvelopeId)}`,
            );
            return finish('unknown_envelope');
          }
          span.setAttribute('esign.envelope_id', envelope.id);

          if (envelope.status === newStatus) {
            logger.log(
              `Idempotent: envelope ${envelope.id} already has status ${newStatus}`,
            );
            return finish('unchanged');
          }

          if (TERMINAL_STATUSES.has(envelope.status)) {
            logger.warn(
              `Webhook ignored: envelope ${envelope.id} is in terminal status ${envelope.status}, refusing transition to ${newStatus}`,
            );
            return finish('rejected_terminal');
          }

          // Past the guards the only transitions are sent -> completed |
          // voided | declined, each a valid audit action
          await store.transaction(async tx => {
            await tx.updateEnvelopeStatus(envelope.id, newStatus);
            await audit(tx, envelope.id, newStatus as AuditAction, {
              source: 'webhook',
            });
          });
          logger.log(
            `Webhook processed: envelope ${envelope.id} status updated to ${newStatus}`,
          );
          return finish('updated');
        },
      );
    },
  };
};
