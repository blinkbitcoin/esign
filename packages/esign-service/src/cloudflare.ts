// @blinkbitcoin/esign-service/cloudflare - the service as a Worker.
//
// The whole deployment is this file plus environment variables:
//
//   // src/index.ts
//   export { default } from '@blinkbitcoin/esign-service/cloudflare';
//
// `nodejs_compat` is required: the DocuSign JWT assertion signs with
// node:crypto. There is no Postgres driver on Workers, so this target serves
// the mint capability only - the boot guard refuses DATABASE_URL here with a
// message that says so, rather than failing on the first webhook.
//
// The Worker's bindings ARE the environment: nothing here reads process.env,
// so secrets set with `wrangler secret put` reach the same variable names a
// container reads from its env file. `_FILE` PEM paths are container-only
// (there is no filesystem); `DOCUSIGN_PRIVATE_KEY_BASE64` works everywhere.

import { createESignApp, type ESignApp } from './app';
import type { Env } from './env';

// One app per environment object. A Worker isolate serves many requests with
// the same bindings, so the boot guard, the JWKS cache and the provider are
// built once, not per request.
const apps = new WeakMap<object, ESignApp>();

export const workerApp = (env: Env): ESignApp => {
  const cached = apps.get(env as object);
  if (cached) {
    return cached;
  }
  const app = createESignApp(env, { runtime: 'edge' });
  apps.set(env as object, app);
  return app;
};

export interface Worker {
  fetch: (request: Request, env: Env) => Promise<Response>;
}

const worker: Worker = {
  fetch: (request, env) => workerApp(env).fetch(request),
};

export default worker;
