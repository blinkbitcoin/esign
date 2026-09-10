import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BASE_DEFAULT,
  BASE_VAR,
  SERVICES,
  baseFrom,
  envLines,
  portFrom,
  resolvePorts,
} from './ports.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => readFileSync(join(root, file), 'utf8');

describe('the port table', () => {
  it("starts at 4100 (4000 is everybody else's) and gives each service its own offset", () => {
    expect(BASE_DEFAULT).toBe(4100);
    const offsets = Object.values(SERVICES).map(s => s.offset);
    expect(offsets).toEqual([...offsets.keys()]);
    const names = Object.values(SERVICES).map(s => s.env);
    expect(new Set(names).size).toBe(names.length);
  });

  it('resolves the documented defaults', () => {
    expect(resolvePorts({})).toEqual({
      base: 4100,
      api: 4100,
      webProxy: 4101,
      webWebform: 4102,
      webPublicurl: 4103,
      mint: 4104,
      handler: 4105,
      live: 4106,
      liveMint: 4107,
      liveHandler: 4108,
      smoke: 4109,
    });
  });

  it('moves every service with the base', () => {
    const ports = resolvePorts({ [BASE_VAR]: '4300' });
    expect(ports.base).toBe(4300);
    for (const [key, { offset }] of Object.entries(SERVICES)) {
      expect(ports[key]).toBe(4300 + offset);
    }
  });

  it('lets a service override its own port without moving the others', () => {
    const ports = resolvePorts({ LIVE_PORT: '4010', ESIGN_PORT_BASE: '4300' });
    expect(ports.live).toBe(4010);
    expect(ports.api).toBe(4300);
    expect(ports.smoke).toBe(4309);
  });

  it('ignores an empty variable', () => {
    expect(baseFrom({ [BASE_VAR]: '' })).toBe(BASE_DEFAULT);
    expect(resolvePorts({ MINT_PORT: '' }).mint).toBe(4104);
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

  it('accepts the edges of the range', () => {
    expect(portFrom('X', '1', 9)).toBe(1);
    expect(portFrom('X', '65535', 9)).toBe(65535);
  });
});

describe('envLines', () => {
  it('exports the base and every service variable with its resolved value', () => {
    expect(envLines({ HANDLER_PORT: '9000' })).toEqual([
      'export ESIGN_PORT_BASE=4100',
      'export ESIGN_API_PORT=4100',
      'export ESIGN_WEB_PORT=4101',
      'export ESIGN_WEB_WEBFORM_PORT=4102',
      'export ESIGN_WEB_PUBLICURL_PORT=4103',
      'export MINT_PORT=4104',
      'export HANDLER_PORT=9000',
      'export LIVE_PORT=4106',
      'export LIVE_MINT_PORT=4107',
      'export LIVE_HANDLER_PORT=4108',
      'export SMOKE_PORT=4109',
    ]);
  });
});

// The services cannot import this module (a browser tsconfig, a Docker
// image, a React Native bundle), so each declares its own offset as a
// literal. These checks keep those literals on the table.
describe('the consumers', () => {
  const { base, api, mint, handler } = resolvePorts({});

  it.each([
    ['packages/esign-service/src/port.ts', `PORT_BASE_DEFAULT = ${base}`],
    [
      'packages/esign-service/src/port.ts',
      `PORT_OFFSET = ${SERVICES.api.offset}`,
    ],
    [
      'examples/mint-only-demo/src/index.ts',
      `PORT_OFFSET = ${SERVICES.mint.offset}`,
    ],
    ['examples/mint-only-demo/src/index.ts', `PORT_BASE_DEFAULT = ${base}`],
    [
      'examples/serverless-handler-demo/src/index.ts',
      `PORT_OFFSET = ${SERVICES.handler.offset}`,
    ],
    [
      'examples/serverless-handler-demo/src/index.ts',
      `PORT_BASE_DEFAULT = ${base}`,
    ],
    ['examples/react-native-demo/src/config.ts', `PORT_BASE_DEFAULT = ${base}`],
    ['examples/react-demo/src/config.ts', `http://localhost:${api}`],
    ['examples/react-demo/e2e/ports.ts', `BASE_DEFAULT = ${base}`],
    ['packages/esign-node/src/registry.ts', `http://localhost:${api}`],
    ['packages/esign-service/Dockerfile', `EXPOSE ${api}`],
    ['packages/esign-service/Dockerfile', `\${PORT:-${api}}`],
    ['scripts/ci/docker-smoke.sh', `CONTAINER_PORT="\${2:-${api}}"`],
    ['examples/mint-only-demo/Dockerfile', `EXPOSE ${mint}`],
    ['examples/mint-only-demo/Dockerfile', `\${PORT:-${mint}}`],
    ['Makefile', `docker-smoke.sh esign-mint-only-demo ${mint}`],
    [
      '.github/workflows/e2e.yml',
      `docker-smoke.sh esign-mint-only-demo ${mint}`,
    ],
    ['packages/esign-service/.env.example', `PORT=${api}`],
    ['examples/mint-only-demo/.env.example', `PORT=${mint}`],
    ['examples/serverless-handler-demo/.env.example', `PORT=${handler}`],
  ])('%s carries %s', (file, literal) => {
    expect(read(file)).toContain(literal);
  });

  it('the Playwright module maps the web modes onto the web offsets', () => {
    const source = read('examples/react-demo/e2e/ports.ts');
    expect(source).toContain(`proxy: ${SERVICES.webProxy.offset}`);
    expect(source).toContain(`webform: ${SERVICES.webWebform.offset}`);
    expect(source).toContain(`publicurl: ${SERVICES.webPublicurl.offset}`);
    expect(source).toContain(`API_OFFSET = ${SERVICES.api.offset}`);
  });
});
