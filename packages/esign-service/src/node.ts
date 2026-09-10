#!/usr/bin/env node
// The process entry point: what the image runs, and what `npx esign-service`
// runs. `node dist/node.js` serves; `node dist/node.js migrate` applies the
// migrations and exits.
//
// The importable Node surface (startServer and the rate-limit pieces) is
// ./server - the `@blinkbitcoin/esign-service/node` subpath resolves there.
// This file cannot re-export it statically, because the ordering below is
// load-bearing:
//   1. 'dotenv/config' FIRST, so .env is in process.env before anything reads it
//   2. initTelemetry() BEFORE the app loads - OpenTelemetry patches http, pg
//      and graphql at require time, so they must not be loaded yet
// Hence the dynamic imports.

import 'dotenv/config';

import { initTelemetry } from './instrumentation';

initTelemetry();

const command = process.argv[2];

const run = async (): Promise<void> => {
  if (command === 'migrate') {
    await import('./migrate.js');
    return;
  }
  const { startServer } = await import('./server.js');
  await startServer();
};

run().catch((error: unknown) => {
  console.error('Failed to start esign-service:', error);
  process.exit(1);
});
