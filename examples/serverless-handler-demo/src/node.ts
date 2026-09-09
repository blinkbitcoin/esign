// A plain Node http server around Fetch handlers, for running the example
// (and CI's smoke) without a platform. Serverless platforms hand the
// handler a Request themselves; this file is the adapter they replace.

import http from 'node:http';
import type { Handler, Handlers } from './handlers';

export const routes = (handlers: Handlers): Record<string, Handler> => ({
  'POST /webform/instance': handlers.mint,
  'POST /webhook/esign': handlers.webhook,
  'GET /health': async () => Response.json({ status: 'ok' }),
});

// Node's IncomingMessage → Fetch Request
export const toRequest = async (
  req: http.IncomingMessage,
  origin: string,
): Promise<Request> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    }
  }
  const method = req.method ?? 'GET';
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks);
  return new Request(new URL(req.url ?? '/', origin), {
    method,
    headers,
    body,
  });
};

// Fetch Response → Node's ServerResponse
export const send = async (
  response: Response,
  res: http.ServerResponse,
): Promise<void> => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
};

export const createNodeServer = (handlers: Handlers): http.Server => {
  const table = routes(handlers);
  return http.createServer(async (req, res) => {
    const request = await toRequest(
      req,
      `http://${req.headers.host ?? 'localhost'}`,
    );
    const route = table[`${request.method} ${new URL(request.url).pathname}`];
    const response = route
      ? await route(request)
      : Response.json({ error: 'Not found' }, { status: 404 });
    await send(response, res);
  });
};

// Listen on a port (0 = any free port); resolves the origin
export const listen = (server: http.Server, port: number): Promise<string> =>
  new Promise(resolve => {
    server.listen(port, () => {
      const address = server.address() as { port: number };
      resolve(`http://localhost:${address.port}`);
    });
  });
