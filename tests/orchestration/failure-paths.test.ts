import { describe, expect, it, vi } from 'vitest';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';
import type { WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../../src/types.js';

const searchError = (kind: string, code = 'X'): WebSearchResponse => ({
  status: 'error',
  results: [],
  metadata: { backend: 'duckduckgo', cacheHit: false },
  error: { code, message: `search ${kind}`, failure: { kind: kind as any } }
});

const searchOk = (urls: string[], coverage?: WebSearchResponse['metadata']['coverage']): WebSearchResponse => ({
  status: 'ok',
  results: urls.map((url) => ({ title: url, url, snippet: '' })),
  metadata: { backend: 'duckduckgo', cacheHit: false, ...(coverage ? { coverage } : {}) }
});

const readable = (url: string): WebFetchResponse => ({
  status: 'ok',
  url,
  metadata: { method: 'http', cacheHit: false },
  content: { title: 'Doc', text: 'Official documentation text that is long enough to count as real evidence for the query.' }
});

function run(search: any, fetchPage: any, headlessFetch: any, query = 'how to configure the thing') {
  return createWebExploreTool({ explore: createResearchWorkflow({ search, fetchPage, headlessFetch }) })({ query });
}

describe('failure paths through orchestration (#55)', () => {
  it('a terminal search failure ends the run as an error: no fetch, no headless, one search', async () => {
    const search = vi.fn(async () => searchError('config_global', 'BACKEND_CONFIG_INVALID'));
    const fetchPage = vi.fn();
    const headlessFetch = vi.fn();

    const result = await run(search, fetchPage, headlessFetch);

    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('config_global');
    expect(search).toHaveBeenCalledTimes(1);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(headlessFetch).not.toHaveBeenCalled();
  });

  it('a guard-refused page from search results is never escalated to headless', async () => {
    const refused: WebFetchResponse = {
      status: 'error',
      url: 'http://10.0.0.8/',
      metadata: { method: 'http', cacheHit: false },
      error: { code: 'BLOCKED_PRIVATE_ADDRESS', message: 'Blocked', failure: { kind: 'guard_refused' } }
    };
    const headlessFetch = vi.fn();
    await run(vi.fn(async () => searchOk(['http://10.0.0.8/'])), vi.fn(async () => refused), headlessFetch);
    expect(headlessFetch).not.toHaveBeenCalled();
  });

  it('a guard-refused direct URL is never escalated to headless', async () => {
    const refused: WebFetchResponse = {
      status: 'error',
      url: 'http://169.254.169.254/latest/meta-data/',
      metadata: { method: 'http', cacheHit: false },
      error: { code: 'BLOCKED_PRIVATE_ADDRESS', message: 'Blocked', failure: { kind: 'guard_refused' } }
    };
    const headlessFetch = vi.fn();
    await run(vi.fn(async () => searchOk([])), vi.fn(async () => refused), headlessFetch, 'read http://169.254.169.254/latest/meta-data/');
    expect(headlessFetch).not.toHaveBeenCalled();
  });

  it('partial search coverage adds exactly one caveat sentence', async () => {
    const coverage = { partial: true as const, unavailable: [{ provider: 'brave', kind: 'rate_limited' as const }] };
    const urls = ['https://docs.a.test/x', 'https://docs.b.test/y', 'https://docs.c.test/z'];
    const result = await run(
      vi.fn(async () => searchOk(urls, coverage)),
      vi.fn(async ({ url }: { url: string }) => readable(url)),
      vi.fn(async () => ({} as WebFetchHeadlessResponse))
    );
    expect(result.status).toBe('ok');
    const matches = (result.caveat ?? '').match(/some search backends were unavailable/gi) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('a fully successful empty search adds no coverage caveat', async () => {
    const result = await run(vi.fn(async () => searchOk([])), vi.fn(), vi.fn());
    expect(result.caveat ?? '').not.toMatch(/search backends were unavailable/i);
  });
});
