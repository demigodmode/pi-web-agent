import { describe, expect, it } from 'vitest';
import { buildExplorePresentation } from '../../src/presentation/explore-presentation.js';

describe('buildExplorePresentation', () => {
  it('builds one compact body plus richer optional views', () => {
    const presentation = buildExplorePresentation({
      status: 'ok',
      findings: ['Use channel', 'Treat executablePath as fallback'],
      sources: [
        { title: 'Browsers | Playwright', url: 'https://playwright.dev/docs/browsers' },
        { title: 'BrowserType | Playwright', url: 'https://playwright.dev/docs/api/class-browsertype' }
      ],
      caveat: undefined
    });

    expect(presentation.views.compact).toBe('Reviewed 2 sources · synthesized answer with 2 findings');
    expect(presentation.views.preview).toContain('- Use channel');
    expect(presentation.views.verbose).toContain('Sources');
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
