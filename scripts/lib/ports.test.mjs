import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BASE_DEFAULT,
  BASE_VAR,
  BLOCK_SLOTS,
  BLOCK_STEP,
  SERVICES,
  baseFrom,
  claimedBase,
  devDatabaseUrl,
  envLines,
  nextFreeBase,
  parseWorktrees,
  portFrom,
  resolvePorts,
  testDatabaseUrl,
  withClaimedBase,
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

  it('fits a worktree block, and the blocks stay below 5000', () => {
    expect(Object.keys(SERVICES).length).toBeLessThanOrEqual(BLOCK_STEP);
    expect(
      BASE_DEFAULT + BLOCK_SLOTS * BLOCK_STEP + BLOCK_STEP,
    ).toBeLessThanOrEqual(5000);
  });

  it('lists every key in the type declaration', () => {
    const union = read('scripts/lib/ports.d.mts').match(
      /export type ServiceKey =([^;]*);/,
    )[1];
    const declared = [...union.matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);
    expect(declared).toEqual(Object.keys(SERVICES));
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
      service: 4110,
      terms: 4111,
      testDb: 4112,
      devDb: 4113,
    });
  });

  it('spells the database URLs for their ports', () => {
    expect(testDatabaseUrl(4112)).toBe(
      'postgresql://test:test@localhost:4112/esign_test',
    );
    expect(devDatabaseUrl(4313)).toBe(
      'postgresql://dev:dev@localhost:4313/esign',
    );
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
      'export SERVICE_PORT=4110',
      'export TERMS_PORT=4111',
      'export ESIGN_TEST_DB_PORT=4112',
      'export ESIGN_DEV_DB_PORT=4113',
      'export ESIGN_TEST_DATABASE_URL=postgresql://test:test@localhost:4112/esign_test',
      'export ESIGN_DEV_DATABASE_URL=postgresql://dev:dev@localhost:4113/esign',
    ]);
  });
});

// The services cannot import this module (a browser tsconfig, a Docker
// image, a React Native bundle), so each declares its own offset as a
// literal. These checks keep those literals on the table.
describe('the consumers', () => {
  const { base, api, mint, handler, testDb, devDb } = resolvePorts({});

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
    [
      'Makefile',
      'docker-smoke.sh esign-mint-only-demo $(shell node scripts/e2e/ports.mjs mint)',
    ],
    [
      '.github/workflows/e2e.yml',
      `docker-smoke.sh esign-mint-only-demo ${mint}`,
    ],
    ['packages/esign-service/.env.example', `PORT=${api}`],
    ['packages/esign-service/deploy/docker-compose.yml', `PORT: ${api}`],
    [
      'packages/esign-service/deploy/k8s/deployment.yaml',
      `containerPort: ${api}`,
    ],
    ['examples/mint-only-demo/.env.example', `PORT=${mint}`],
    ['examples/serverless-handler-demo/.env.example', `PORT=${handler}`],
    ['docker-compose.test.yml', `"\${ESIGN_TEST_DB_PORT:-${testDb}}:5432"`],
    [
      'packages/esign-service/docker-compose.yml',
      `"\${ESIGN_DEV_DB_PORT:-${devDb}}:5432"`,
    ],
    [
      'packages/esign-service/.env.test',
      `DATABASE_URL=${testDatabaseUrl(testDb)}`,
    ],
    ['packages/esign-service/.env.example', devDatabaseUrl(devDb)],
    ['scripts/ci/postgres-brew.sh', 'DB_PORT="$ESIGN_TEST_DB_PORT"'],
    [
      'examples/react-demo/e2e/ports.ts',
      `TEST_DB_OFFSET = ${SERVICES.testDb.offset}`,
    ],
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

describe("a worktree's block", () => {
  it('reads the worktrees of the porcelain listing, the main clone first', () => {
    const porcelain = [
      'worktree /Users/x/Dev/esign',
      'HEAD 0000000000000000000000000000000000000000',
      'branch refs/heads/main',
      '',
      'worktree /Users/x/Dev/esign-topic',
      'HEAD 1111111111111111111111111111111111111111',
      'detached',
      '',
    ].join('\n');
    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/Users/x/Dev/esign', isMain: true },
      { path: '/Users/x/Dev/esign-topic', isMain: false },
    ]);
    expect(parseWorktrees('')).toEqual([]);
  });

  it.each([
    ['ESIGN_PORT_BASE=4120\n', 4120],
    ['export ESIGN_PORT_BASE="4140" # mine\n', 4140],
    ["  ESIGN_PORT_BASE='4160'\n", 4160],
    ['# ESIGN_PORT_BASE=4120\nOTHER=1\n', undefined],
    ['ESIGN_PORT_BASE=4120\nESIGN_PORT_BASE=4180\n', 4180],
    ['ESIGN_PORT_BASE=\n', undefined],
    ['', undefined],
  ])('reads the claim in %j as %s', (text, base) => {
    expect(claimedBase(text)).toBe(base);
  });

  it('refuses a claim that is not a port', () => {
    expect(() => claimedBase('ESIGN_PORT_BASE=99999\n')).toThrow(
      /ESIGN_PORT_BASE must be a port number/,
    );
  });

  it('hands out the lowest free block above the default', () => {
    expect(nextFreeBase([])).toBe(4120);
    expect(nextFreeBase([4120, 4160])).toBe(4140);
    expect(nextFreeBase([4100, 4120, 4140])).toBe(4160);
    expect(nextFreeBase([4120], { base: 5100, step: 20, slots: 2 })).toBe(5120);
  });

  it('fails loudly when every block is claimed', () => {
    const all = Array.from(
      { length: BLOCK_SLOTS },
      (_, i) => BASE_DEFAULT + (i + 1) * BLOCK_STEP,
    );
    expect(() => nextFreeBase(all)).toThrow(/no free port block/);
  });

  it('appends the claim to .env.local, once', () => {
    const claimed = withClaimedBase('', 4120);
    expect(claimed).toBe(
      "# This worktree's port block (scripts/lib/ports.mjs; make ports shows it)\nESIGN_PORT_BASE=4120\n",
    );
    expect(withClaimedBase(claimed, 4120)).toBe(claimed);
    expect(withClaimedBase('OTHER=1', 4140)).toBe(
      "OTHER=1\n# This worktree's port block (scripts/lib/ports.mjs; make ports shows it)\nESIGN_PORT_BASE=4140\n",
    );
    expect(claimedBase(withClaimedBase('ESIGN_PORT_BASE=4120\n', 4160))).toBe(
      4160,
    );
  });
});
