// @blinkbitcoin/esign-service/vercel - the service as a Vercel route handler.
//
// The whole deployment is this file plus environment variables:
//
//   // app/api/[...path]/route.ts
//   export { GET, POST, OPTIONS } from '@blinkbitcoin/esign-service/vercel';
//
// Node runtime (the DocuSign JWT assertion and, with a pooled DATABASE_URL,
// the Postgres store need it). The app is built at module load, so a
// misconfigured deployment fails at first import rather than on the first
// request - the same boot guard a container gets.

import { createESignApp, type ESignApp } from './app';

export interface RouteHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  OPTIONS: (request: Request) => Promise<Response>;
}

// The three methods this service answers, all the same handler: the app
// routes on method and path itself.
export const handlers = (app: ESignApp): RouteHandlers => {
  const handle = (request: Request): Promise<Response> => app.fetch(request);
  return { GET: handle, POST: handle, OPTIONS: handle };
};

export const { GET, POST, OPTIONS } = handlers(createESignApp(process.env));
