// Server bootstrap: load env, init telemetry, start listening. All testable
// logic lives in instrumentation.ts, server.ts (startServer), and app.ts.
//
// Ordering is load-bearing, hence the dynamic import:
// 1. 'dotenv/config' FIRST - importing server.ts transitively evaluates
//    db.ts, which fails fast when DATABASE_URL is unset.
// 2. initTelemetry() BEFORE server.ts loads - OpenTelemetry patches
//    express/pg/graphql at require time, so they must not be loaded yet.

import 'dotenv/config';

import { initTelemetry } from './instrumentation';

initTelemetry();

const PORT = Number(process.env.PORT) || 4000;

import('./server.js')
  .then(({ startServer }) => startServer(PORT))
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
