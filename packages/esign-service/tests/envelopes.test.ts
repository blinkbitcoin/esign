// The envelope capability's transport adapters. The routes themselves are
// covered end to end in app.test.ts; this covers the shape Apollo can answer
// with that this schema never produces.

import { graphQLResponseBody } from '../src/envelopes';

describe('graphQLResponseBody', () => {
  it('returns a complete body as it is', async () => {
    await expect(graphQLResponseBody({ kind: 'complete', string: '{"data":{}}' })).resolves.toBe(
      '{"data":{}}'
    );
  });

  it('concatenates an incremental (@defer/@stream) body', async () => {
    const asyncIterator = (async function* chunks() {
      yield '{"data"';
      yield ':{}}';
    })();

    await expect(graphQLResponseBody({ kind: 'chunked', asyncIterator })).resolves.toBe(
      '{"data":{}}'
    );
  });
});
