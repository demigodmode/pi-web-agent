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

  it.each([
    ['Need comparison evidence for target: Vue', 'Vue comparison evidence'],
    ['Need supported version details.', 'release notes'],
    ['Need exact API behavior.', 'API reference'],
    ['Sources disagree about the recommendation.', 'disputed'],
    ['Need user experience.', 'user experience']
  ])('uses the gap "%s" to plan a focused follow-up', (gap, expected) => {
    const queries = planSearchQueries({ originalQuery: 'Compare React and Vue', passIndex: 1, previousQueries: ['Compare React and Vue'], gaps: [gap] });
    expect(queries.some((query) => query.includes(expected))).toBe(true);
  });

  it('produces a distinct later query when the first follow-up was already tried', () => {
    const first = planSearchQueries({ originalQuery: 'React API', passIndex: 1, previousQueries: ['React API'], gaps: ['Need exact API behavior.'] });
    const later = planSearchQueries({ originalQuery: 'React API', passIndex: 2, previousQueries: ['React API', ...first], gaps: ['Need exact API behavior.'] });
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((query) => !first.includes(query))).toBe(true);
  });
});
