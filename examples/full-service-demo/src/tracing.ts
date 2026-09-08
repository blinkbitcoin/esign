// Domain-level tracing helpers on the @opentelemetry/api facade.
//
// The facade is zero-cost: when the SDK (src/instrumentation.ts) has not
// been started, every span here is a no-op - so this module is safe to use
// unconditionally in dev, test, and production code paths.
//
// PII discipline matches the audit-metadata allow-list: span attributes
// carry ids, statuses, and types - never recipient names, emails, or
// document content.

import type { Attributes, Span } from '@opentelemetry/api';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { ESignProvider } from './providers/port';
import type { RecipientData, WebFormPrefill } from './types';

const tracer = trace.getTracer('esign-api');

// Run an async operation inside an active span: records exceptions, sets
// error status, and always ends the span. The callback receives the span
// for adding result attributes.
export const withSpan = async <T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>
): Promise<T> =>
  tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });

// Synchronous variant (for verifyWebhook/parseWebhookEvent)
export const withSpanSync = <T>(name: string, attributes: Attributes, fn: (span: Span) => T): T =>
  tracer.startActiveSpan(name, { attributes }, (span) => {
    try {
      return fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });

// Attach attributes to whatever span is currently active (e.g. the GraphQL
// resolver span created by auto-instrumentation). No-op when none is.
export const setActiveSpanAttributes = (attributes: Attributes): void => {
  trace.getActiveSpan()?.setAttributes(attributes);
};

// Wrap any ESignProvider so every call across the provider boundary becomes
// a span. Applied in the factory (provider.ts), so current AND future
// adapters are instrumented without touching their implementations - the
// tracing equivalent of the provider pattern itself.
export const instrumentProvider = (provider: ESignProvider, name: string): ESignProvider => ({
  // Optional Web Forms capability: only present (and traced) when the wrapped
  // provider supports it, so supportsWebForms() still reflects the real
  // capability through the wrapper.
  ...(provider.createWebFormInstance && {
    createWebFormInstance: (userId: string, prefill: WebFormPrefill) =>
      withSpan(
        'esign.provider.create_webform_instance',
        { 'esign.provider': name, 'enduser.id': userId },
        async (span) => {
          const result = await provider.createWebFormInstance!(userId, prefill);
          if (result.instanceId) {
            span.setAttribute('esign.webform_instance_id', result.instanceId);
          }
          return result;
        }
      ),
  }),

  createEnvelope: (userId: string, contractType: string, recipient: RecipientData) =>
    withSpan(
      'esign.provider.create_envelope',
      {
        'esign.provider': name,
        'esign.contract_type': contractType,
        'enduser.id': userId,
      },
      async (span) => {
        const result = await provider.createEnvelope(userId, contractType, recipient);
        span.setAttribute('esign.provider_envelope_id', result.envelopeId);
        return result;
      }
    ),

  getEnvelopeStatus: (envelopeId: string) =>
    withSpan(
      'esign.provider.get_envelope_status',
      { 'esign.provider': name, 'esign.provider_envelope_id': envelopeId },
      async (span) => {
        const status = await provider.getEnvelopeStatus(envelopeId);
        span.setAttribute('esign.envelope_status', status);
        return status;
      }
    ),

  getSigningUrl: (envelopeId: string, recipient: RecipientData) =>
    withSpan(
      'esign.provider.get_signing_url',
      { 'esign.provider': name, 'esign.provider_envelope_id': envelopeId },
      () => provider.getSigningUrl(envelopeId, recipient)
    ),

  verifyWebhook: (headers, rawBody, ip) =>
    withSpanSync('esign.provider.verify_webhook', { 'esign.provider': name }, (span) => {
      const verified = provider.verifyWebhook(headers, rawBody, ip);
      span.setAttribute('esign.webhook.verified', verified);
      return verified;
    }),

  parseWebhookEvent: (rawBody) =>
    withSpanSync('esign.provider.parse_webhook_event', { 'esign.provider': name }, (span) => {
      const event = provider.parseWebhookEvent(rawBody);
      span.setAttribute('esign.webhook.malformed', event === null);
      return event;
    }),
});
