import http from 'node:http';
import { createNodeServer, listen, routes, send, toRequest } from '../src/node';

const handlers = {
  mint: async (request: Request) =>
    Response.json({
      echo: await request.json(),
      auth: request.headers.get('authorization'),
    }),
  webhook: async () => Response.json({ received: true }),
};

describe('routes', () => {
  it('maps the two esign routes and a health check', async () => {
    const table = routes(handlers);
    expect(Object.keys(table)).toEqual([
      'POST /webform/instance',
      'POST /webhook/esign',
      'GET /health',
    ]);
    expect(
      await table['GET /health'](new Request('http://x/health')).then(r =>
        r.json(),
      ),
    ).toEqual({
      status: 'ok',
    });
  });
});

describe('createNodeServer', () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    server = createNodeServer(handlers);
    origin = await listen(server, 0);
  });

  afterAll(() => {
    server.close();
  });

  it('serves the handlers over HTTP with the body and headers intact', async () => {
    const response = await fetch(`${origin}/webform/instance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer user-1',
      },
      body: JSON.stringify({ prefill: { a: 1 } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      echo: { prefill: { a: 1 } },
      auth: 'Bearer user-1',
    });
  });

  it('answers 404 off the route table and 200 on the health check', async () => {
    expect((await fetch(`${origin}/nope`)).status).toBe(404);
    expect((await fetch(`${origin}/webhook/esign`)).status).toBe(404); // GET
    expect(await fetch(`${origin}/health`).then(r => r.json())).toEqual({
      status: 'ok',
    });
  });
});

describe('createNodeServer without a Host header', () => {
  it('still routes (origin falls back to localhost)', async () => {
    const server = createNodeServer(handlers);
    const req = Object.assign((async function* () {})(), {
      headers: {},
      method: 'GET',
      url: '/health',
    }) as unknown as http.IncomingMessage;
    const end = vi.fn();
    const res = { setHeader: vi.fn(), end } as unknown as http.ServerResponse;
    server.emit('request', req, res);
    await vi.waitFor(() => expect(end).toHaveBeenCalled());
    expect(JSON.parse(end.mock.calls[0][0].toString())).toEqual({
      status: 'ok',
    });
  });
});

describe('toRequest / send', () => {
  it('joins repeated headers, drops bodies of GET requests and defaults method + url', async () => {
    const fake = Object.assign(
      (async function* () {
        yield Buffer.from('ignored');
      })(),
      { headers: { 'x-multi': ['a', 'b'], 'x-one': 'c', 'x-none': undefined } },
    ) as unknown as http.IncomingMessage;
    const request = await toRequest(fake, 'http://origin');
    expect(request.method).toBe('GET');
    expect(request.url).toBe('http://origin/');
    expect(request.headers.get('x-multi')).toBe('a, b');
    expect(request.headers.get('x-one')).toBe('c');
    expect(request.headers.has('x-none')).toBe(false);
    expect(request.body).toBeNull();
  });

  it('writes status, headers and body onto the Node response', async () => {
    const setHeader = vi.fn();
    const end = vi.fn();
    const res = { setHeader, end } as unknown as http.ServerResponse;
    await send(
      new Response('hi', { status: 201, headers: { 'x-a': '1' } }),
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(setHeader).toHaveBeenCalledWith('x-a', '1');
    expect(end).toHaveBeenCalledWith(Buffer.from('hi'));
  });
});
