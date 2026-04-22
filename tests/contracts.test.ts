import { describe, expect, it } from 'vitest';
import type {
  PresentationEnvelope,
  PresentationMode,
  PresentationConfig,
  PresentationConfigFile,
  PresentationToolOverrideMode
} from '../src/presentation/types.js';
import {
  DEFAULT_PRESENTATION_CONFIG,
  mergePresentationConfigLayers,
  normalizePresentationConfigFile,
  resolvePresentationMode
} from '../src/presentation/config.js';
import {
  TOOL_STATUSES,
  type ToolStatus,
  type SearchResult,
  type WebSearchResponse,
  type WebFetchResponse,
  type WebFetchHeadlessResponse
} from '../src/types.js';
import extension from '../src/extension.js';

describe('presentation contracts', () => {
  it('defines compact as the default mode and exposes all supported modes', () => {
    const envelope: PresentationEnvelope = {
      mode: 'compact',
      views: {
        compact: 'Found 2 results in 0.2s',
        preview: '1. Example',
        verbose: 'Top results (2)\n1. Example'
      }
    };

    expect(envelope.mode satisfies PresentationMode).toBe('compact');
    expect(DEFAULT_PRESENTATION_CONFIG.defaultMode).toBe('compact');
  });

  it('treats missing tool overrides as inherit', () => {
    const config: PresentationConfig = {
      defaultMode: 'preview',
      tools: {}
    };

    expect(resolvePresentationMode('web_fetch', config)).toBe('preview');
  });

  it('normalizes a config file with valid overrides', () => {
    const file: PresentationConfigFile = {
      presentation: {
        defaultMode: 'verbose',
        tools: {
          web_search: { mode: 'preview' },
          web_fetch: { mode: 'compact' }
        }
      }
    };

    expect(normalizePresentationConfigFile(file)).toEqual({
      defaultMode: 'verbose',
      tools: {
        web_search: { mode: 'preview' },
        web_fetch: { mode: 'compact' }
      }
    });
  });

  it('merges defaults, then global, then project', () => {
    expect(
      mergePresentationConfigLayers(
        { defaultMode: 'compact', tools: {} },
        {
          defaultMode: 'preview',
          tools: { web_explore: { mode: 'verbose' } }
        },
        {
          defaultMode: 'preview',
          tools: { web_search: { mode: 'compact' } }
        }
      )
    ).toEqual({
      defaultMode: 'preview',
      tools: {
        web_explore: { mode: 'verbose' },
        web_search: { mode: 'compact' }
      }
    });
  });

  it('filters invalid tool override values instead of crashing', () => {
    const normalized = normalizePresentationConfigFile({
      presentation: {
        defaultMode: 'compact',
        tools: {
          web_search: { mode: 'preview' },
          web_fetch: { mode: 'loud' as PresentationToolOverrideMode }
        }
      }
    });

    expect(normalized).toEqual({
      defaultMode: 'compact',
      tools: {
        web_search: { mode: 'preview' }
      }
    });
  });
});

describe('shared tool contracts', () => {
  it('exposes the allowed tool statuses', () => {
    expect(TOOL_STATUSES).toEqual([
      'ok',
      'needs_headless',
      'blocked',
      'unsupported',
      'error'
    ]);
  });

  it('allows normalized search results', () => {
    const result: SearchResult = {
      title: 'Example',
      url: 'https://example.com',
      snippet: 'Example snippet'
    };

    expect(result.url).toContain('https://');
  });

  it('shapes search and fetch responses around status + metadata', () => {
    const search: WebSearchResponse = {
      status: 'ok',
      results: [],
      metadata: { backend: 'duckduckgo', cacheHit: false }
    };

    const fetch: WebFetchResponse = {
      status: 'needs_headless',
      url: 'https://example.com',
      metadata: { method: 'http', cacheHit: false }
    };

    const headless: WebFetchHeadlessResponse = {
      status: 'error',
      url: 'https://example.com',
      metadata: { method: 'headless', cacheHit: false },
      error: { code: 'NOT_IMPLEMENTED', message: 'stub' }
    };

    expect(search.status satisfies ToolStatus).toBe('ok');
    expect(fetch.status).toBe('needs_headless');
    expect(headless.metadata.method).toBe('headless');
  });
});

describe('extension surface', () => {
  it('exports a Pi extension function', () => {
    expect(typeof extension).toBe('function');
  });
});

describe('headless metadata', () => {
  it('allows headless metadata to carry browser and navigation timing', () => {
    const headless: WebFetchHeadlessResponse = {
      status: 'ok',
      url: 'https://example.com',
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: 'chrome',
        navigationMs: 1500
      },
      content: { text: 'Rendered text' }
    };

    expect(headless.metadata.browser).toBe('chrome');
    expect(headless.metadata.navigationMs).toBe(1500);
  });
});
