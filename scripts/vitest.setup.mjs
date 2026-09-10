// Tests are silent. Every logger in this repo is injectable and React warns
// through console.error, so a console line during a test is a bug: a
// missing logger injection, or a state update outside act(). Record every
// call and fail the test that made it; a test that expects logging spies on
// the method itself (vi.spyOn(console, 'error')) and thereby opts out.

import { afterEach, beforeEach, vi } from 'vitest';

const METHODS = ['error', 'warn', 'log'];

let calls = [];
let spies = [];

beforeEach(() => {
  calls = [];
  spies = METHODS.map(method =>
    vi.spyOn(console, method).mockImplementation((...args) => {
      calls.push(`console.${method}: ${args.map(String).join(' ')}`);
    }),
  );
});

afterEach(() => {
  for (const spy of spies) {
    spy.mockRestore();
  }
  if (calls.length > 0) {
    const lines = calls.splice(0);
    throw new Error(
      `unexpected console output during the test:\n${lines.join('\n')}`,
    );
  }
});
