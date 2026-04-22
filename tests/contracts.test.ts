import { describe, expect, it } from 'vitest';
import type {
  PresentationEnvelope,
  PresentationMode,
  PresentationConfig
} from '../src/presentation/types.js';
import { DEFAULT_PRESENTATION_CONFIG } from '../src/presentation/config.js';
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

  it('allows per-tool mode overrides', () => {
    const config: PresentationConfig = {
      defaultMode: 'compact',
      allowExpansion: true,
      preview: { maxItems: 3, maxChars: 240 },
      verbose: { maxItems: 5 },
      showMetrics: true,
      tools: {
        web_search: { mode: 'preview' }
      }
    };

    expect(config.tools.web_search?.mode).toBe('preview');
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
