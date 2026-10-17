import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createHttpFetcher } from '../../src/fetch/http-fetch.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';

describe('research workflow composition', () => {
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

    expect(fetchPage).toHaveBeenCalledWith({
      url: 'https://example.com/post',
      query: 'Read https://example.com/post?utm_source=x'
    });
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
});
