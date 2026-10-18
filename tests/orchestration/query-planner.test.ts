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

  it('keeps a negated site: exclusion on every follow-up', () => {
    const queries = planSearchQueries({ originalQuery: 'React API -site:stackoverflow.com', passIndex: 1, previousQueries: ['React API -site:stackoverflow.com'], gaps: ['Need implementation references.'] });
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(query.split(' ').filter((token) => token === '-site:stackoverflow.com')).toHaveLength(1);
  });

  it('does not send edge cases to learn.microsoft.com', () => {
    for (const originalQuery of ['edge cases in React', 'knowledge base for the team']) {
      const queries = planSearchQueries({ originalQuery, passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
      expect(queries.join('\n'), originalQuery).not.toContain('learn.microsoft.com');
    }
  });

  it('still routes Microsoft Edge questions to learn.microsoft.com', () => {
    const queries = planSearchQueries({ originalQuery: 'Microsoft Edge policy for extensions', passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
    expect(queries[0]).toBe('site:learn.microsoft.com Microsoft Edge policy extensions');
  });
});

describe('planSearchQueries keeps the user site operators', () => {
  const originals = [
    '-site:github.com Vitest coverage',
    'site:github.com React API version compatibility',
    'site:vitest.dev -site:github.com coverage thresholds'
  ];
  const gaps = [
    'Need supported version details.',
    'Need exact API behavior.',
    'Sources disagree about the recommendation.',
    'Need user experience.',
    'Need official docs.',
    'Need implementation references.',
    'Need comparison evidence for target: Vue'
  ];
  const tokens = (query: string) => query.split(' ').map((token) => token.toLowerCase());

  for (const originalQuery of originals) {
    const userOperators = originalQuery.split(' ').filter((token) => /^-?site:/i.test(token));
    const positive = userOperators.find((token) => !token.startsWith('-'));
    const excluded = userOperators.filter((token) => token.startsWith('-')).map((token) => token.slice(1).toLowerCase());

    it(`keeps ${JSON.stringify(userOperators)} exactly once on every follow-up of "${originalQuery}"`, () => {
      for (const passIndex of [1, 2]) {
        for (const gap of gaps) {
          const queries = planSearchQueries({ originalQuery, passIndex, previousQueries: [], gaps: [gap] });
          expect(queries.length, `${passIndex} ${gap}`).toBeGreaterThan(0);
          for (const query of queries) {
            const parts = tokens(query);
            for (const operator of userOperators) {
              expect(parts.filter((token) => token === operator.toLowerCase()), query).toHaveLength(1);
            }
            const positives = parts.filter((token) => /^site:/.test(token));
            expect(positives.length, query).toBeLessThanOrEqual(1);
            if (positive) expect(positives, query).toEqual([positive.toLowerCase()]);
            for (const host of excluded) expect(parts, query).not.toContain(`site:${host}`);
          }
        }
      }
    });
  }

  it('adds no site: operator to a query the user did not scope', () => {
    const queries = planSearchQueries({ originalQuery: 'Compare React and Vue', passIndex: 2, previousQueries: [], gaps: ['Need supported version details.'] });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.join('\n')).not.toContain('site:');
  });
});

describe('Microsoft Edge routing', () => {
  const edgeQueries = [
    'How do I configure Edge extensions?',
    'Edge browser policies for kiosk mode',
    'Edge group policy for homepage',
    'Edge add-ons store publishing',
    'Edge devtools protocol',
    'Edge webview2 runtime setup',
    'Edge enterprise sync settings',
    'Edge sidebar customization',
    'Edge profiles management',
    'msedge driver version',
    'Microsoft Edge policy for extensions'
  ];
  const notEdgeQueries = [
    'edge cases in vitest',
    'cutting edge tooling for Node',
    'edge-to-edge layout',
    'knowledge base for the team',
    'Vercel edge functions timeouts',
    'edge runtime limits',
    'edge network latency'
  ];

  it.each(edgeQueries)('routes "%s" to learn.microsoft.com', (originalQuery) => {
    const queries = planSearchQueries({ originalQuery, passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
    expect(queries[0]).toMatch(/^site:learn\.microsoft\.com /);
  });

  it.each(notEdgeQueries)('does not route "%s" to learn.microsoft.com', (originalQuery) => {
    const queries = planSearchQueries({ originalQuery, passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
    expect(queries.join('\n')).not.toContain('learn.microsoft.com');
  });
});

describe('planSearchQueries operators inside punctuation', () => {
  const cases: Array<{ originalQuery: string; positive?: string; excluded: string[] }> = [
    { originalQuery: 'React API (site:react.dev)', positive: 'site:react.dev', excluded: [] },
    { originalQuery: 'React API (-site:github.com)', excluded: ['github.com'] },
    { originalQuery: '"site:vitest.dev" coverage', positive: 'site:vitest.dev', excluded: [] },
    { originalQuery: 'coverage [site:vitest.dev]', positive: 'site:vitest.dev', excluded: [] },
    { originalQuery: 'docs,site:vitest.dev coverage', positive: 'site:vitest.dev', excluded: [] },
    { originalQuery: 'Vitest coverage (-site:GitHub.com)', excluded: ['GitHub.com'] }
  ];
  const gaps = [
    'Need supported version details.',
    'Need exact API behavior.',
    'Sources disagree about the recommendation.',
    'Need user experience.',
    'Need official docs.',
    'Need implementation references.',
    'Need comparison evidence for target: Vue'
  ];

  for (const { originalQuery, positive, excluded } of cases) {
    it(`keeps the operators of "${originalQuery}" as clean tokens on every follow-up`, () => {
      for (const passIndex of [1, 2]) {
        for (const gap of gaps) {
          const queries = planSearchQueries({ originalQuery, passIndex, previousQueries: [], gaps: [gap] });
          expect(queries.length, `${passIndex} ${gap}`).toBeGreaterThan(0);
          for (const query of queries) {
            const parts = query.split(' ').map((token) => token.toLowerCase());
            expect(query, query).not.toMatch(/\(\s*\)|\[\s*\]|""|[()[\]"]/);
            const positives = parts.filter((token) => /^site:/.test(token));
            expect(positives.length, query).toBeLessThanOrEqual(1);
            if (positive) expect(positives, query).toEqual([positive.toLowerCase()]);
            for (const host of excluded) {
              expect(parts.filter((token) => token === `-site:${host.toLowerCase()}`), query).toHaveLength(1);
              expect(parts, query).not.toContain(`site:${host.toLowerCase()}`);
            }
          }
        }
      }
    });
  }

  it('does not read website: or mysite: as operators', () => {
    for (const originalQuery of ['website:foo.com coverage', 'mysite:foo.com coverage']) {
      const queries = planSearchQueries({ originalQuery, passIndex: 2, previousQueries: [], gaps: ['Need official docs.'] });
      for (const query of queries) expect(query.split(' ').some((token) => /^-?site:/i.test(token)), query).toBe(false);
    }
  });
});

describe('Microsoft Edge driver and update routing', () => {
  it.each([
    'Edge WebDriver version mismatch',
    'edge driver path on Linux',
    'msedgedriver not found',
    'Edge updates blocked by policy',
    'Edge update channels',
    'Edge Insider builds',
    'Edge for Business licensing'
  ])('routes "%s" to learn.microsoft.com', (originalQuery) => {
    const queries = planSearchQueries({ originalQuery, passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
    expect(queries[0]).toMatch(/^site:learn\.microsoft\.com /);
  });

  it.each(['edge cases in vitest', 'cutting edge tooling for Node', 'edge-to-edge layout', 'knowledge base for the team', 'Vercel edge functions timeouts', 'edge runtime limits', 'edge network latency'])(
    'still does not route "%s" to learn.microsoft.com',
    (originalQuery) => {
      const queries = planSearchQueries({ originalQuery, passIndex: 1, previousQueries: [], gaps: ['Need official docs.'] });
      expect(queries.join('\n')).not.toContain('learn.microsoft.com');
    }
  );
});
