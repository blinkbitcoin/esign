import { noopTracing, type SpanLike } from '../tracing';

describe('noopTracing', () => {
  it('runs the callback with an inert span and returns its result', async () => {
    let seen: SpanLike | undefined;
    const result = await noopTracing.withSpan(
      'esign.test',
      { 'esign.attr': 'value' },
      async span => {
        seen = span;
        expect(span.setAttribute('k', 'v')).toBeUndefined();
        expect(span.setAttribute('n', 1)).toBeUndefined();
        expect(span.setAttribute('b', true)).toBeUndefined();
        return 'done';
      },
    );
    expect(result).toBe('done');
    expect(seen).toBeDefined();
  });

  it('propagates a rejection from the callback', async () => {
    await expect(
      noopTracing.withSpan('esign.test', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
