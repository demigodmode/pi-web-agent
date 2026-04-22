import { describe, expect, it } from 'vitest';
import { buildSearchPresentation } from '../../src/presentation/search-presentation.js';

describe('buildSearchPresentation', () => {
  it('builds compact, preview, and verbose search views', () => {
    const presentation = buildSearchPresentation({
      status: 'ok',
      results: [
        { title: 'Example One', url: 'https://example.com/one', snippet: 'First snippet' },
        { title: 'Example Two', url: 'https://example.com/two', snippet: 'Second snippet' }
      ],
      metadata: { backend: 'duckduckgo', cacheHit: false }
    });

    expect(presentation.views.compact).toBe('Found 2 results');
    expect(presentation.views.preview).toContain('1. Example One');
    expect(presentation.views.verbose).toContain('First snippet');
  });

  it('builds concise error compact output', () => {
    const presentation = buildSearchPresentation({
      status: 'error',
      results: [],
      metadata: { backend: 'duckduckgo', cacheHit: false },
      error: { code: 'NO_RESULTS', message: 'DuckDuckGo returned no usable results for this query.' }
    });

    expect(presentation.views.compact).toBe(
      'Search failed: DuckDuckGo returned no usable results for this query.'
    );
  });
});
