import { describe, expect, it } from 'vitest';
import { planSearchQueries } from '../../src/orchestration/query-planner.js';

describe('planSearchQueries', () => {
  it('returns the original query for the first pass', () => {
    expect(
      planSearchQueries({
        originalQuery: 'Find current Vitest coverage docs for V8 provider',
        passIndex: 0,
        previousQueries: [],
        gaps: []
      })
    ).toEqual(['Find current Vitest coverage docs for V8 provider']);
  });

  it('adds targeted official-docs query on later passes', () => {
    expect(
      planSearchQueries({
        originalQuery: 'Find current Vitest coverage docs for V8 provider',
        passIndex: 1,
        previousQueries: ['Find current Vitest coverage docs for V8 provider'],
        gaps: ['Need official docs or API reference.']
      })
    ).toContain('site:vitest.dev Vitest coverage docs V8 provider');
  });

  it('does not repeat previous queries', () => {
    expect(
      planSearchQueries({
        originalQuery: 'DuckDuckGo HTML scraping Node.js pitfalls',
        passIndex: 1,
        previousQueries: [
          'DuckDuckGo HTML scraping Node.js pitfalls',
          'site:github.com DuckDuckGo HTML scraping Node.js pitfalls'
        ],
        gaps: ['Need implementation references.']
      })
    ).not.toContain('site:github.com DuckDuckGo HTML scraping Node.js pitfalls');
  });
});
