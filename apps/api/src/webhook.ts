// Generic webhook processing: HMAC validation policy and envelope status
// synchronization. Provider-specific details (signature header names, secret
// env vars, payload formats, status vocabularies) live in each provider's
// ESignProvider implementation - see verifyWebhook/parseWebhookEvent.

import crypto from 'crypto';
import type { AuditAction } from './audit';
import { logAuditEvent } from './audit';
import { isInsecureDevAllowed } from './config';
import { knex } from './db';
import { getEnvelopeByProviderEnvelopeId, updateEnvelopeStatus } from './envelope';
import { sanitizeForLog } from './log';
import { withSpan } from './tracing';
import type { WebhookEvent } from './types';

// Terminal envelope statuses - no further transitions allowed once reached
// (typed as string to compare against the persisted envelope.status field)
const TERMINAL_STATUSES = new Set<string>(['completed', 'voided', 'declined']);

// Log security event with timestamp and optional IP (no PII)
const logSecurityEvent = (message: string, ip?: string): void => {
  const metadata = {
    event: message,
    timestamp: new Date().toISOString(),
    ...(ip && { ip }),
  };
  console.error('Security event:', JSON.stringify(metadata));
};

// Validate an HMAC-SHA256 signature over a raw webhook body.
// Providers extract the signature from their own header and pass their own
// secret; this function owns the shared mechanics and key-missing policy:
//   - dev mode without a key: allow with a warning
//   - production without a key: reject (fail closed - an unauthenticated
//     webhook endpoint must never ship silently)
// @param signature - The signature header value (base64)
// @param body - The raw request body string (not re-serialized)
// @param hmacKey - The provider's webhook signing secret
// @param ip - Optional client IP for security logging
export const validateHmac = (
  signature: string | undefined,
  body: string,
  hmacKey: string | undefined,
  ip?: string
): boolean => {
  if (!hmacKey) {
    // Fail closed unless insecure-dev is explicitly opted into. NOT gated on
    // NODE_ENV - a missing/typo'd value must never open this unauthenticated
    // endpoint. validateSecurityConfig() refuses to boot a real provider
    // without a key unless ALLOW_INSECURE_DEV=true.
    if (!isInsecureDevAllowed()) {
      logSecurityEvent('Webhook HMAC key not configured - webhook rejected', ip);
      return false;
    }
    // Dev mode: log warning and allow
    console.warn('⚠️ Webhook HMAC key not configured - webhook validation disabled');
    return true;
  }

  // Missing or empty signature in production mode
  if (!signature || signature.trim() === '') {
    logSecurityEvent('Webhook received without signature', ip);
    return false;
  }

  try {
    // Compute expected signature using HMAC-SHA256
    const expectedSignature = crypto
      .createHmac('sha256', hmacKey)
      .update(body, 'utf8')
      .digest('base64');

    // Timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'base64');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');

    // Length check first (timing-safe equal requires same length)
    if (signatureBuffer.length !== expectedBuffer.length) {
      logSecurityEvent('HMAC signature length mismatch', ip);
      return false;
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValid) {
      logSecurityEvent('HMAC signature verification failed', ip);
    }

    return isValid;
  } catch (error) {
    // Handle malformed base64 or other crypto errors
    logSecurityEvent(
      `HMAC validation error - ${error instanceof Error ? error.message : 'unknown error'}`,
      ip
    );
    return false;
  }
};

// Handle a normalized webhook event from any provider.
// Updates envelope status and creates an audit log entry.
// Idempotent: duplicate events with the same status do not create duplicate
// audit logs, which also makes provider retries (after a 500) safe.
export const handleWebhookEvent = async (event: WebhookEvent): Promise<void> =>
  withSpan(
    'esign.webhook.process',
    {
      'esign.provider_envelope_id': event.providerEnvelopeId,
      'esign.webhook.raw_status': event.rawStatus,
    },
    async (span) => {
      if (!event.status) {
        console.warn(
          `Webhook received with unknown status: ${sanitizeForLog(event.rawStatus)} for envelope ${sanitizeForLog(event.providerEnvelopeId)}`
        );
        span.setAttribute('esign.webhook.outcome', 'ignored_unknown_status');
        return; // Ignore untracked statuses - don't ask the provider to retry
      }
      const newStatus = event.status;
      span.setAttribute('esign.webhook.status', newStatus);

      // Look up envelope by the provider's envelope ID (not internal ID)
      const envelope = await getEnvelopeByProviderEnvelopeId(event.providerEnvelopeId);

      if (!envelope) {
        // Log warning but return success - may be from different environment or already deleted
        console.warn(
          `Webhook received for unknown envelope: ${sanitizeForLog(event.providerEnvelopeId)}`
        );
        span.setAttribute('esign.webhook.outcome', 'unknown_envelope');
        return;
      }
      span.setAttribute('esign.envelope_id', envelope.id);

      // Idempotency check: if status already matches, skip update
      if (envelope.status === newStatus) {
        console.log(`Idempotent: envelope ${envelope.id} already has status ${newStatus}`);
        span.setAttribute('esign.webhook.outcome', 'unchanged');
        return;
      }

      // State-machine guard: completed/voided/declined are terminal. Reject any
      // transition out of a terminal state - this blocks a replayed older
      // signed webhook (e.g. a captured `sent`) from downgrading a finished
      // envelope and re-enabling session restart.
      if (TERMINAL_STATUSES.has(envelope.status)) {
        console.warn(
          `Webhook ignored: envelope ${envelope.id} is in terminal status ${envelope.status}, refusing transition to ${newStatus}`
        );
        span.setAttribute('esign.webhook.outcome', 'rejected_terminal');
        return;
      }

      // Update envelope status and audit log atomically - if either write fails,
      // both roll back (same consistency guarantee as the createEnvelope resolver)
      await knex.transaction(async (trx) => {
        await updateEnvelopeStatus(envelope.id, newStatus, trx);

        // Past the terminal-state guard, the only possible transitions are
        // sent -> completed | voided | declined, each of which is a valid
        // audit action (a 'sent' webhook on a still-'sent' envelope is caught
        // by the idempotency check above, so newStatus is never 'sent' here).
        const auditAction = newStatus as AuditAction;
        await logAuditEvent(envelope.id, auditAction, { source: 'webhook' }, trx);
      });

      span.setAttribute('esign.webhook.outcome', 'updated');
      console.log(`Webhook processed: envelope ${envelope.id} status updated to ${newStatus}`);
    }
  );
