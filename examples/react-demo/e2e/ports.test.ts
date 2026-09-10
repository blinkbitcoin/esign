// The port scheme the Playwright configs rely on: ESIGN_PORT_BASE + offset
// per service, each service's own variable overriding. The table lives in
// scripts/lib/ports.mjs; this file's copy must match it.

declare const process: { env: Record<string, string | undefined> };

import {
  SERVICES,
  resolvePorts,
  BASE_DEFAULT as TABLE_BASE_DEFAULT,
} from '../../../scripts/lib/ports.mjs';
import {
  API_OFFSET,
  API_VAR,
  BASE_DEFAULT,
  BASE_VAR,
  DEFAULT_PORTS,
  MODES,
  PORTS,
  WEB_OFFSETS,
  WEB_VARS,
  backendServer,
  baseURL,
  ciPolicy,
  liveViteDevServer,
  portFrom,
  portsFrom,
  viteDevServer,
  vitePreviewServer,
} from './ports';

describe('the port table', () => {
  it('is the repo table (scripts/lib/ports.mjs)', () => {
    expect(BASE_DEFAULT).toBe(TABLE_BASE_DEFAULT);
    expect(API_OFFSET).toBe(SERVICES.api.offset);
    expect(API_VAR).toBe(SERVICES.api.env);
    expect(WEB_OFFSETS).toEqual({
      proxy: SERVICES.webProxy.offset,
      webform: SERVICES.webWebform.offset,
      publicurl: SERVICES.webPublicurl.offset,
    });
    expect(WEB_VARS).toEqual({
      proxy: SERVICES.webProxy.env,
      webform: SERVICES.webWebform.env,
      publicurl: SERVICES.webPublicurl.env,
    });
    for (const env of [
      {},
      { [BASE_VAR]: '4300' },
      { [BASE_VAR]: '4300', ESIGN_WEB_WEBFORM_PORT: '5555' },
    ]) {
      const table = resolvePorts(env);
      expect(portsFrom(env)).toEqual({
        api: table.api,
        vite: {
          proxy: table.webProxy,
          webform: table.webWebform,
          publicurl: table.webPublicurl,
        },
      });
    }
  });

  it('defaults to the 4100 block', () => {
    expect(DEFAULT_PORTS).toEqual({
      api: 4100,
      vite: { proxy: 4101, webform: 4102, publicurl: 4103 },
    });
  });

  it('moves the whole stack with the base and one service with its own variable', () => {
    expect(portsFrom({ [BASE_VAR]: '4300' })).toEqual({
      api: 4300,
      vite: { proxy: 4301, webform: 4302, publicurl: 4303 },
    });
    expect(portsFrom({ ESIGN_API_PORT: '4010', ESIGN_WEB_PORT: '' })).toEqual({
      api: 4010,
      vite: { proxy: 4101, webform: 4102, publicurl: 4103 },
    });
  });

  it('never hands out a port twice', () => {
    const ports = portsFrom({});
    const all = [ports.api, ...MODES.map(mode => ports.vite[mode])];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('portFrom', () => {
  it.each(['0', '65536', '-1', '1.5', 'abc', ' '])(
    'rejects the malformed value %j',
    value => {
      expect(() => portFrom('ESIGN_API_PORT', value, 1)).toThrow(
        /ESIGN_API_PORT must be a port number/,
      );
    },
  );
});

describe('ciPolicy', () => {
  it('reuses a running server and never retries locally', () => {
    expect(ciPolicy({})).toEqual({ reuseExistingServer: true, retries: 0 });
  });

  it('never adopts a foreign listener and retries once in CI', () => {
    expect(ciPolicy({ CI: 'true' })).toEqual({
      reuseExistingServer: false,
      retries: 1,
    });
  });
});

describe('liveViteDevServer', () => {
  it('points the webform demo at the live service and hands it the prefill', () => {
    const server = liveViteDevServer('http://localhost:4106', '{"a":1}');
    expect(server.command).toContain('VITE_API_ORIGIN=http://localhost:4106 ');
    expect(server.command).toContain('VITE_ESIGN_MODE=webform ');
    expect(server.command).toContain(`VITE_ESIGN_PREFILL='{"a":1}' `);
    expect(server.command).toContain(
      `--port ${PORTS.vite.webform} --strictPort`,
    );
    expect(server.url).toBe(baseURL('webform'));
    expect(server.reuseExistingServer).toBe(false);
    // No prefill → an empty object; single quotes never break the shell
    expect(liveViteDevServer('http://x', undefined).command).toContain(
      "VITE_ESIGN_PREFILL='{}'",
    );
    expect(liveViteDevServer('http://x', `{"n":"o'x"}`).command).toContain(
      `VITE_ESIGN_PREFILL='{"n":"ox"}'`,
    );
  });
});

describe('this process', () => {
  it('resolves its ports from the environment', () => {
    expect(PORTS).toEqual(portsFrom(process.env));
  });

  it('wires the backend port, CORS origins and the demo origin into the servers', () => {
    const backend = backendServer();
    expect(backend.command).toContain(`PORT=${PORTS.api} `);
    expect(backend.command).toContain(
      `CORS_ALLOWED_ORIGINS=http://localhost:${PORTS.vite.proxy},http://localhost:${PORTS.vite.webform},http://localhost:${PORTS.vite.publicurl} `,
    );
    expect(backend.url).toBe(`http://localhost:${PORTS.api}/health`);

    const dev = viteDevServer('webform');
    expect(dev.command).toContain(
      `VITE_API_ORIGIN=http://localhost:${PORTS.api} `,
    );
    expect(dev.command).toContain('VITE_ESIGN_MODE=webform ');
    expect(dev.command).toContain(`--port ${PORTS.vite.webform} --strictPort`);
    expect(dev.url).toBe(baseURL('webform'));

    const preview = vitePreviewServer('proxy');
    expect(preview.command).toContain(
      `VITE_API_ORIGIN=http://localhost:${PORTS.api} `,
    );
    expect(preview.command).toContain(
      `--port ${PORTS.vite.proxy} --strictPort`,
    );
    expect(preview.url).toBe(`http://localhost:${PORTS.vite.proxy}`);
  });
});
