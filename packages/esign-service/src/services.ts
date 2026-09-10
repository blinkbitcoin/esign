// Composition root for the domain: the envelope service over the provider
// the app selected and the Postgres store, with OpenTelemetry spans.
//
// A factory: the provider is whatever `createESignApp` resolved, so the
// GraphQL resolvers and the webhook always run on the same adapter - an
// injected `deps.provider` cannot be silently ignored by one of them.

import {
  createEnvelopeService,
  type EnvelopeService,
  type EnvelopeStore,
} from '@blinkbitcoin/esign-node';
import type { ESignProvider } from './providers/port';
import { withSpan } from './tracing';

// Both ports are injected: the provider the app resolved and the store the
// envelope capability built from its env - never a module-level singleton.
export const createServices = (provider: ESignProvider, store: EnvelopeStore): EnvelopeService =>
  createEnvelopeService({
    provider,
    store,
    tracing: { withSpan },
  });
