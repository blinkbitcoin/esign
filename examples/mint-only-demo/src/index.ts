// Bootstrap: `npm run dev` (ESIGN_PROVIDER=mock needs no credentials; loads
// .env via `--env-file-if-exists`, so `cp .env.example .env` actually takes
// effect) or the built `npm start` (dist/index.js, same env-file loading).

import { createMint } from './mint';
import { createServer } from './server';

// PORT, else ESIGN_PORT_BASE + this demo's offset (table: scripts/lib/ports.mjs)
const PORT_BASE_DEFAULT = 4100;
const PORT_OFFSET = 4;
const port =
  Number(process.env.PORT) ||
  Number(process.env.ESIGN_PORT_BASE || PORT_BASE_DEFAULT) + PORT_OFFSET;
const { server, start } = createServer(createMint());

start(port).then(({ url }) => {
  console.log(
    `mint-only-demo listening at ${url} (ESIGN_PROVIDER=${process.env.ESIGN_PROVIDER || 'docusign'})`,
  );
});

// A container's orchestrator (Docker, Kubernetes, Fly, ...) sends SIGTERM
// to ask for a clean shutdown before killing the process; Ctrl-C sends
// SIGINT locally. Either way: stop accepting new connections and exit.
// `shuttingDown` guards re-entrancy - a second signal while `server.stop()`
// is still in flight (an impatient double Ctrl-C, or SIGTERM followed by
// SIGINT from the same orchestrator) must not call `apollo.stop()` /
// `httpServer.close()` a second time on top of the first.
let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  server
    .stop()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Error during shutdown:', error);
      process.exit(1);
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
