// Bootstrap: `npm run dev` (ESIGN_PROVIDER=mock needs no credentials)
import { createMint } from './mint';
import { createServer } from './server';

const port = Number(process.env.PORT || 4100);
createServer(createMint())
  .start(port)
  .then(({ url }) => {
    console.log(
      `mint-only-demo listening at ${url} (ESIGN_PROVIDER=${process.env.ESIGN_PROVIDER || 'docusign'})`,
    );
  });
