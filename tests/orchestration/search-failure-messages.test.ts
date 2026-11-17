import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';
import { chainSearch, withSearchPolicy } from '../../src/backends/fallback-policy.js';
import { createProviderHealth } from '../../src/backends/provider-health.js';
import { createDegoogSearchTool } from '../../src/search/degoog.js';
import { createSearxngSearchTool } from '../../src/search/searxng.js';
import extension from '../../src/extension.js';
import type { WebFetchResponse } from '../../src/types.js';

const policy = () => ({ health: createProviderHealth(), sleep: vi.fn(async () => undefined), random: () => 0 });

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function htmlResponse() {
  return new Response('<!doctype html><html><body>Not the API</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
}

type Search = NonNullable<Parameters<typeof createResearchWorkflow>[0]>['search'];

function publicTool(search: NonNullable<Search>) {
  const workflow = createResearchWorkflow({ search, fetchPage: vi.fn(async ({ url }: { url: string }): Promise<WebFetchResponse> => ({ status: 'error', url, metadata: { method: 'http', cacheHit: false }, error: { code: 'FETCH_FAILED', message: 'unused' } })), headlessFetch: vi.fn() });
  const tools: any[] = [];
  extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: createWebExploreTool({ explore: workflow }) } as never);
  return { workflow, tool: tools[0] };
}

describe('provider failure text when every search fails', () => {
  const cases: Array<{ name: string; provider: 'degoog' | 'searxng'; fetchImpl: typeof fetch; message: string }> = [
    {
      name: 'a degoog path that 404s',
      provider: 'degoog',
      fetchImpl: vi.fn(async () => jsonResponse({ error: 'not found' }, 404)) as unknown as typeof fetch,
      message: 'Degoog search request failed: HTTP 404. Check the base URL.'
    },
    {
      name: 'a degoog URL that answers with an HTML page',
      provider: 'degoog',
      fetchImpl: vi.fn(async () => htmlResponse()) as unknown as typeof fetch,
      message: 'Degoog returned something other than search results. Check the base URL.'
    },
    {
      name: 'degoog engines that all failed',
      provider: 'degoog',
      fetchImpl: vi.fn(async () => jsonResponse({ results: [], engineTimings: [{ name: 'Brave', status: 'error', errorReason: 'rate_limited' }, { name: 'DuckDuckGo', status: 'timeout' }] })) as unknown as typeof fetch,
      message: 'Degoog returned no results because its engines failed: Brave (rate_limited), DuckDuckGo (timeout).'
    },
    {
      name: 'a SearXNG path that 404s',
      provider: 'searxng',
      fetchImpl: vi.fn(async () => jsonResponse({ error: 'not found' }, 404)) as unknown as typeof fetch,
      message: 'SearXNG search request failed: HTTP 404'
    }
  ];

  for (const { name, provider, fetchImpl, message } of cases) {
    it(`names the provider and its own message for ${name}, once, in the model text and every view`, async () => {
      const deps = policy();
      const primary = provider === 'degoog'
        ? createDegoogSearchTool({ baseUrl: 'https://search.example.invalid', fetchImpl })
        : createSearxngSearchTool({ baseUrl: 'https://search.example.invalid', fetchImpl });
      const search = chainSearch([withSearchPolicy(provider, primary, deps)], deps);
      const { workflow, tool } = publicTool(search);
      try {
        const output = await tool.execute('call-1', { query: 'how to configure the thing' }, undefined, vi.fn());
        const notice = `Search failed (${provider}): ${message.endsWith('.') ? message : `${message}.`}`;
        expect(output.details.searchFailures).toEqual([{ provider, message }]);
        expect(output.content[0].text.split(notice)).toHaveLength(2);
        expect(output.content[0].text).toContain('No usable evidence found.');
        for (const view of ['compact', 'preview', 'verbose'] as const) {
          expect(output.details.presentation.views[view].split(notice)).toHaveLength(2);
        }
      } finally {
        await workflow.close();
      }
    });
  }

  it('keeps the plain no-evidence text when another search answered, even with no results', async () => {
    const deps = policy();
    const degoog = createDegoogSearchTool({ baseUrl: 'https://search.example.invalid', fetchImpl: vi.fn(async () => jsonResponse({ error: 'not found' }, 404)) as unknown as typeof fetch });
    const empty = vi.fn(async () => ({ status: 'ok' as const, results: [], metadata: { backend: 'duckduckgo' as const, cacheHit: false } }));
    const search = chainSearch([withSearchPolicy('degoog', degoog, deps), withSearchPolicy('duckduckgo', empty, deps)], deps);
    const { workflow, tool } = publicTool(search);
    try {
      const output = await tool.execute('call-1', { query: 'how to configure the thing' }, undefined, vi.fn());
      expect(output.details.searchFailures).toBeUndefined();
      expect(output.content[0].text).not.toContain('Search failed');
      expect(output.content[0].text).toContain('No usable evidence found.');
    } finally {
      await workflow.close();
    }
  });
});
