import { describe, expect, it, vi } from 'vitest';
import { createWebExploreTool } from '../../src/tools/web-explore.js';

describe('web_explore tool', () => {
  it('returns clean findings, sources, and no caveat when evidence is sufficient', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: {
          action: 'answer',
          rationale: 'Enough evidence.',
          approvedEvidence: [
            {
              title: 'Browsers | Playwright',
              url: 'https://playwright.dev/docs/browsers',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Use channel for branded browsers.',
              supports: ['Use channel']
            },
            {
              title: 'BrowserType | Playwright',
              url: 'https://playwright.dev/docs/api/class-browsertype',
              sourceKind: 'official-api',
              method: 'http',
              summary: 'executablePath is supported but use at your own risk.',
              supports: ['executablePath is risky']
            }
          ]
        },
        evidence: [
          {
            title: 'Browsers | Playwright',
            url: 'https://playwright.dev/docs/browsers',
            sourceKind: 'official-docs',
            method: 'http',
            summary: 'Use channel for branded browsers.',
            supports: ['Use channel']
          },
          {
            title: 'BrowserType | Playwright',
            url: 'https://playwright.dev/docs/api/class-browsertype',
            sourceKind: 'official-api',
            method: 'http',
            summary: 'executablePath is supported but use at your own risk.',
            supports: ['executablePath is risky']
          }
        ],
        workerPass: {
          searchQueries: ['playwright installed edge executablePath vs channel'],
          evidence: [],
          gaps: [],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        }
      })
    });

    const result = await webExplore({
      query: 'Find current docs or discussions about Playwright launching an installed Chrome or Edge executable instead of a bundled browser, then summarize the recommended approach.'
    });

    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([
      'Use channel for branded browsers.',
      'executablePath is supported but use at your own risk.'
    ]);
    expect(result.sources).toEqual([
      {
        title: 'Browsers | Playwright',
        url: 'https://playwright.dev/docs/browsers',
        method: 'http'
      },
      {
        title: 'BrowserType | Playwright',
        url: 'https://playwright.dev/docs/api/class-browsertype',
        method: 'http'
      }
    ]);
    expect(result.caveat).toBeUndefined();
    expect(result.presentation?.views.compact).toBe(
      'Reviewed 2 sources · synthesized answer with 2 findings'
    );
    expect(result.presentation?.views.preview).toContain('Use channel for branded browsers.');
    expect(result).not.toHaveProperty('text');
  });

  it('returns a caveat when only partial evidence is available', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: {
          action: 'research-again',
          rationale: 'Evidence is partial.',
          followupQuery: 'same query'
        },
        evidence: [
          {
            title: 'Coverage | Guide | Vitest',
            url: 'https://vitest.dev/guide/coverage.html',
            sourceKind: 'official-docs',
            method: 'headless',
            summary: 'Set coverage.provider to v8 and install @vitest/coverage-v8.',
            supports: ['provider: v8', 'install @vitest/coverage-v8']
          }
        ],
        workerPass: {
          searchQueries: ['vitest coverage docs'],
          evidence: [],
          gaps: [{ kind: 'needs-more-evidence', message: 'Only one strong source was gathered.' }],
          lowValueOutcomes: [],
          suggestedHeadlessUrl: undefined,
          exhaustedBudget: false
        }
      })
    });

    const result = await webExplore({
      query: 'Find the current Vitest coverage docs and tell me how to enable coverage with the V8 provider in a TypeScript project.'
    });

    expect(result.status).toBe('ok');
    expect(result.findings).toEqual([
      'Set coverage.provider to v8 and install @vitest/coverage-v8.'
    ]);
    expect(result.sources).toEqual([
      {
        title: 'Coverage | Guide | Vitest',
        url: 'https://vitest.dev/guide/coverage.html',
        method: 'headless'
      }
    ]);
    expect(result.caveat).toBe('Evidence is partial, so this answer is based on the strongest source found within the bounded research budget.');
    expect(result.presentation?.views.compact).toBe(
      'Reviewed 1 sources · synthesized answer with 1 findings'
    );
  });

  it('rejects empty exploration queries', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn()
    });

    await expect(webExplore({ query: '   ' })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_QUERY' }
    });
  });

  it('does not leak raw internal worker bookkeeping into visible output', async () => {
    const webExplore = createWebExploreTool({
      explore: vi.fn().mockResolvedValue({
        decision: {
          action: 'research-again',
          rationale: 'Not enough evidence.',
          followupQuery: 'same query'
        },
        evidence: [
          {
            title: 'Source A',
            url: 'https://example.com/a',
            sourceKind: 'community',
            method: 'http',
            summary: 'A concise summary.',
            supports: ['detail a']
          }
        ],
        workerPass: {
          searchQueries: ['q1'],
          evidence: [],
          gaps: [{ kind: 'needs-more-evidence', message: 'Need more.' }],
          lowValueOutcomes: [{ kind: 'empty-search', message: 'No more results.' }],
          suggestedHeadlessUrl: 'https://example.com/b',
          exhaustedBudget: false
        }
      })
    });

    const result = await webExplore({ query: 'example query' });

    expect(JSON.stringify(result)).not.toContain('searchQueries');
    expect(JSON.stringify(result)).not.toContain('lowValueOutcomes');
    expect(JSON.stringify(result)).not.toContain('suggestedHeadlessUrl');
    expect(result.findings).toEqual(['Community/practical context: A concise summary.']);
    expect(result.presentation?.views.preview).toContain('- [web_fetch] Community/practical context: A concise summary.');
  });
});
