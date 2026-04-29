import { describe, expect, it } from 'vitest';
import { buildExplorePresentation } from '../../src/presentation/explore-presentation.js';

describe('buildExplorePresentation', () => {
  it('builds one compact body plus richer optional views', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: ['Use channel', 'Treat executablePath as fallback'],
      sources: [
        { title: 'Browsers | Playwright', url: 'https://playwright.dev/docs/browsers', method: 'http' },
        { title: 'BrowserType | Playwright', url: 'https://playwright.dev/docs/api/class-browsertype', method: 'headless' }
      ],
      caveat: undefined,
      metadata: {
        searchPasses: 2,
        fetchedPages: 5,
        headlessAttempts: 1,
        exhaustedBudget: false
      }
    });

    expect(presentation.views.compact).toBe('Reviewed 2 sources · synthesized answer with 2 findings');
    expect(presentation.views.preview).toContain('- [web_fetch] Use channel');
    expect(presentation.views.preview).toContain('- [web_fetch_headless] Treat executablePath as fallback');
    expect(presentation.views.preview).toContain('Internal research: web_search ×2');
    expect(presentation.views.verbose).toContain('Sources');
    expect(presentation.views.verbose).toContain('- [web_fetch_headless] BrowserType | Playwright: https://playwright.dev/docs/api/class-browsertype');
    expect(presentation.views.verbose).toContain('Internal tools');
  });

  it('says when no usable evidence was found in preview and verbose views', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: [],
      sources: [],
      metadata: {
        searchPasses: 2,
        fetchedPages: 4,
        headlessAttempts: 0,
        exhaustedBudget: true
      }
    });

    expect(presentation.views.compact).toBe('No usable evidence found');
    expect(presentation.views.preview).toContain('No usable evidence found.');
    expect(presentation.views.verbose).toContain('No usable evidence found.');
  });

  it('keeps invalid-query errors concise', () => {
    const presentation = buildExplorePresentation({
      status: 'error',
      findings: [],
      sources: [],
      error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
    });

    expect(presentation.views.compact).toBe('Research failed: Query must not be empty.');
  });
});
