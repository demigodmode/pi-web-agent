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

describe('planSearchQueries site operators', () => {
  const siteCount = (query: string) => query.match(/site:/gi)?.length ?? 0;
  const originals = [
    'site:vitest.dev vitest coverage docs',
    'site:github.com DuckDuckGo HTML scraping pitfalls',
    'Find vitest coverage site:vitest.dev/guide',
    'Compare React and Vue site:reddit.com',
    'React API site:github.com',
    'Find current Vitest coverage docs for V8 provider',
    'how to use the Edge browser policy'
  ];
  const gaps = [
    'Need official docs or API reference.',
    'Need implementation references.',
    'Need exact API behavior.',
    'Need user experience.',
    'Need comparison evidence for target: Vue',
    'Sources disagree about the recommendation.'
  ];

  it('never generates a query with two site: operators', () => {
    for (const originalQuery of originals) {
      for (let passIndex = 0; passIndex <= 3; passIndex++) {
        for (const gap of gaps) {
          const queries = planSearchQueries({ originalQuery, passIndex, previousQueries: [], gaps: [gap] });
          for (const query of queries) expect(siteCount(query), query).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('keeps the user site: operator exactly once in follow-ups and adds none', () => {
    const queries = [
      ...planSearchQueries({ originalQuery: 'site:vitest.dev vitest coverage docs', passIndex: 1, previousQueries: [], gaps: ['Need official docs.', 'Need implementation references.'] }),
      ...planSearchQueries({ originalQuery: 'site:github.com DuckDuckGo HTML scraping pitfalls', passIndex: 2, previousQueries: [], gaps: ['Need implementation references.', 'Need user experience.'] })
    ];
    expect(queries.length).toBeGreaterThan(0);
    expect(queries).toContain('site:vitest.dev vitest coverage docs');
    for (const query of queries) {
      expect(siteCount(query), query).toBeLessThanOrEqual(1);
      expect(query).not.toMatch(/site:(?!vitest\.dev|github\.com)/);
    }
  });

  it('strips negated site: operators from the search terms', () => {
    const queries = planSearchQueries({ originalQuery: 'React API -site:stackoverflow.com', passIndex: 1, previousQueries: ['React API -site:stackoverflow.com'], gaps: ['Need implementation references.'] });
    expect(queries.join('\n')).not.toContain('-site:');
  });

  it('does not send edge cases to learn.microsoft.com', () => {
    for (const originalQuery of ['edge cases in vitest', 'edge cases in React', 'cutting edge tooling for Node', 'knowledge base for the team']) {
      const queries = planSearchQueries({ originalQuery, passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
      expect(queries.join('\n'), originalQuery).not.toContain('learn.microsoft.com');
    }
  });

  it('still routes Microsoft Edge questions to learn.microsoft.com', () => {
    const queries = planSearchQueries({ originalQuery: 'Microsoft Edge policy for extensions', passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
    expect(queries[0]).toBe('site:learn.microsoft.com Microsoft Edge policy extensions');
  });
});
