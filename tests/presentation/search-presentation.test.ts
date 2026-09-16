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

  it('shows search fallback in compact output', () => {
    const presentation = buildSearchPresentation({
      status: 'ok',
      results: [{ title: 'Example', url: 'https://example.com', snippet: 'Fallback result' }],
      metadata: { backend: 'duckduckgo', cacheHit: false, fallbackFrom: 'searxng', fallbackReason: 'down' }
    });

    expect(presentation.views.compact).toBe('searxng failed; used duckduckgo fallback. Found 1 result');
  });

  it('shows skipped providers on an all-failed fanout search', () => {
    const p = buildSearchPresentation({
      status: 'error',
      results: [],
      metadata: { backend: 'brave', cacheHit: false, fanout: { mode: 'on', providers: [], skipped: ['brave', 'exa'] } },
      error: { code: 'FANOUT_NO_RESULTS', message: 'No fanout provider returned usable results.' }
    });
    expect(p.views.compact as string).toContain('(fanout; skipped: brave, exa)');
  });

  it('shows contributing providers on a successful fanout search', () => {
    const p = buildSearchPresentation({
      status: 'ok',
      results: [{ title: 't', url: 'https://a.com', snippet: 's' }],
      metadata: { backend: 'duckduckgo', cacheHit: false, fanout: { mode: 'on', providers: ['duckduckgo', 'brave'] } }
    });
    expect(p.views.compact as string).toContain('(fanout: duckduckgo, brave)');
  });

  it('lists skipped attempts in verbose only', () => {
    const presentation = buildSearchPresentation({
      status: 'ok',
      results: [{ title: 'Example One', url: 'https://example.com/one', snippet: 'First snippet' }],
      metadata: {
        backend: 'duckduckgo',
        cacheHit: false,
        attempts: [
          { backend: 'brave', outcome: 'skipped', skipReason: 'cooling_down', failure: { kind: 'rate_limited' }, cooldownUntil: 0 },
          { backend: 'duckduckgo', outcome: 'results' }
        ]
      }
    });

    expect(presentation.views.verbose).toContain('brave: skipped [cooling_down] (rate_limited), cooling down until 1970-01-01T00:00:00.000Z');
    expect(presentation.views.verbose).not.toContain('duckduckgo: results');
    expect(presentation.views.compact).not.toContain('skipped');
    expect(presentation.views.preview).not.toContain('skipped');
  });
});
