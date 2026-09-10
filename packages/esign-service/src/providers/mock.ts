// The mock adapter for the service: the package's in-memory provider, with
// signing pages served by this service and DocuSign's Connect webhook format
// mirrored through the DocuSign adapter.
//
// A factory, not an instance. The handle it returns carries the mock's own
// state (the envelopes it created, the prefill each minted instance locked),
// so the signing pages must be rendered from the very handle the mint used -
// `selectProvider` hands both to the app together.

import { createMockProvider } from '@blinkbitcoin/esign-node';
import type { Env } from '../env';
import { localOrigin } from '../port';
import { createProvider as createDocuSignProvider } from './docusign';

export type MockHandle = ReturnType<typeof createMockProvider>;

// Where the mock's pages are served: this service, on the port it was told
// to listen on (MOCK_PAGES_ORIGIN overrides, for a host behind a proxy).
export const createMock = (env: Env = process.env): MockHandle =>
  createMockProvider({
    baseUrl: () => env.MOCK_PAGES_ORIGIN || localOrigin(env),
    webhook: createDocuSignProvider(env),
  });
