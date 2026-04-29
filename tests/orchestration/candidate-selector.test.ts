import { describe, expect, it } from 'vitest';
import { selectCandidates } from '../../src/orchestration/candidate-selector.js';
import type { SearchResult } from '../../src/types.js';

const results: SearchResult[] = [
  { title: 'Blog', url: 'https://example.com/blog', snippet: 'community' },
  { title: 'Vitest Coverage', url: 'https://vitest.dev/guide/coverage.html', snippet: 'official docs' },
  { title: 'npm package', url: 'https://www.npmjs.com/package/@vitest/coverage-v8', snippet: 'package' },
  { title: 'Vitest Coverage duplicate', url: 'https://vitest.dev/guide/coverage.html', snippet: 'duplicate' }
];

describe('selectCandidates', () => {
  it('dedupes urls and prefers official docs', () => {
    expect(selectCandidates({ results, seenUrls: new Set(), maxCandidates: 3 }).map((item) => item.url)).toEqual([
      'https://vitest.dev/guide/coverage.html',
      'https://example.com/blog',
      'https://www.npmjs.com/package/@vitest/coverage-v8'
    ]);
  });

  it('skips already seen urls', () => {
    expect(
      selectCandidates({
        results,
        seenUrls: new Set(['https://vitest.dev/guide/coverage.html']),
        maxCandidates: 3
      }).map((item) => item.url)
    ).not.toContain('https://vitest.dev/guide/coverage.html');
  });
});
