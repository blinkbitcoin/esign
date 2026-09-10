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

describe('the Kubernetes templates', () => {
  const k8s = (file: string) =>
    readFileSync(path.join(import.meta.dirname, '..', 'deploy/k8s', file), 'utf8');

  // A very small YAML reader for these templates: `key: value` and block
  // scalars under one `stringData:` mapping. Enough to name the keys, and it
  // keeps a YAML parser out of the service's dependencies.
  const stringDataKeys = (yaml: string): string[] => {
    const lines = yaml.split('\n');
    const start = lines.findIndex((line) => line.trimEnd() === 'stringData:');
    expect(start).toBeGreaterThan(-1);
    const keys: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        continue;
      }
      const key = /^ {2}([^\s:]+):/.exec(line);
      if (key) {
        keys.push(key[1]);
      } else if (!line.startsWith('    ')) {
        break; // dedented out of the mapping
      }
    }
    return keys;
  };

  // kubelet refuses a key that is not a valid variable name and reports it
  // as an InvalidVariableNames event on every pod start
  const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

  it('keeps every key of the envFrom Secret a valid environment variable name', () => {
    const keys = stringDataKeys(k8s('secret.yaml'));

    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((key) => !ENV_NAME.test(key))).toEqual([]);
  });

  it('is the Secret both workloads read with envFrom', () => {
    for (const file of ['deployment.yaml', 'migrate-job.yaml']) {
      expect(k8s(file)).toContain(
        'envFrom:\n            - secretRef:\n                name: esign-service\n'
      );
    }
  });

  it('keeps the PEM in its own Secret, mounted and never injected', () => {
    const pem = k8s('secret-docusign-pem.yaml');
    expect(stringDataKeys(pem)).toEqual(['docusign.pem']);
    expect(pem).toContain('name: esign-service-docusign-pem');

    const deployment = k8s('deployment.yaml');
    expect(deployment).toContain('secretName: esign-service-docusign-pem');
    expect(deployment).toContain('value: /run/secrets/docusign.pem');
    // ...and nothing reads that Secret as environment
    expect(deployment).not.toContain('name: esign-service-docusign-pem\n                key');
  });

  it('applies both Secrets', () => {
    const kustomization = k8s('kustomization.yaml');
    expect(kustomization).toContain('- secret.yaml');
    expect(kustomization).toContain('- secret-docusign-pem.yaml');
  });
});

describe('the Cloudflare template ships clean', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')
  ) as { files: string[] };

  // wrangler writes a `.wrangler/` working directory next to the config it is
  // pointed at. deploy/cloudflare is tracked AND published, so nothing may
  // leave one there: make deploy-check runs the dry-run on a copy (and fails
  // if this directory reappears), the root .gitignore refuses to commit one,
  // and `files` refuses to pack one.
  it('has no wrangler working directory in the tracked template', () => {
    expect(existsSync(path.join(import.meta.dirname, '..', 'deploy/cloudflare/.wrangler'))).toBe(
      false
    );
  });

  it('keeps a wrangler working directory out of the tarball and out of git', () => {
    expect(manifest.files).toContain('!deploy/**/.wrangler');

    const gitignore = readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', '.gitignore'),
      'utf8'
    );
    expect(gitignore.split('\n')).toContain('.wrangler/');
  });

  it('runs the dry-run on a copy, and says so if the template was written to', () => {
    const script = readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'scripts/ci/deploy-check.sh'),
      'utf8'
    );

    expect(script).toContain('cp -R "$DEPLOY/cloudflare" "$TMP/cloudflare"');
    expect(script).toContain('--config "$TMP/cloudflare/wrangler.toml"');
    expect(script).toContain('if [ -e "$DEPLOY/cloudflare/.wrangler" ]; then');
  });
});
