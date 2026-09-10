// Bootstrap: `npm run dev` (ESIGN_PROVIDER=mock needs no credentials)
import { createMint } from './mint';
import { createServer } from './server';

// PORT, else ESIGN_PORT_BASE + this demo's offset (table: scripts/lib/ports.mjs)
const PORT_BASE_DEFAULT = 4100;
const PORT_OFFSET = 4;
const port =
  Number(process.env.PORT) ||
  Number(process.env.ESIGN_PORT_BASE || PORT_BASE_DEFAULT) + PORT_OFFSET;
createServer(createMint())
  .start(port)
  .then(({ url }) => {
    console.log(
      `mint-only-demo listening at ${url} (ESIGN_PROVIDER=${process.env.ESIGN_PROVIDER || 'docusign'})`,
    );
  });
