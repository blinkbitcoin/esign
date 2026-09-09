// Bootstrap: `npm run dev` (ESIGN_PROVIDER=mock needs no credentials)
import { createHandlers } from './handlers';
import { createNodeServer, listen } from './node';

const port = Number(process.env.PORT || 4200);
listen(createNodeServer(createHandlers()), port).then(origin => {
  console.log(
    `serverless-handler-demo listening at ${origin} (ESIGN_PROVIDER=${process.env.ESIGN_PROVIDER || 'docusign'})`,
  );
});
