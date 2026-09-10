// Composition root for the domain: the envelope service over the provider
// the app selected and the Postgres store, with OpenTelemetry spans.
//
// A factory: the provider is whatever `createESignApp` resolved, so the
// GraphQL resolvers and the webhook always run on the same adapter - an
// injected `deps.provider` cannot be silently ignored by one of them.

import { createEnvelopeService, type EnvelopeService } from '@blinkbitcoin/esign-node';
import type { ESignProvider } from './providers/port';
import { store } from './store';
import { withSpan } from './tracing';

export const createServices = (provider: ESignProvider): EnvelopeService =>
  createEnvelopeService({
    provider,
    store,
    tracing: { withSpan },
  });
