import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createHttpFetcher } from '../../src/fetch/http-fetch.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';
import { createResearchWorker } from '../../src/orchestration/research-worker.js';

describe('research workflow composition', () => {
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
      `<html><head><title>Archive guide</title></head><body><main><h1>Lunar archive transfer</h1><p>${'General archive background. '.repeat(12)}</p><p>${lateAnswer}</p></main></body></html>`,
      { headers: { 'content-type': 'text/html' } }
    ));
    const httpFetch = createHttpFetcher({ fetchImpl: fetchImpl as typeof fetch });
    const worker = createResearchWorker({
      search: async () => ({
        status: 'ok',
        results: [{ title: 'Archive guide', url: 'https://example.com/archive', snippet: 'Archive transfer details' }],
        metadata: { backend: 'duckduckgo', cacheHit: false }
      }),
      fetchPage: ({ url, query }) => httpFetch(url, query)
    });

    const result = await createWebExploreTool({
      explore: async ({ query }) => {
        const workerPass = await worker.run({ query, maxSearchRounds: 1, maxFetches: 1 });
        return { decision: { action: 'answer' as const }, evidence: workerPass.evidence, workerPass };
      }
    })({ query: 'lunar archive transfer manifest' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.findings.join(' ')).toContain(lateAnswer);
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

  it('short-circuits research when direct url with reader method provides primary-content', async () => {
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
    expect(result.evidence[0]?.sourceKind).toBe('primary-content');
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
