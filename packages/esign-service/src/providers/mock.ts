// The mock adapter for the service: the package's in-memory provider, with
// signing pages served by this service (app.ts) and DocuSign's Connect
// webhook format mirrored through the DocuSign adapter.

import { createMockProvider } from '@blinkbitcoin/esign-node';
import { localOrigin } from '../port';
import { DocuSignProvider } from './docusign';

const handle = createMockProvider({
  baseUrl: () => localOrigin(),
  webhook: DocuSignProvider,
});

export const MockProvider = handle;

// Test helpers + the mock web-form page's prefill lookup
export const setEnvelopeStatus = handle.setEnvelopeStatus;
export const addEnvelope = handle.addEnvelope;
export const clearEnvelopes = handle.clearEnvelopes;
export const getWebFormPrefill = handle.getWebFormPrefill;
