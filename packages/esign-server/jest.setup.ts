// Tests are silent. Every logger in this repo is injectable and React warns
// through console.error, so a console line during a test is a bug: a
// missing logger injection, or a state update outside act(). Record every
// call and fail the test that made it; a test that expects logging spies on
// the method itself (jest.spyOn(console, 'error')) and thereby opts out.

type ConsoleMethod = 'error' | 'warn' | 'log';
const METHODS: ConsoleMethod[] = ['error', 'warn', 'log'];

let calls: string[] = [];
let spies: jest.SpyInstance[] = [];

beforeEach(() => {
  calls = [];
  spies = METHODS.map(method =>
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
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
