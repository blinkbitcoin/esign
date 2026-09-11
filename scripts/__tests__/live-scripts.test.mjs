import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Drives the entry gate of the interactive live runs (scripts/e2e/live-web.sh,
// live-ios.sh, live-android.sh: they refuse to run without credentials) and
// the helpers of scripts/e2e/live-service.sh they share, against temp files
// and fake tools, never the real .env, Tailscale or a device.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// live-service.sh resolves the ports through node (ports-env.sh): a PATH
// without tailscale still needs node
const NO_TAILSCALE_PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
const LIVE_SERVICE_SH = join(REPO_ROOT, 'scripts/e2e/live-service.sh');
const RUNS = ['live-web.sh', 'live-ios.sh', 'live-android.sh'];

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'live-scripts-'));
  tempDirs.push(dir);
  return dir;
}

// A clean environment: the developer's own DOCUSIGN_* must never leak in
const cleanEnv = (env = {}) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...env,
});

function run(script, env = {}) {
  return spawnSync('bash', [join(REPO_ROOT, 'scripts/e2e', script)], {
    encoding: 'utf8',
    env: cleanEnv(env),
  });
}

// Sources live-service.sh from the repo root and runs one of its functions
function source(fn, env = {}) {
  return spawnSync(
    'bash',
    ['-c', `cd "${REPO_ROOT}" && . "${LIVE_SERVICE_SH}" && ${fn}`],
    { encoding: 'utf8', env: cleanEnv(env) },
  );
}

// A fake `tailscale` on PATH: `status --json` answers with the given DNS
// name; `funnel` records its arguments
function fakeTailscale(dnsName) {
  const bin = tempDir();
  const calls = join(bin, 'calls');
  writeFileSync(
    join(bin, 'tailscale'),
    [
      '#!/usr/bin/env bash',
      `echo "$*" >> "${calls}"`,
      `[ "$1" = status ] && echo '{"Self":{"DNSName":"${dnsName}"}}'`,
      'exit 0',
      '',
    ].join('\n'),
  );
  spawnSync('chmod', ['+x', join(bin, 'tailscale')]);
  return { bin, calls };
}

describe.each(RUNS)('scripts/e2e/%s', script => {
  it('refuses to run with neither a live .env nor DOCUSIGN_* in the environment', () => {
    const { status, stdout } = run(script, {
      LIVE_ENV_FILE: join(tempDir(), 'absent.env'),
    });
    expect(status).not.toBe(0);
    expect(stdout).toContain('absent.env (make docusign-env)');
    expect(stdout).toContain('no DOCUSIGN_* in the environment');
  });

  it('needs the rest of the DocuSign settings next to the integration key', () => {
    const { status, stderr } = run(script, {
      LIVE_ENV_FILE: join(tempDir(), 'absent.env'),
      DOCUSIGN_INTEGRATION_KEY: 'x',
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain('DOCUSIGN_USER_ID');
  });
});

describe('scripts/e2e/live-service.sh', () => {
  it('funnel_host is empty without tailscale and strips the trailing dot with it', () => {
    expect(
      source('funnel_host', { PATH: NO_TAILSCALE_PATH }).stdout.trim(),
    ).toBe('');
    const { bin } = fakeTailscale('mac.tail.ts.net.');
    expect(
      source('funnel_host', {
        PATH: `${bin}:${process.env.PATH}`,
      }).stdout.trim(),
    ).toBe('mac.tail.ts.net');
  });

  it('live_public_url takes LIVE_PUBLIC_URL as is and names the Connect target', () => {
    const { status, stdout } = source(
      'live_public_url && echo "url=$PUBLIC_BASE_URL"',
      { LIVE_PUBLIC_URL: 'https://esign.example.com', PATH: NO_TAILSCALE_PATH },
    );
    expect(status).toBe(0);
    expect(stdout).toContain(
      'register https://esign.example.com/webhook/esign in DocuSign Admin',
    );
    expect(stdout).toContain('url=https://esign.example.com');
  });

  it('live_public_url starts a funnel on LIVE_PORT when tailscale is logged in', () => {
    const { bin, calls } = fakeTailscale('mac.tail.ts.net.');
    const { status, stdout } = source(
      'live_public_url && echo "url=$PUBLIC_BASE_URL"',
      { PATH: `${bin}:${process.env.PATH}`, LIVE_PORT: '4306' },
    );
    expect(status).toBe(0);
    expect(stdout).toContain('url=https://mac.tail.ts.net');
    expect(readFileSync(calls, { encoding: 'utf8' })).toContain(
      'funnel --bg 4306',
    );
  });

  it('live_public_url warns and leaves PUBLIC_BASE_URL empty without a funnel', () => {
    const { status, stdout } = source(
      'live_public_url && echo "url=[$PUBLIC_BASE_URL]"',
      { PATH: NO_TAILSCALE_PATH },
    );
    expect(status).toBe(0);
    expect(stdout).toContain('::warning::no Tailscale Funnel');
    expect(stdout).toContain('url=[]');
  });
});
