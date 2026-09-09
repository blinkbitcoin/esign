// HTTP server startup, separated from the index.ts bootstrap for testability.

import http from 'http';
import type { AddressInfo } from 'net';
import { createApp } from './app';
import { validateSecurityConfig } from './config';

// Create the app and start listening. Pass port 0 for an ephemeral port
// (tests). Returns the server so callers can inspect its address or close it.
export const startServer = async (port: number): Promise<http.Server> => {
  // Fail closed at boot: refuse to start without the required security
  // secrets unless ALLOW_INSECURE_DEV=true is explicitly set.
  validateSecurityConfig();

  const app = await createApp();
  const httpServer = http.createServer(app);

  await new Promise<void>((resolve) => httpServer.listen({ port }, resolve));

  const boundPort = (httpServer.address() as AddressInfo).port;
  console.log(`🚀 Server ready at http://localhost:${boundPort}/graphql`);
  console.log(`🏥 Health check at http://localhost:${boundPort}/health`);
  console.log(`📬 Webhook endpoint at http://localhost:${boundPort}/webhook/esign`);
  console.log(`📝 E-signature provider: ${process.env.ESIGN_PROVIDER || 'mock'}`);

  return httpServer;
};
