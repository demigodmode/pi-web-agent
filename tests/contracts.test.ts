import { describe, expect, it } from 'vitest';
import {
  TOOL_STATUSES,
  type ToolStatus,
  type SearchResult,
  type WebSearchResponse,
  type WebFetchResponse,
  type WebFetchHeadlessResponse
} from '../src/types.js';
import extension from '../src/extension.js';

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
