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

  it('prioritizes forum threads when the query asks for reddit or discussion sources', () => {
    const selected = selectCandidates({
      query: 'reddit discussions about self hosted search tools',
      results: [
        { title: 'Generic blog', url: 'https://example.com/blog', snippet: '' },
        { title: 'Reddit thread', url: 'https://www.reddit.com/r/selfhosted/comments/abc/example/', snippet: '' },
        { title: 'Forum topic', url: 'https://forum.example.com/topic/123', snippet: '' }
      ],
      seenUrls: new Set(),
      maxCandidates: 2
    });

    expect(selected.map((item) => item.url)).toEqual([
      'https://www.reddit.com/r/selfhosted/comments/abc/example/',
      'https://forum.example.com/topic/123'
    ]);
  });

  it('drops excluded hosts and their subdomains before ranking or the candidate budget', () => {
    const selected = selectCandidates({
      query: 'coverage -site:Example.COM./docs, -site:blocked.test',
      results: [
        { title: 'Excluded parent', url: 'https://example.com/guide', snippet: '' },
        { title: 'Excluded subdomain', url: 'https://docs.example.com/guide', snippet: '' },
        { title: 'Excluded second host', url: 'https://blocked.test/guide', snippet: '' },
        { title: 'Lookalike', url: 'https://notexample.com/guide', snippet: '' },
        { title: 'Suffix lookalike', url: 'https://example.com.evil/guide', snippet: '' },
        { title: 'Allowed', url: 'https://allowed.test/guide', snippet: '' }
      ],
      seenUrls: new Set(),
      maxCandidates: 3
    });

    expect(selected.map((item) => item.url)).toEqual([
      'https://notexample.com/guide',
      'https://example.com.evil/guide',
      'https://allowed.test/guide'
    ]);
  });

  it('leaves positive site operators to the search backend', () => {
    expect(selectCandidates({
      query: 'coverage site:vitest.dev',
      results: [{ title: 'Backend result', url: 'https://example.com/guide', snippet: '' }],
      seenUrls: new Set(),
      maxCandidates: 1
    }).map((item) => item.url)).toEqual(['https://example.com/guide']);
  });
});
