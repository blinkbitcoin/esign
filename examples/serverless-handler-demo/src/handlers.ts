// The two esign endpoints as Fetch API handlers (Request → Response), the
// shape a serverless route exports directly:
//
//   app/api/webform/instance/route.ts  (Next.js)   export const POST = mint;
//   api/webhook.ts                     (Vercel)    export default webhook;
//   worker.ts                          (Cloudflare) fetch(request) { ... }
//
// The envelope domain runs over the in-memory store here because this
// example keeps nothing; a host with Postgres passes the /knex store instead.

import {
  createDocuSignProvider,
  createEnvelopeService,
  createMemoryEnvelopeStore,
  createMockProvider,
  createWebFormInstanceHandler,
  createWebhookHandler,
  docuSignConfigFromEnv,
  type ESignProvider,
} from '@blinkbitcoin/esign-server';

export type Handler = (request: Request) => Promise<Response>;

export interface Handlers {
  mint: Handler;
  webhook: Handler;
}

// This example accepts `Authorization: Bearer <userId>` as-is; a real host
// verifies its own session token here. The package never sees the token.
export const authenticate = (request: Request): string | null => {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  // Headers strip the whitespace around values, so a token is never empty
  // once the prefix matched
  return header.slice('Bearer '.length).trim();
};

export const providerFromEnv = (env: NodeJS.ProcessEnv): ESignProvider => {
  const docusign = createDocuSignProvider({
    config: docuSignConfigFromEnv(env),
    webhook: {
      hmacKey: () => env.DOCUSIGN_HMAC_KEY,
      // Only the mock is allowed to run unsigned
      allowMissingKey: () => env.ESIGN_PROVIDER === 'mock',
    },
  });
  if (env.ESIGN_PROVIDER !== 'mock') {
    return docusign;
  }
  return createMockProvider({
    baseUrl: () => env.MOCK_PAGES_ORIGIN || 'http://localhost:4000',
    webhook: docusign,
  });
};

export const createHandlers = (
  env: NodeJS.ProcessEnv = process.env,
): Handlers => {
  const provider = providerFromEnv(env);
  const envelopes = createEnvelopeService({
    provider,
    store: createMemoryEnvelopeStore(),
  });
  return {
    mint: createWebFormInstanceHandler({ provider, authenticate }),
    webhook: createWebhookHandler({
      provider,
      envelopes,
      clientIp: request =>
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        undefined,
    }),
  };
};
