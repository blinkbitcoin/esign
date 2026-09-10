// The deploy targets: the same app behind each platform's entry shape, and
// the one structural promise the Worker makes - nothing Node-only is
// reachable from it.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

import worker, { workerApp } from '../src/cloudflare';
import { DEV_ENV, silently } from './support/app';

const request = (path_: string, init?: RequestInit) =>
  new Request(`https://esign.example.com${path_}`, init);

describe('the Cloudflare entry', () => {
  it('serves the mint capability from the Worker bindings', async () => {
    const response = await silently(() => worker.fetch(request('/health'), { ...DEV_ENV }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ capabilities: ['mint'] });
  });

  it('mints for an authenticated caller', async () => {
    const response = await silently(() =>
      worker.fetch(
        request('/webform/instance', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer user-1' },
          body: JSON.stringify({ prefill: {} }),
        }),
        { ...DEV_ENV }
      )
    );

    expect(response.status).toBe(200);
  });

  it('refuses DATABASE_URL with a message that says why', async () => {
    await expect(
      silently(() => worker.fetch(request('/health'), { ...DEV_ENV, DATABASE_URL: 'postgres://x' }))
    ).rejects.toThrow(/cannot open a Postgres connection/);
  });

  it('builds the app once per bindings object', async () => {
    const env = { ...DEV_ENV };

    const first = await silently(() => workerApp(env));
    expect(workerApp(env)).toBe(first);
    expect(await silently(() => workerApp({ ...DEV_ENV }))).not.toBe(first);
  });

  // The Worker has no Postgres driver and no GraphQL executor. The envelope
  // capability is reached through a loader the entry supplies for exactly
  // that reason - a bundler following this entry must not find `pg` or
  // Apollo, whether the import is static, a side effect, or a literal
  // `import('…')` a bundler would resolve anyway. A guard, not a snapshot.
  it('reaches no Node-only module, and never names the envelope module', () => {
    const src = path.resolve(__dirname, '../src');
    // Prefixes, so a subpath (@blinkbitcoin/esign-node/knex) is caught too
    const forbidden = ['pg', 'knex', '@apollo/server', '@hono/node-server', 'dotenv'];
    const isForbidden = (specifier: string) =>
      forbidden.some((name) => specifier === name || specifier.startsWith(`${name}/`));
    const seen = new Set<string>();
    const offenders: string[] = [];

    // A relative specifier as this package's tsc build resolves it: a file,
    // or a directory's index
    const resolve = (from: string, specifier: string): string => {
      const base = path.resolve(from, specifier.replace(/\.js$/, ''));
      return existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, 'index.ts');
    };

    const walk = (file: string): void => {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      // Prose, not code: these files document the loader by writing
      // `import('./envelopes.js')` in a comment, and a bundler does not
      // follow comments either
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Value imports only, including side-effect ones (`import 'x'`):
      // `import type` is erased by the build, and the envelope half is
      // reached through an injected loader that this graph never names
      const specifiers = [
        ...[...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]),
        ...[...source.matchAll(/^import\s+'([^']+)'/gm)].map((m) => m[1]),
        ...[...source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]),
      ];
      for (const specifier of specifiers) {
        if (isForbidden(specifier)) {
          offenders.push(`${path.relative(src, file)} imports ${specifier}`);
          continue;
        }
        if (specifier.startsWith('.')) {
          walk(resolve(path.dirname(file), specifier));
        }
      }
    };

    walk(path.join(src, 'cloudflare.ts'));

    expect(offenders).toEqual([]);
    // Not even by name: a literal import('./envelopes.js') anywhere on this
    // graph is what a bundler would follow into Apollo and pg
    expect([...seen].filter((file) => file.endsWith('envelopes.ts'))).toEqual([]);
    // The walk really did follow the graph (not silently stop at the entry)
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('the envelope loader', () => {
  it('is how a Node target reaches the envelope module', async () => {
    const { loadEnvelopes } = await import('../src/loadEnvelopes');

    await expect(loadEnvelopes()).resolves.toHaveProperty(
      'createEnvelopeCapability',
      expect.any(Function)
    );
  });
});

describe('the Vercel entry', () => {
  it('exports one handler per method, all serving the app', async () => {
    const { handlers } = await silently(() => import('../src/vercel'));
    const app = await silently(() =>
      import('../src/app').then(({ createESignApp }) => createESignApp({ ...DEV_ENV }))
    );

    const { GET, POST, OPTIONS } = handlers(app);
    expect(await (await GET(request('/health'))).json()).toMatchObject({ status: 'ok' });
    expect((await POST(request('/webform/instance', { method: 'POST' }))).status).toBe(401);
    expect((await OPTIONS(request('/nope', { method: 'OPTIONS' }))).status).toBe(404);
  });

  it('builds its app at import time, from process.env', async () => {
    const { GET } = await silently(() => import('../src/vercel'));

    // tests/setup.ts puts the suite in the dev-passthrough mode a local
    // `vercel dev` runs in
    const response = await GET(request('/health'));
    expect(await response.json()).toMatchObject({ status: 'ok', capabilities: ['mint'] });
  });
});
