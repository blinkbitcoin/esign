// Composition root for the domain: the envelope service over the configured
// provider and the Postgres store, with OpenTelemetry spans.

import { createEnvelopeService } from '@blinkbitcoin/esign-server';
import { provider } from './providers';
import { store } from './store';
import { withSpan } from './tracing';

export const envelopeService = createEnvelopeService({
  provider,
  store,
  tracing: { withSpan },
});
