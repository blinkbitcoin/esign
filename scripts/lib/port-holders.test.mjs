import { describe, expect, it } from 'vitest';
import {
  METRO_PORT,
  freePlan,
  holders,
  ownerOf,
  parseCwds,
  parseDockerPs,
  parseLsofListeners,
  renderPorts,
} from './port-holders.mjs';
import { SERVICES, resolvePorts } from './ports.mjs';

const LSOF = [
  'p692',
  'crapportd',
  'f11',
  'n*:49433',
  'f12',
  'n*:49433',
  'p18025',
  'cnode',
  'f12',
  'n127.0.0.1:4300',
  'f13',
  'n[::1]:4300',
  'f14',
  'n*:8081',
  'p2000',
  'ccom.docke',
  'f80',
  'n*:4312',
  '',
].join('\n');

const CWDS = [
  'p18025',
  'fcwd',
  'n/Users/x/Dev/esign-topic',
  'p2000',
  'fcwd',
  'n/',
  '',
].join('\n');

const DOCKER = [
  'esign-topic-postgres-test-1\t0.0.0.0:4312->5432/tcp, [::]:4312->5432/tcp\tesign-topic\t/Users/x/Dev/esign-topic\t/Users/x/Dev/esign-topic/docker-compose.test.yml',
  'esign-other-dev-postgres-1\t0.0.0.0:4333->5432/tcp\tesign-other-dev\t/Users/x/Dev/esign-other\t/Users/x/Dev/esign-other/packages/esign-service/docker-compose.yml',
  'blink-for-woocommerce-db-1\t3306/tcp, 33060/tcp\tblink-for-woocommerce\t/Users/x/Dev/blink\t',
  'lonely\t\t\t\t',
  '',
].join('\n');

const WORKTREES = [
  { path: '/Users/x/Dev/esign', isMain: true },
  { path: '/Users/x/Dev/esign-topic', isMain: false },
  { path: '/Users/x/Dev/esign-other', isMain: false },
];
const SELF = '/Users/x/Dev/esign-topic';

describe('the lsof parsers', () => {
  it('lists one listener per pid and port, IPv4 and IPv6 collapsed', () => {
    expect(parseLsofListeners(LSOF)).toEqual([
      { pid: 692, command: 'rapportd', port: 49433 },
      { pid: 18025, command: 'node', port: 4300 },
      { pid: 18025, command: 'node', port: 8081 },
      { pid: 2000, command: 'com.docke', port: 4312 },
    ]);
    expect(parseLsofListeners('')).toEqual([]);
  });

  it('maps pids to their working directories', () => {
    expect([...parseCwds(CWDS)]).toEqual([
      [18025, '/Users/x/Dev/esign-topic'],
      [2000, '/'],
    ]);
  });
});

describe('parseDockerPs', () => {
  it('reads the host ports and the compose labels of each container', () => {
    expect(parseDockerPs(DOCKER)).toEqual([
      {
        name: 'esign-topic-postgres-test-1',
        hostPorts: [4312],
        project: 'esign-topic',
        workingDir: '/Users/x/Dev/esign-topic',
        configFiles: '/Users/x/Dev/esign-topic/docker-compose.test.yml',
      },
      {
        name: 'esign-other-dev-postgres-1',
        hostPorts: [4333],
        project: 'esign-other-dev',
        workingDir: '/Users/x/Dev/esign-other',
        configFiles:
          '/Users/x/Dev/esign-other/packages/esign-service/docker-compose.yml',
      },
      {
        name: 'blink-for-woocommerce-db-1',
        hostPorts: [],
        project: 'blink-for-woocommerce',
        workingDir: '/Users/x/Dev/blink',
        configFiles: '',
      },
      {
        name: 'lonely',
        hostPorts: [],
        project: '',
        workingDir: '',
        configFiles: '',
      },
    ]);
  });
});

describe('ownerOf', () => {
  it.each([
    ['/Users/x/Dev/esign-topic', 'this worktree'],
    ['/Users/x/Dev/esign-topic/packages/esign-service', 'this worktree'],
    ['/Users/x/Dev/esign-topical', 'foreign'],
    ['/Users/x/Dev/esign-other/examples', 'worktree esign-other'],
    ['/Users/x/Dev/esign', 'worktree esign'],
    ['/', 'foreign'],
    [undefined, 'foreign'],
  ])('%s belongs to %s', (dir, owner) => {
    expect(ownerOf(dir, { worktrees: WORKTREES, self: SELF })).toBe(owner);
  });
});

const rowsOf = (env = { ESIGN_PORT_BASE: '4300' }) =>
  holders({
    ports: resolvePorts(env),
    listeners: parseLsofListeners(LSOF),
    cwds: parseCwds(CWDS),
    containers: parseDockerPs(DOCKER),
    worktrees: WORKTREES,
    self: SELF,
  });

describe('holders', () => {
  it('gives every service of the block a row, plus Metro', () => {
    const rows = rowsOf();
    expect(rows.map(r => r.service)).toEqual([
      ...Object.keys(SERVICES),
      'metro',
    ]);
    expect(rows.find(r => r.service === 'webProxy')).toEqual({
      service: 'webProxy',
      env: 'ESIGN_WEB_PORT',
      what: 'react-demo, proxy mode',
      port: 4301,
      holder: undefined,
    });
  });

  it('names the process on a port with its owner', () => {
    expect(rowsOf().find(r => r.service === 'api').holder).toEqual({
      kind: 'process',
      label: 'node (pid 18025)',
      pid: 18025,
      owner: 'this worktree',
    });
    expect(rowsOf().find(r => r.service === 'metro')).toMatchObject({
      port: METRO_PORT,
      global: true,
      holder: { kind: 'process', pid: 18025, owner: 'this worktree' },
    });
  });

  it('prefers the container over the docker proxy process lsof sees', () => {
    expect(rowsOf().find(r => r.service === 'testDb').holder).toEqual({
      kind: 'container',
      label: 'esign-topic-postgres-test-1 (compose esign-topic)',
      project: 'esign-topic',
      configFiles: '/Users/x/Dev/esign-topic/docker-compose.test.yml',
      owner: 'this worktree',
    });
    const other = rowsOf({ ESIGN_PORT_BASE: '4320' }).find(
      r => r.service === 'devDb',
    );
    expect(other.holder).toMatchObject({
      kind: 'container',
      owner: 'worktree esign-other',
    });
  });

  it('labels a container without a compose project by its name', () => {
    const rows = holders({
      ports: resolvePorts({}),
      listeners: [],
      cwds: new Map(),
      containers: [
        {
          name: 'adhoc',
          hostPorts: [4100],
          project: '',
          workingDir: '',
          configFiles: '',
        },
      ],
      worktrees: WORKTREES,
      self: SELF,
    });
    expect(rows[0].holder).toMatchObject({ label: 'adhoc', owner: 'foreign' });
  });
});

describe('renderPorts', () => {
  it('prints the block, then one aligned line per row', () => {
    const lines = renderPorts(rowsOf(), {
      base: 4300,
      source: '.env.local',
      self: SELF,
    });
    expect(lines[0]).toBe(
      'port block 4300 (.env.local) - /Users/x/Dev/esign-topic',
    );
    expect(lines[1]).toBe('service       port   holder');
    expect(lines).toContain(
      'api           4300   node (pid 18025) [this worktree]',
    );
    expect(lines).toContain('webProxy      4301   -');
    expect(lines).toContain(
      'testDb        4312   esign-topic-postgres-test-1 (compose esign-topic) [this worktree]',
    );
    expect(lines.at(-1)).toBe(
      'metro         8081   node (pid 18025) [this worktree]',
    );
  });
});

describe('freePlan', () => {
  const foreignMetro = {
    service: 'metro',
    port: 8081,
    holder: {
      kind: 'process',
      label: 'node (pid 7)',
      pid: 7,
      owner: 'foreign',
    },
  };
  const siblingDb = {
    service: 'devDb',
    port: 4313,
    holder: {
      kind: 'container',
      label: 'esign-other-dev-postgres-1 (compose esign-other-dev)',
      project: 'esign-other-dev',
      configFiles: '/x/docker-compose.yml',
      owner: 'worktree esign-other',
    },
  };

  it('stops what is ours - one action per pid or compose project - and keeps the rest with a reason', () => {
    const { stop, keep } = freePlan([...rowsOf(), foreignMetro, siblingDb]);
    expect(stop).toEqual([
      { kind: 'kill', pid: 18025, label: 'node (pid 18025)' },
      {
        kind: 'compose-down',
        project: 'esign-topic',
        configFiles: '/Users/x/Dev/esign-topic/docker-compose.test.yml',
        label: 'esign-topic-postgres-test-1 (compose esign-topic)',
      },
    ]);
    expect(keep).toEqual([
      {
        service: 'metro',
        port: 8081,
        label: 'node (pid 7)',
        reason: 'not this repo - stop it yourself',
      },
      {
        service: 'devDb',
        port: 4313,
        label: 'esign-other-dev-postgres-1 (compose esign-other-dev)',
        reason: 'worktree esign-other - FORCE=1 stops it',
      },
    ]);
  });

  it("stops a sibling worktree's leftovers with force, never a foreign process", () => {
    const { stop, keep } = freePlan([foreignMetro, siblingDb], { force: true });
    expect(stop).toEqual([
      {
        kind: 'compose-down',
        project: 'esign-other-dev',
        configFiles: '/x/docker-compose.yml',
        label: 'esign-other-dev-postgres-1 (compose esign-other-dev)',
      },
    ]);
    expect(keep).toEqual([expect.objectContaining({ service: 'metro' })]);
  });

  it('keys a container without a project by its label', () => {
    const adhoc = {
      service: 'api',
      port: 4100,
      holder: {
        kind: 'container',
        label: 'adhoc',
        project: '',
        configFiles: '',
        owner: 'this worktree',
      },
    };
    expect(freePlan([adhoc, { ...adhoc, port: 4101 }]).stop).toHaveLength(1);
  });
});
