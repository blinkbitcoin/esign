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
  bearerToken,
  createEnvelopeService,
  createMemoryEnvelopeStore,
  createWebFormInstanceHandler,
  createWebhookHandler,
  defaultRegistry,
  type ESignProvider,
  type Logger,
  providerFromEnv as selectProvider,
} from '@blinkbitcoin/esign-server';

export type Handler = (request: Request) => Promise<Response>;

export interface Handlers {
  mint: Handler;
  webhook: Handler;
}

// What a host injects: where the package reports (default: the console)
export interface HandlerOptions {
  logger?: Logger;
}

// This example accepts `Authorization: Bearer <userId>` as-is; a real host
// verifies its own session token here. The package never sees the token.
export const authenticate = (request: Request): string | null =>
  bearerToken(request.headers.get('authorization'));

// The provider ESIGN_PROVIDER selects out of the package's registry: DocuSign
// unless `mock` is set. Only the mock is allowed to run unsigned webhooks.
export const providerFromEnv = (
  env: NodeJS.ProcessEnv,
  { logger }: HandlerOptions = {},
): ESignProvider =>
  selectProvider(
    env,
    defaultRegistry(env, {
      webhook: {
        allowMissingKey: () => env.ESIGN_PROVIDER === 'mock',
        logger,
      },
    }),
    { default: 'docusign' },
  );

export const createHandlers = (
  env: NodeJS.ProcessEnv = process.env,
  options: HandlerOptions = {},
): Handlers => {
  const { logger } = options;
  const provider = providerFromEnv(env, options);
  const envelopes = createEnvelopeService({
    provider,
    store: createMemoryEnvelopeStore(),
    logger,
  });
  return {
    mint: createWebFormInstanceHandler({ provider, authenticate, logger }),
    webhook: createWebhookHandler({
      provider,
      envelopes,
      logger,
      clientIp: request =>
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        undefined,
    }),
  };
};
