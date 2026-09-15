// Tests are silent. Every logger in this repo is injectable and React warns
// through console.error, so a console line during a test is a bug: a
// missing logger injection, or a state update outside act(). Record every
// call and fail the test that made it; a test that expects logging spies on
// the method itself (vi.spyOn(console, 'error')) and thereby opts out.

import { afterEach, beforeEach, vi } from 'vitest';

// A worktree claims its own port block into .env.local and direnv exports
// ESIGN_PORT_BASE from it, so a developer's shell carries a base that is not
// the documented 4100 these tests assert. That is machine state, not a
// property of the code under test: drop it so a run means the same thing in
// a worktree, the main clone and CI. A test that exercises the derivation
// sets the variable itself, after this. Empty rather than deleted: every
// reader in the repo already treats an empty value as unset, and `delete`
// does not take on the sandboxed process.env Jest hands a test file.
process.env.ESIGN_PORT_BASE = '';

type ConsoleMethod = 'error' | 'warn' | 'log';
const METHODS: ConsoleMethod[] = ['error', 'warn', 'log'];

let calls: string[] = [];
let spies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  calls = [];
  spies = METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push(`console.${method}: ${args.map(String).join(' ')}`);
    })
  );
});

afterEach(() => {
  for (const spy of spies) {
    spy.mockRestore();
  }
  if (calls.length > 0) {
    const lines = calls.splice(0);
    throw new Error(`unexpected console output during the test:\n${lines.join('\n')}`);
  }
});
