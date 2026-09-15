// Rendering the environment contract. The shapes here are what the docs
// check compares against, so a change in either has to be deliberate.

// The real checker `make docs-check` runs, so this asserts the gate itself
// rather than an approximation of it
// @ts-expect-error - a plain .mjs helper, no types
import { MAX_LINE, overlongTableLines } from '../../../scripts/lib/table-lines.mjs';
import { REGISTRY } from '../src/env/registry';
import { renderDocTable, renderEnvExample, renderForTarget } from '../src/env/render';

describe('renderEnvExample', () => {
  const example = renderEnvExample();

  it('has a stanza for every variable', () => {
    for (const entry of REGISTRY) {
      expect(example).toContain(`# ${entry.name}=`);
    }
  });

  it('carries the how-to-obtain into the file an operator actually edits', () => {
    expect(example).toContain('How to obtain:');
    expect(example).toContain('.well-known/openid-configuration');
  });

  it('says either a default or when a variable is required', () => {
    expect(example).toContain('# Default:');
    expect(example).toContain('# Required:');
  });

  it('is entirely comments and assignments - nothing that would run', () => {
    for (const line of example.split('\n').filter(Boolean)) {
      expect(line.startsWith('#')).toBe(true);
    }
  });
});

describe('renderDocTable', () => {
  it('gives an operator the column the old tables never had', () => {
    expect(renderDocTable('operator')).toContain('| Variable | Why | When | How to obtain |');
  });

  it('lists operator variables and the shared ones, not backend-only ones', () => {
    const table = renderDocTable('operator');
    expect(table).toContain('`DOCUSIGN_INTEGRATION_KEY`');
    expect(table).toContain('`ESIGN_PROVIDER`');
    expect(table).not.toContain('`ESIGN_PORT_BASE`');
  });

  // make docs-check fails the build on a cell line over the house width, so
  // the renderer has to break them itself - checked with the real checker
  it.each(['operator', 'backend'] as const)(
    'passes the house table rule for the %s table',
    (audience) => {
      expect(overlongTableLines(renderDocTable(audience), MAX_LINE)).toEqual([]);
    }
  );

  it('escapes a pipe so a value cannot break the table', () => {
    expect(renderDocTable('operator')).not.toMatch(/[^\\|\s]\|[^|\s-]/);
  });

  it('marks a variable with no how-to-obtain rather than leaving a hole', () => {
    expect(renderDocTable('backend')).toContain('—');
  });
});

describe('renderForTarget', () => {
  it('omits what a Worker cannot do', () => {
    const edge = renderForTarget('cloudflare');
    expect(edge).not.toContain('DATABASE_URL');
    expect(edge).not.toContain('DOCUSIGN_PRIVATE_KEY_FILE');
    expect(edge).toContain('ESIGN_SESSION_JWKS_URL');
  });

  it('includes the container-only ones for node', () => {
    expect(renderForTarget('node')).toContain('DOCUSIGN_PRIVATE_KEY_FILE');
  });
});
