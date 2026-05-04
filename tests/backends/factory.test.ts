import { describe, expect, it } from 'vitest';
import { createBackendSet } from '../../src/backends/factory.js';

describe('backend factory', () => {
  it('creates the existing search/fetch/headless tools by default', () => {
    const backends = createBackendSet();

    expect(backends.search).toEqual(expect.any(Function));
    expect(backends.fetchPage).toEqual(expect.any(Function));
    expect(backends.headlessFetch).toEqual(expect.any(Function));
  });

  it('creates self-hosted search and fetch backends', () => {
    const backends = createBackendSet({
      search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
      fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002' },
      headless: { provider: 'local-browser' }
    });

    expect(backends.search).toEqual(expect.any(Function));
    expect(backends.fetchPage).toEqual(expect.any(Function));
  });

  it('returns clear backend config errors instead of silently falling back', async () => {
    const backends = createBackendSet({
      search: { provider: 'searxng' },
      fetch: { provider: 'firecrawl' },
      headless: { provider: 'local-browser' }
    });

    await expect(backends.search({ query: 'docs' })).resolves.toMatchObject({
      status: 'error',
      metadata: { backend: 'searxng', cacheHit: false },
      error: { code: 'BACKEND_CONFIG_INVALID' }
    });

    await expect(backends.fetchPage({ url: 'https://example.com' })).resolves.toMatchObject({
      status: 'error',
      metadata: { method: 'firecrawl', cacheHit: false },
      error: { code: 'BACKEND_CONFIG_INVALID' }
    });
  });
});
