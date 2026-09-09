import { createServer, userFromAuthorization } from '../src/server';

const MUTATION =
  'mutation Sign($units: Int!) { investSigningUrl(units: $units) { url instanceId } }';

describe('userFromAuthorization', () => {
  it('takes the bearer token as the user id (a real host verifies its session here)', () => {
    expect(userFromAuthorization('Bearer user-1')).toBe('user-1');
    expect(userFromAuthorization('Bearer  user-1 ')).toBe('user-1');
    expect(userFromAuthorization('Basic abc')).toBeNull();
    expect(userFromAuthorization(undefined)).toBeNull();
  });
});

describe('createServer', () => {
  const mint = vi.fn(
    async (userId: string, prefill: Record<string, unknown>) => ({
      url: `https://forms.example/${userId}/${Object.keys(prefill).length}`,
      instanceId: 'i-1',
    }),
  );

  it('serves the mutation over HTTP for an authenticated caller', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-1',
        },
        body: JSON.stringify({ query: MUTATION, variables: { units: 10 } }),
      });
      expect(await response.json()).toEqual({
        data: {
          investSigningUrl: {
            url: 'https://forms.example/user-1/5',
            instanceId: 'i-1',
          },
        },
      });
      expect(mint).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          number_of_units: '10',
          total_subscription_usd: '1000.00',
        }),
      );
    } finally {
      await server.stop();
    }
  });

  it('answers with errors, not a mint, for an unauthenticated caller or bad units', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    mint.mockClear();
    try {
      const post = (headers: Record<string, string>, units: number) =>
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ query: MUTATION, variables: { units } }),
        }).then(r => r.json());
      const anonymous = await post({}, 10);
      expect(anonymous.errors[0].message).toBe('Unauthenticated');
      const tooMany = await post({ authorization: 'Bearer user-1' }, 999_999);
      expect(tooMany.errors[0].message).toMatch(/units must be/);
      expect(mint).not.toHaveBeenCalled();
      const health = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ health }' }),
      }).then(r => r.json());
      expect(health).toEqual({ data: { health: 'ok' } });
    } finally {
      await server.stop();
    }
  });
});
