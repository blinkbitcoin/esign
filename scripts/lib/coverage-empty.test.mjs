import { describe, expect, it } from 'vitest';
import { emptyCoverageFiles, formatEmptyFiles } from './coverage-empty.mjs';

const metrics = total => ({
  statements: { total, covered: total, pct: 100 },
  lines: { total, covered: total, pct: 100 },
});

describe('emptyCoverageFiles', () => {
  it('lists files whose statement total is zero and skips the totals row', () => {
    const summary = {
      total: metrics(0),
      '/w/src/a.ts': metrics(12),
      '/w/src/index.ts': metrics(0),
      '/w/src/types.ts': { statements: { total: 0 } },
    };
    expect(emptyCoverageFiles(summary)).toEqual([
      '/w/src/index.ts',
      '/w/src/types.ts',
    ]);
  });

  it('ignores malformed rows', () => {
    expect(emptyCoverageFiles({ '/w/x.ts': {}, '/w/y.ts': null })).toEqual([]);
  });
});

describe('formatEmptyFiles', () => {
  it('names the workspace, the file and the fix', () => {
    expect(formatEmptyFiles('packages/x', ['/w/src/index.ts'])).toEqual([
      'packages/x: /w/src/index.ts has no statements to cover - exclude it from coverage in the workspace config (re-export / type-only module)',
    ]);
    expect(formatEmptyFiles('packages/x', [])).toEqual([]);
  });
});
