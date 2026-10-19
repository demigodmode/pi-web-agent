import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createBackendSet } from '../../src/backends/factory.js';
import { createHttpFetcher } from '../../src/fetch/http-fetch.js';
import { createNetworkGuard } from '../../src/fetch/network-guard.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';
import type { WebFetchResponse, WebSearchResponse } from '../../src/types.js';
import { chainSearch, withSearchPolicy } from '../../src/backends/fallback-policy.js';
import { createProviderHealth } from '../../src/backends/provider-health.js';
import extension from '../../src/extension.js';

describe('research workflow composition', () => {
  it('resolves three worker headless candidates after one successful escalation', async () => {
    const urls = ['https://a.example/one', 'https://b.example/two', 'https://c.example/three'];
    const workflow = createResearchWorkflow({
      search: async () => ({ status: 'ok' as const, results: urls.map((url) => ({ title: url, url, snippet: 'details' })), metadata: { backend: 'duckduckgo' as const, cacheHit: false } }),
      fetchPage: async ({ url }) => ({ status: 'needs_headless' as const, url, metadata: { method: 'http' as const, cacheHit: false } }),
      headlessFetch: async ({ url }) => ({ status: 'ok' as const, url, content: { text: 'Browser-rendered evidence.' }, metadata: { method: 'headless' as const, cacheHit: false } })
    });
    try {
      const result = await workflow.run({ query: 'How does this dynamic application work?' });
      expect(result.metadata.presentationStats).toMatchObject({ pagesRead: 1, failedReads: 2, methods: { headless: 1 } });
    } finally {
      await workflow.close();
    }
  });

  it('counts a typed repository and a separate GitHub issue by their read methods', async () => {
    const repoUrl = 'https://github.com/acme/widget';
    const issueUrl = 'https://github.com/acme/widget/issues/7';
    const workflow = createResearchWorkflow({
      search: async () => ({ status: 'ok' as const, results: [], metadata: { backend: 'duckduckgo' as const, cacheHit: false } }),
      fetchPage: async ({ url }) => ({ status: 'ok' as const, url, content: { text: 'Issue evidence.' }, metadata: { method: 'github' as const, cacheHit: false } }),
      headlessFetch: vi.fn(),
      researchRepo: async () => ({ ok: true as const, response: { status: 'ok' as const, url: repoUrl, content: { text: 'Repository evidence.' }, metadata: { method: 'github' as const, cacheHit: false } } })
    });
    try {
      const result = await workflow.run({ query: `Read ${repoUrl} and ${issueUrl}` });
      expect(result.metadata.presentationStats).toMatchObject({ pagesRead: 2, failedReads: 0, methods: { repo: 1, github: 1 } });
    } finally {
      await workflow.close();
    }
  });

  it('counts a failed worker candidate once without a successful page', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({ status: 'ok' as const, results: [{ title: 'Broken', url: 'https://broken.example/page', snippet: 'details' }], metadata: { backend: 'duckduckgo' as const, cacheHit: false } }),
      fetchPage: async ({ url }) => ({ status: 'error' as const, url, metadata: { method: 'http' as const, cacheHit: false }, error: { code: 'FETCH_FAILED', message: 'failed' } }),
      headlessFetch: vi.fn()
    });
    try {
      const result = await workflow.run({ query: 'Find broken page details' });
      expect(result.metadata.presentationStats).toMatchObject({ pagesRead: 0, failedReads: 1 });
    } finally {
      await workflow.close();
    }
  });

  it('does not count a failed typed repository as a read', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({ status: 'ok' as const, results: [], metadata: { backend: 'duckduckgo' as const, cacheHit: false } }),
      fetchPage: vi.fn(),
      headlessFetch: vi.fn(),
      researchRepo: async () => ({ ok: false as const, error: { code: 'REPO_FAILED', message: 'failed', failure: { kind: 'transient' as const } } })
    });
    try {
      const result = await workflow.run({ query: 'Read https://github.com/acme/widget' });
      expect(result.metadata.presentationStats).toMatchObject({ pagesRead: 0, failedReads: 1 });
    } finally {
      await workflow.close();
    }
  });

  it('keeps GitHub reader access failures explicit through the factory, workflow, and public research tool', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://search.invalid/')) {
        return new Response(JSON.stringify({ results: [{ title: 'Unrelated result', url: 'https://example.com/unrelated', content: 'This does not review the requested GitHub specification.' }] }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://api.github.com/repos/acme/private/issues/7') {
        if (new Headers(init?.headers).get('authorization') !== 'Bearer stubbed-gh-token') {
          return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ title: 'Private issue', body: 'Exact private issue text.' }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://api.github.com/repos/acme/private/issues/7/comments?per_page=100') {
        return new Response('[]', { headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://api.github.com/repos/acme/inaccessible/issues/8') {
        return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://example.com/unrelated') {
        return new Response('<html><title>Unrelated result</title><p>This does not review the requested GitHub specification.</p></html>', { headers: { 'content-type': 'text/html' } });
      }
      if (url === 'https://api.github.com/repos/acme/secret/readme') {
        return new Response(JSON.stringify({ download_url: 'https://raw.githubusercontent.com/acme/secret/main/README.md?token=private-secret' }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('https://raw.githubusercontent.com/acme/secret/main/README.md')) {
        return new Response('denied', { status: 401 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);
    const backends = createBackendSet(
      { search: { provider: 'searxng', baseUrl: 'https://search.invalid/' }, fetch: { provider: 'http' }, headless: { provider: 'local-browser' } },
      {
        networkGuard: createNetworkGuard({}, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
        createModelFetch: () => ((input, init) => globalThis.fetch(input, init)) as typeof fetch,
        createGuardProxy: vi.fn(async () => { throw new Error('offline test must not start a guard proxy'); }),
        resolveGithubToken: async () => ({ source: 'gh', token: 'stubbed-gh-token' }),
        policy: { sleep: async () => undefined, random: () => 0 }
      }
    );
    const workflow = createResearchWorkflow(backends);
    const tool = createWebExploreTool({ explore: workflow });

    try {
      const privateIssue = await tool({ query: 'Read https://github.com/acme/private/issues/7' });
      expect(privateIssue.findings.join('\n')).toContain('Exact private issue text.');
      const issueRequest = fetchImpl.mock.calls.find(([input]) => String(input) === 'https://api.github.com/repos/acme/private/issues/7');
      expect(new Headers(issueRequest?.[1]?.headers).get('authorization')).toBe('Bearer stubbed-gh-token');

      const inaccessibleIssue = await tool({ query: 'Research this specification and related findings https://github.com/acme/inaccessible/issues/8' });
      expect(inaccessibleIssue.requiredSourceFailures).toContainEqual(expect.objectContaining({
        url: 'https://github.com/acme/inaccessible/issues/8',
        code: 'GITHUB_FETCH_FAILED'
      }));
      expect(fetchImpl.mock.calls.some(([input]) => String(input) === 'https://example.com/unrelated')).toBe(true);
      expect(inaccessibleIssue.presentation.views.compact).toContain('The requirements of this source were not checked.');

      const privateReadme = await tool({ query: 'Read https://github.com/acme/secret' });
      type RegisteredTool = {
        name: string;
        execute: (toolCallId: string, params: { query: string }) => Promise<{ content: Array<{ type: string; text: string }> }>;
      };
      const registeredTools: RegisteredTool[] = [];
      // The extension's configured-workflow path is covered in extension.test.ts.
      // This injection isolates its model-result serialization from the factory/tool regression above.
      extension({
        registerTool: (registered: RegisteredTool) => registeredTools.push(registered),
        registerCommand: vi.fn(),
        on: vi.fn(),
        __webExploreTool: tool
      } as never);
      const extensionResult = await registeredTools.find((registered) => registered.name === 'web_explore')!.execute('call-1', { query: 'Read https://github.com/acme/secret' });
      const modelVisible = extensionResult.content[0]!.text;
      expect(privateReadme.requiredSourceFailures).toContainEqual(expect.objectContaining({ url: 'https://github.com/acme/secret' }));
      expect(modelVisible).not.toContain('private-secret');
      expect(modelVisible).not.toContain('Authorization');
    } finally {
      await workflow.close();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('keeps completed pages from a concurrent pass when another fetch reaches the deadline', async () => {
    vi.useFakeTimers();
    const completedUrl = 'https://a.example.com/guide';
    const pendingUrl = 'https://b.example.com/guide';
    let resolvePending!: (response: WebFetchResponse) => void;
    const fetchPage = vi.fn(({ url }: { url: string }) => url === completedUrl
      ? Promise.resolve({ status: 'ok' as const, url, content: { title: 'Completed guide', text: 'Useful completed guide evidence.' }, metadata: { method: 'http' as const, cacheHit: false } })
      : new Promise<WebFetchResponse>((resolve) => { resolvePending = resolve; }));
    const workflow = createResearchWorkflow({
      search: async () => ({ status: 'ok', results: [
        { title: 'Completed guide', url: completedUrl, snippet: 'Useful guide' },
        { title: 'Pending guide', url: pendingUrl, snippet: 'Useful guide' }
      ], metadata: { backend: 'duckduckgo', cacheHit: false } }),
      fetchPage,
      headlessFetch: vi.fn()
    });

    try {
      const run = createWebExploreTool({ explore: workflow })({ query: 'feature behavior' });
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchPage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await run;
      expect(result.metadata?.budgetReason).toBe('deadline');
      expect(result.findings).toContain('Useful completed guide evidence.');
      expect(result.sources.map((source) => source.url)).toContain(completedUrl);
    } finally {
      resolvePending?.({ status: 'ok', url: pendingUrl, content: { title: 'Pending guide', text: 'Late evidence' }, metadata: { method: 'http', cacheHit: false } });
      await workflow.close();
      vi.useRealTimers();
    }
  });

  it('counts direct links and later searches in one fetch budget', async () => {
    let searchIndex = 0;
    const search = vi.fn(async () => {
      const index = searchIndex++;
      return {
        status: 'ok' as const,
        results: Array.from({ length: 4 }, (_, page) => ({ title: `Result ${index}-${page}`, url: `https://host-${index}-${page}.example/page`, snippet: 'Details' })),
        metadata: { backend: 'duckduckgo' as const, cacheHit: false }
      };
    });
    const fetchPage = vi.fn(async ({ url }) => ({
      status: 'error' as const, url,
      metadata: { method: 'http' as const, cacheHit: false },
      error: { code: 'FETCH_FAILED', message: 'Could not read page', failure: { kind: 'transient' as const } }
    }));
    const workflow = createResearchWorkflow({ search, fetchPage, headlessFetch: vi.fn() });

    const result = await workflow.run({ query: 'Find docs at https://a.example/direct https://b.example/direct https://c.example/direct' });

    expect(search).toHaveBeenCalledTimes(4);
    expect(fetchPage).toHaveBeenCalledTimes(19);
    expect(result.metadata.budget).toMatchObject({ searches: 4, fetches: 19 });
    await workflow.close();
  });
  it('uses two readable supplied comparison sources without an extra search', async () => {
    const search = vi.fn(async () => ({ status: 'ok' as const, results: [], metadata: { backend: 'duckduckgo' as const, cacheHit: false } }));
    const workflow = createResearchWorkflow({
      search,
      fetchPage: async ({ url }) => ({ status: 'ok', url, content: { title: url, text: `Readable information from ${url}.` }, metadata: { method: 'pdf', cacheHit: false, truncated: false } }),
      headlessFetch: vi.fn()
    });

    const result = await workflow.run({ query: 'Compare https://example.com/a.pdf and https://example.com/b.pdf' });

    expect(search).not.toHaveBeenCalled();
    expect(result.evidence.map((item) => item.url)).toEqual(['https://example.com/a.pdf', 'https://example.com/b.pdf']);
  });

  it('names an uncovered comparison target in the public result', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({ status: 'ok', results: [
        { title: 'React guide A', url: 'https://react.dev/a', snippet: 'React details' },
        { title: 'React guide B', url: 'https://react.dev/b', snippet: 'React details' }
      ], metadata: { backend: 'duckduckgo', cacheHit: false } }),
      fetchPage: async ({ url }) => ({ status: 'ok', url, content: { title: 'React guide', text: 'React details.' }, metadata: { method: 'http', cacheHit: false, truncated: false } }),
      headlessFetch: vi.fn()
    });

    const result = await createWebExploreTool({ explore: workflow })({ query: 'Compare React and Vue' });
    expect(result.caveat).toContain('Vue');
  });
  it('can compose from backend config defaults', async () => {
    vi.resetModules();
    vi.doMock('../../src/backends/factory.js', () => ({
      createBackendSet: vi.fn(() => ({
        search: async () => ({
          status: 'ok',
          results: [],
          metadata: { backend: 'duckduckgo', cacheHit: false }
        }),
        fetchPage: async () => ({
          status: 'unsupported',
          url: 'https://example.com',
          metadata: { method: 'http', cacheHit: false, contentType: 'text/html' }
        }),
        headlessFetch: async () => ({
          status: 'error',
          url: 'https://example.com',
          metadata: { method: 'headless', cacheHit: false },
          error: { code: 'BROWSER_NOT_FOUND', message: 'No browser found.' }
        })
      }))
    }));

    const { createResearchWorkflow: createWorkflow } = await import('../../src/orchestration/index.js');
    const workflow = createWorkflow({
      backendConfig: {
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      }
    });

    const result = await workflow.run({ query: 'example query' });
    expect(result.decision.action).toBeDefined();
  });

  it('can compose the orchestrator from existing search and fetch capabilities', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({
        status: 'ok',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: async () => ({
        status: 'unsupported',
        url: 'https://example.com',
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html' }
      }),
      headlessFetch: async () => ({
        status: 'error',
        url: 'https://example.com',
        metadata: { method: 'headless', cacheHit: false },
        error: { code: 'BROWSER_NOT_FOUND', message: 'No browser found.' }
      })
    });

    const result = await workflow.run({ query: 'example query' });
    expect(result.decision.action).toBeDefined();
  });

  it('uses fetchPage for direct urls before relying on search', async () => {
    const fetchPage = vi.fn(async ({ url }) => ({
      status: 'ok' as const,
      url,
      content: {
        title: 'Direct page',
        text: 'Direct page content is readable and useful enough for the result.'
      },
      metadata: { method: 'http' as const, cacheHit: false, contentType: 'text/html', truncated: false }
    }));

    const workflow = createResearchWorkflow({
      search: async () => ({
        status: 'ok',
        results: [],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage,
      headlessFetch: async () => ({
        status: 'error',
        url: 'https://example.com',
        metadata: { method: 'headless', cacheHit: false },
        error: { code: 'BROWSER_NOT_FOUND', message: 'No browser found.' }
      })
    });

    const result = await workflow.run({ query: 'Read https://example.com/post?utm_source=x' });

    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/post',
      query: 'Read https://example.com/post?utm_source=x'
    }));
    expect(result.evidence[0]?.url).toBe('https://example.com/post');
  });

  it('keeps a late selected answer in final search-result findings with one HTTP request', async () => {
    const lateAnswer = 'Lunar archive transfer requires the signed manifest before upload.';
    const fetchImpl = vi.fn(async () => new Response(
      `<html><head><title>Archive guide</title></head><body><main><h1>Lunar archive transfer</h1><p>${'General archive background. '.repeat(250)}</p><p>${lateAnswer}</p></main></body></html>`,
      { headers: { 'content-type': 'text/html' } }
    ));
    const httpFetch = createHttpFetcher({ fetchImpl: fetchImpl as typeof fetch });
    const fetchPage = vi.fn(({ url, query }) => httpFetch(url, query));
    const search = vi.fn()
      .mockResolvedValueOnce({
        status: 'ok',
        results: [{ title: 'Archive guide', url: 'https://example.com/archive', snippet: 'Archive transfer details' }],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      })
      .mockResolvedValue({
        status: 'ok', results: [], metadata: { backend: 'duckduckgo', cacheHit: false }
      });
    const workflow = createResearchWorkflow({
      search,
      fetchPage,
      headlessFetch: async () => ({
        status: 'error', url: 'https://example.com/archive', metadata: { method: 'headless', cacheHit: false },
        error: { code: 'BROWSER_NOT_FOUND', message: 'No browser found.' }
      })
    });

    const result = await createWebExploreTool({ explore: workflow })({ query: 'lunar archive transfer manifest' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const fetched = await fetchPage.mock.results[0]?.value;
    expect(fetched.metadata.truncated).toBe(true);
    expect(fetched.content?.text).toContain(lateAnswer);
    expect(result.findings.join(' ')).toContain(lateAnswer);
  });

  it('does not turn a bot wall omitted by query selection into workflow evidence', async () => {
    const query = 'lunar archive transfer manifest';
    const fetchImpl = vi.fn(async () => new Response(
      `<html><head><title>Archive guide</title></head><body><main><h1>Lunar archive transfer manifest</h1><p>${'Lunar archive transfer manifest instructions. '.repeat(110)}</p><p>Performing security verification. Please verify you are not a bot.</p></main></body></html>`,
      { headers: { 'content-type': 'text/html' } }
    ));
    const httpFetch = createHttpFetcher({ fetchImpl: fetchImpl as typeof fetch });
    const search = vi.fn()
      .mockResolvedValueOnce({
        status: 'ok',
        results: [{ title: 'Archive guide', url: 'https://example.com/archive', snippet: 'Archive transfer details' }],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      })
      .mockResolvedValue({ status: 'ok', results: [], metadata: { backend: 'duckduckgo', cacheHit: false } });
    const workflow = createResearchWorkflow({
      search,
      fetchPage: ({ url, query: activeQuery }) => httpFetch(url, activeQuery),
      headlessFetch: async () => ({
        status: 'blocked', url: 'https://example.com/archive', metadata: { method: 'headless', cacheHit: false },
        error: { code: 'HEADLESS_EXTRACTION_WEAK', message: 'Rendered page did not produce enough readable content.' }
      })
    });

    const result = await workflow.run({ query });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.evidence).toHaveLength(0);
    expect(result.metadata?.caveatReasons).toContain('bot-check');
  });

  it('does not spend headless on a low-value npm package page when other technical sources exist', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({
        status: 'ok',
        results: [
          {
            title: 'ddg-search',
            url: 'https://github.com/camohiddendj/ddg-search',
            snippet: 'Node scraper'
          },
          {
            title: 'duck-duck-scrape - npm',
            url: 'https://www.npmjs.com/package/duck-duck-scrape',
            snippet: 'Package page'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: async ({ url }) => {
        if (url.includes('github.com/camohiddendj/ddg-search')) {
          return {
            status: 'ok',
            url,
            content: {
              title: 'ddg-search',
              text: 'DuckDuckGo HTML search scraper with bot-detection and pagination notes.'
            },
            metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
          };
        }

        return {
          status: 'needs_headless',
          url,
          metadata: { method: 'http', cacheHit: false, contentType: 'text/html' },
          error: { code: 'WEAK_EXTRACTION', message: 'Weak extraction.' }
        };
      },
      headlessFetch: async () => ({
        status: 'ok',
        url: 'https://www.npmjs.com/package/duck-duck-scrape',
        content: { title: 'Just a moment...', text: 'Security verification' },
        metadata: {
          method: 'headless',
          cacheHit: false,
          browser: 'edge',
          navigationMs: 4000,
          truncated: false
        }
      })
    });

    const result = await workflow.run({ query: 'duckduckgo scraping node pitfalls' });
    expect(result.decision.action).toBe('research-again');
  });

  it('produces enough approved evidence for web_explore to format a compact research result', async () => {
    const workflow = createResearchWorkflow({
      search: async () => ({
        status: 'ok',
        results: [
          {
            title: 'Coverage | Guide | Vitest',
            url: 'https://vitest.dev/guide/coverage.html',
            snippet: 'Coverage docs'
          },
          {
            title: 'coverage | Config | Vitest',
            url: 'https://vitest.dev/config/coverage',
            snippet: 'Coverage config'
          }
        ],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: async ({ url }) => ({
        status: 'ok',
        url,
        content: {
          title: url.includes('/config/') ? 'coverage | Config | Vitest' : 'Coverage | Guide | Vitest',
          text: url.includes('/config/')
            ? 'coverage.enabled and coverage.provider can be configured here.'
            : 'Set coverage.provider to v8 and install @vitest/coverage-v8.'
        },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      }),
      headlessFetch: async () => ({
        status: 'error',
        url: 'https://example.com',
        metadata: { method: 'headless', cacheHit: false },
        error: { code: 'BROWSER_NOT_FOUND', message: 'No browser found.' }
      })
    });

    const result = await workflow.run({ query: 'vitest coverage docs' });
    expect(result.decision.action).toBe('answer');
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('stops after unfamiliar documentation with an authority caveat', async () => {
    const search = vi.fn(async () => ({
      status: 'ok' as const,
      results: [
        { title: 'React reference', url: 'https://react.dev/reference/react/useEffect', snippet: 'Effect API' },
        { title: 'Python reference', url: 'https://docs.python.org/3/library/asyncio.html', snippet: 'Async API' }
      ],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    }));
    const workflow = createResearchWorkflow({
      search,
      fetchPage: async ({ url }) => ({
        status: 'ok', url,
        content: { title: url, text: 'Reference material describing the API behavior.' },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      }),
      headlessFetch: vi.fn()
    });

    const result = await createWebExploreTool({ explore: workflow })({ query: 'Compare React and Python API behavior' });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.sources).toHaveLength(2);
    expect(result.caveat).toContain('source authority could not be confirmed');
    expect(result.caveat).not.toContain('community');
  });

  it('uses discussions to answer a requested opinion question without demanding docs', async () => {
    const search = vi.fn(async () => ({
      status: 'ok' as const,
      results: [
        { title: 'User discussion', url: 'https://reddit.com/r/react/comments/123', snippet: 'User experience' },
        { title: 'Issue discussion', url: 'https://github.com/facebook/react/issues/456', snippet: 'User experience' }
      ],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    }));
    const workflow = createResearchWorkflow({
      search,
      fetchPage: async ({ url }) => ({
        status: 'ok', url,
        content: { title: url, text: 'People described their practical experience with this API.' },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      }),
      headlessFetch: vi.fn()
    });

    const result = await createWebExploreTool({ explore: workflow })({ query: 'What do users think about this React API?' });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.sources).toHaveLength(2);
    expect(result.caveat).toBeUndefined();
  });

  it.each([
    'What are community opinions about this React API?',
    'Show user reviews of this React API',
    'Show community reviews of this React API',
    'Show user feedback about this React API',
    'What do users feel about React?',
    'What do users say about this React API?'
  ])('uses discussions for an explicit opinion question: %s', async (query) => {
    const search = vi.fn(async () => ({
      status: 'ok' as const,
      results: [
        { title: 'User discussion', url: 'https://reddit.com/r/react/comments/123', snippet: 'User experience' },
        { title: 'Issue discussion', url: 'https://github.com/facebook/react/issues/456', snippet: 'User experience' }
      ],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    }));
    const workflow = createResearchWorkflow({
      search,
      fetchPage: async ({ url }) => ({
        status: 'ok', url,
        content: { title: url, text: 'People described their practical experience with this API.' },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      }),
      headlessFetch: vi.fn()
    });

    const result = await createWebExploreTool({ explore: workflow })({ query });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.caveat).toBeUndefined();
  });

  it('keeps searching for documentary evidence when a technical request also asks for forum discussions', async () => {
    const search = vi.fn(async () => ({
      status: 'ok' as const,
      results: [
        { title: 'User discussion', url: 'https://reddit.com/r/react/comments/123', snippet: 'User experience' },
        { title: 'Issue discussion', url: 'https://github.com/facebook/react/issues/456', snippet: 'User experience' }
      ],
      metadata: { backend: 'duckduckgo' as const, cacheHit: false }
    }));
    const workflow = createResearchWorkflow({
      search,
      fetchPage: async ({ url }) => ({
        status: 'ok', url,
        content: { title: url, text: 'People described their practical experience with this API.' },
        metadata: { method: 'http', cacheHit: false, contentType: 'text/html', truncated: false }
      }),
      headlessFetch: vi.fn()
    });

    const result = await createWebExploreTool({ explore: workflow })({ query: 'Find docs and forum discussions about this API' });

    expect(search.mock.calls.length).toBeGreaterThan(1);
    expect(result.caveat).toContain('community');
  });

  it('short-circuits a direct reader request while keeping source authority neutral', async () => {
    const fullPdfText =
      'This is a comprehensive technical document extracted from a PDF that contains detailed implementation guides and best practices. The document is very long with much more than 180 characters of content that needs to be preserved in full for accurate research results.';

    const search = vi.fn();
    const fetchPage = vi.fn(async ({ url }) => ({
      status: 'ok' as const,
      url,
      content: {
        title: 'Technical Documentation',
        text: fullPdfText
      },
      metadata: { method: 'pdf' as const, cacheHit: false, contentType: 'text/plain', truncated: false }
    }));

    const workflow = createResearchWorkflow({
      search,
      fetchPage,
      headlessFetch: async () => ({
        status: 'error',
        url: 'https://example.com',
        metadata: { method: 'headless', cacheHit: false },
        error: { code: 'BROWSER_NOT_FOUND', message: 'No browser found.' }
      })
    });

    const result = await workflow.run({ query: 'Read https://example.com/document.pdf' });

    expect(result.decision.action).toBe('answer');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.sourceKind).toBe('unknown');
    expect(result.evidence[0]?.method).toBe('pdf');
    expect(result.evidence[0]?.summary).toBe(fullPdfText);
    expect(result.metadata?.caveatReasons).toHaveLength(0);
    expect(search).toHaveBeenCalledTimes(0);
  });
});

describe('research workflow ownership', () => {
  afterEach(() => {
    vi.doUnmock('../../src/backends/factory.js');
    vi.resetModules();
  });

  it('closes the backend set it created', async () => {
    vi.resetModules();
    const close = vi.fn(async () => undefined);
    const createBackendSet = vi.fn(() => ({ search: vi.fn(), fetchPage: vi.fn(), headlessFetch: vi.fn(), close }));
    vi.doMock('../../src/backends/factory.js', () => ({ createBackendSet }));
    const { createResearchWorkflow: createWorkflow } = await import('../../src/orchestration/index.js');

    await createWorkflow({}).close();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not create a backend set when every capability is injected', async () => {
    vi.resetModules();
    const createBackendSet = vi.fn();
    vi.doMock('../../src/backends/factory.js', () => ({ createBackendSet }));
    const { createResearchWorkflow: createWorkflow } = await import('../../src/orchestration/index.js');

    const workflow = createWorkflow({ search: vi.fn(), fetchPage: vi.fn(), headlessFetch: vi.fn() });
    await workflow.close();

    expect(createBackendSet).not.toHaveBeenCalled();
  });

  it('waits for a detached backend operation before closing owned backends', async () => {
    vi.useFakeTimers();
    let resolveSearch!: (value: { status: 'ok'; results: []; metadata: { backend: 'duckduckgo'; cacheHit: false } }) => void;
    const close = vi.fn(async () => undefined);
    vi.resetModules();
    vi.doMock('../../src/backends/factory.js', () => ({
      createBackendSet: vi.fn(() => ({
        search: vi.fn(() => new Promise((resolve) => { resolveSearch = resolve; })),
        fetchPage: vi.fn(),
        headlessFetch: vi.fn(),
        close
      }))
    }));
    const { createResearchWorkflow: createWorkflow } = await import('../../src/orchestration/index.js');
    const workflow = createWorkflow({});

    try {
      const run = workflow.run({ query: 'pending search' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(120_000);
      await run;
      const closing = workflow.close();
      await Promise.resolve();
      expect(close).not.toHaveBeenCalled();

      resolveSearch({ status: 'ok', results: [], metadata: { backend: 'duckduckgo', cacheHit: false } });
      await closing;
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes owned backends after a grace period when detached work never settles', async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => undefined);
    const search = vi.fn(() => new Promise<never>(() => undefined));
    vi.resetModules();
    vi.doMock('../../src/backends/factory.js', () => ({
      createBackendSet: vi.fn(() => ({ search, fetchPage: vi.fn(), headlessFetch: vi.fn(), close }))
    }));
    const { createResearchWorkflow: createWorkflow } = await import('../../src/orchestration/index.js');
    const workflow = createWorkflow({});
    const controller = new AbortController();

    try {
      const run = workflow.run({ query: 'pending search', signal: controller.signal }).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(search).toHaveBeenCalledTimes(1);
      controller.abort();
      await run;
      const closing = workflow.close();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(close).toHaveBeenCalledTimes(1);
      await closing;
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns from close when an owned backend close never settles', async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    vi.resetModules();
    vi.doMock('../../src/backends/factory.js', () => ({
      createBackendSet: vi.fn(() => ({ search: vi.fn(), fetchPage: vi.fn(), headlessFetch: vi.fn(), close }))
    }));
    const { createResearchWorkflow: createWorkflow } = await import('../../src/orchestration/index.js');
    const workflow = createWorkflow({});

    try {
      let finished = false;
      const firstClose = workflow.close();
      const secondClose = workflow.close();
      expect(secondClose).toBe(firstClose);
      void firstClose.then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(5_000);
      await firstClose;
      expect(finished).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('links and unavailable search backends through the public tool', () => {
  const missingKey = 'Brave search requires PI_WEB_AGENT_BRAVE_API_KEY.';
  const notice = `Search unavailable (brave): ${missingKey} Run /web-agent doctor to check backend settings.`;
  const caveatSentence = 'Evidence is partial, so this answer is based on the strongest source';
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  function braveNotConfigured() {
    const policy = { health: createProviderHealth(), sleep: vi.fn(async () => undefined), random: () => 0 };
    const brave = vi.fn(async (): Promise<WebSearchResponse> => ({
      status: 'error',
      results: [],
      metadata: { backend: 'brave', cacheHit: false },
      error: { code: 'BACKEND_CONFIG_INVALID', message: missingKey, failure: { kind: 'not_configured' } }
    }));
    return { brave, search: chainSearch([withSearchPolicy('brave', brave, policy)], policy) };
  }

  function publicTool(workflow: ReturnType<typeof createResearchWorkflow>) {
    const tools: any[] = [];
    extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: createWebExploreTool({ explore: workflow }) } as never);
    return tools[0];
  }

  it('stops after the first unconfigured search and says so in the model text and every view', async () => {
    const { brave, search } = braveNotConfigured();
    const fetchPage = vi.fn();
    const workflow = createResearchWorkflow({ search, fetchPage, headlessFetch: vi.fn() });
    try {
      const output = await publicTool(workflow).execute('call-1', { query: 'how to configure the thing' }, undefined, vi.fn());

      expect(brave).toHaveBeenCalledTimes(1);
      expect(fetchPage).not.toHaveBeenCalled();
      expect(output.details.searchUnavailable).toEqual([{ provider: 'brave', kind: 'not_configured', message: missingKey }]);
      expect(output.content[0].text.startsWith(notice)).toBe(true);
      expect(count(output.content[0].text, notice)).toBe(1);
      for (const view of ['compact', 'preview', 'verbose'] as const) {
        const text = output.details.presentation.views[view];
        expect(count(text, notice)).toBe(1);
        expect(text).not.toContain(caveatSentence);
      }
      expect(output.content[0].text).not.toContain(caveatSentence);
      expect(output.details.caveat).toBe('No usable sources were found.');
    } finally {
      await workflow.close();
    }
  });

  it('adds no search notice to a normal run', async () => {
    const search = vi.fn(async (): Promise<WebSearchResponse> => ({
      status: 'ok',
      results: [{ title: 'Thing docs', url: 'https://docs.example/thing', snippet: 'thing' }],
      metadata: { backend: 'duckduckgo', cacheHit: false }
    }));
    const fetchPage = vi.fn(async ({ url }: { url: string }): Promise<WebFetchResponse> => ({
      status: 'ok',
      url,
      metadata: { method: 'http', cacheHit: false },
      content: { title: 'Thing docs', text: 'Official documentation text that is long enough to count as real evidence for configuring the thing.' }
    }));
    const workflow = createResearchWorkflow({ search, fetchPage, headlessFetch: vi.fn() });
    try {
      const output = await publicTool(workflow).execute('call-1', { query: 'how to configure the thing' }, undefined, vi.fn());

      expect(output.details.searchUnavailable).toBeUndefined();
      expect(output.content[0].text).not.toContain('Search unavailable');
      for (const view of ['compact', 'preview', 'verbose'] as const) {
        expect(output.details.presentation.views[view]).not.toContain('Search unavailable');
      }
    } finally {
      await workflow.close();
    }
  });

  it('reads a bare issue link without searching for its text', async () => {
    const issueUrl = 'https://github.com/demigodmode/pi-web-agent/issues/83';
    const search = vi.fn(async (): Promise<WebSearchResponse> => ({ status: 'ok', results: [], metadata: { backend: 'duckduckgo', cacheHit: false } }));
    const workflow = createResearchWorkflow({
      search,
      fetchPage: async ({ url }) => ({
        status: 'ok' as const,
        url,
        metadata: { method: 'github' as const, cacheHit: false },
        content: { title: 'Issue 83', text: 'Issue body with enough detail to count as evidence.' }
      }),
      headlessFetch: vi.fn()
    });
    try {
      const result = await workflow.run({ query: issueUrl });

      expect(search).not.toHaveBeenCalled();
      expect(result.evidence.map((item) => item.url)).toEqual([issueUrl]);
    } finally {
      await workflow.close();
    }
  });
});

describe('requested links are not labeled as community context', () => {
  it('a direct issue read has no community prefix in the public findings', async () => {
    const issueUrl = 'https://github.com/demigodmode/pi-web-agent/issues/83';
    const workflow = createResearchWorkflow({
      search: vi.fn(async (): Promise<WebSearchResponse> => ({ status: 'ok', results: [], metadata: { backend: 'duckduckgo', cacheHit: false } })),
      fetchPage: async ({ url }) => ({
        status: 'ok' as const,
        url,
        metadata: { method: 'github' as const, cacheHit: false },
        content: { title: 'Issue 83', text: 'The reporter says the option was ignored when the config file is missing.' }
      }),
      headlessFetch: vi.fn()
    });
    try {
      const result = await createWebExploreTool({ explore: workflow })({ query: issueUrl });

      expect(result.status).toBe('ok');
      expect(result.findings.length).toBeGreaterThan(0);
      for (const finding of result.findings) expect(finding).not.toContain('Community/practical context:');
    } finally {
      await workflow.close();
    }
  });
});
