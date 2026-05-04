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
    ).resolves.toEqual(['search backend: duckduckgo', 'fetch backend: http']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks configured SearXNG JSON search endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    } as Response);

    await expect(
      checkBackendHealth({
        search: { provider: 'searxng', baseUrl: 'http://localhost:8080' },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      }, { fetchImpl })
    ).resolves.toContain('search backend: searxng ok');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:8080/search?q=pi-web-agent-doctor&format=json',
      expect.any(Object)
    );
  });

  it('reports Firecrawl health check failures as warnings', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      checkBackendHealth({
        search: { provider: 'duckduckgo' },
        fetch: { provider: 'firecrawl', baseUrl: 'http://localhost:3002' },
        headless: { provider: 'local-browser' }
      }, { fetchImpl })
    ).resolves.toContain('fetch backend: firecrawl warning (connect ECONNREFUSED)');
  });
});
