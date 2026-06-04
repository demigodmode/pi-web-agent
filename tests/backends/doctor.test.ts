import { describe, expect, it, vi } from 'vitest';
import { checkBackendHealth } from '../../src/backends/doctor.js';

describe('backend doctor checks', () => {
  it('does not network-check default local backends', async () => {
    const fetchImpl = vi.fn();

    await expect(
      checkBackendHealth({
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      }, { fetchImpl })
    ).resolves.toEqual([
      'search backend: duckduckgo',
      'fetch backend: http',
      'headless backend: local-browser (managed Chromium fallback configured)'
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks configured SearXNG JSON search endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    } as Response);

    const result = await checkBackendHealth({
      search: {
        provider: 'searxng',
        baseUrl: 'http://localhost:8080',
        fallback: 'duckduckgo',
        options: { categories: ['general'], language: 'en', safesearch: 1 }
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(result).toContain('search backend: searxng ok');
    expect(result).toContain('search fallback: duckduckgo');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8080/search?q=pi-web-agent-doctor&format=json&categories=general&language=en&safesearch=1',
      expect.any(Object)
    );
  });

  it('reports Firecrawl health check failures as warnings', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await checkBackendHealth({
      search: { provider: 'duckduckgo' },
      fetch: {
        provider: 'firecrawl',
        baseUrl: 'http://localhost:3002',
        fallback: 'http',
        options: { formats: ['markdown'], onlyMainContent: true }
      },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(result).toContain('fetch backend: firecrawl warning (connect ECONNREFUSED)');
    expect(result).toContain('fetch fallback: http');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3002/v1/scrape',
      expect.objectContaining({
        body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'], onlyMainContent: true })
      })
    );
  });
});
