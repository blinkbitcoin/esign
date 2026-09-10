// Bootstrap: `npm run dev` (ESIGN_PROVIDER=mock needs no credentials)
import { createHandlers } from './handlers';
import { createNodeServer, listen } from './node';

// PORT, else ESIGN_PORT_BASE + this demo's offset (table: scripts/lib/ports.mjs)
const PORT_BASE_DEFAULT = 4100;
const PORT_OFFSET = 5;
const port =
  Number(process.env.PORT) ||
  Number(process.env.ESIGN_PORT_BASE || PORT_BASE_DEFAULT) + PORT_OFFSET;
listen(createNodeServer(createHandlers()), port).then(origin => {
  console.log(
    `serverless-handler-demo listening at ${origin} (ESIGN_PROVIDER=${process.env.ESIGN_PROVIDER || 'docusign'})`,
  );
});
