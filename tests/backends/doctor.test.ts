import { describe, expect, it, vi } from 'vitest';
import { checkBackendHealth } from '../../src/backends/doctor.js';
import { DEFAULT_BACKEND_CONFIG } from '../../src/backends/config.js';

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

  it('warns when brave search is selected without an API key', async () => {
    const original = process.env.PI_WEB_AGENT_BRAVE_API_KEY;
    delete process.env.PI_WEB_AGENT_BRAVE_API_KEY;

    try {
      const lines = await checkBackendHealth({
        ...DEFAULT_BACKEND_CONFIG,
        search: { provider: 'brave' }
      });

      expect(lines).toContain('search backend: brave warning (missing PI_WEB_AGENT_BRAVE_API_KEY)');
    } finally {
      if (original !== undefined) process.env.PI_WEB_AGENT_BRAVE_API_KEY = original;
    }
  });

  it('reports brave ok for a healthy mocked response', async () => {
    const original = process.env.PI_WEB_AGENT_BRAVE_API_KEY;
    process.env.PI_WEB_AGENT_BRAVE_API_KEY = 'key';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ web: { results: [{ title: 'A', url: 'https://example.com' }] } })
    });

    try {
      const lines = await checkBackendHealth(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave', fallback: 'duckduckgo' } },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      expect(lines).toContain('search backend: brave ok');
      expect(lines).toContain('search fallback: duckduckgo');
    } finally {
      if (original === undefined) delete process.env.PI_WEB_AGENT_BRAVE_API_KEY;
      else process.env.PI_WEB_AGENT_BRAVE_API_KEY = original;
    }
  });

  it('reports brave warning for non-ok mocked response', async () => {
    const original = process.env.PI_WEB_AGENT_BRAVE_API_KEY;
    process.env.PI_WEB_AGENT_BRAVE_API_KEY = 'key';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: vi.fn() });

    try {
      const lines = await checkBackendHealth(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'brave' } },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      expect(lines).toContain('search backend: brave warning (HTTP 401)');
    } finally {
      if (original === undefined) delete process.env.PI_WEB_AGENT_BRAVE_API_KEY;
      else process.env.PI_WEB_AGENT_BRAVE_API_KEY = original;
    }
  });

  it('warns when youcom search is selected without an API key', async () => {
    const original = process.env.YDC_API_KEY;
    delete process.env.YDC_API_KEY;

    try {
      const lines = await checkBackendHealth({
        ...DEFAULT_BACKEND_CONFIG,
        search: { provider: 'youcom' }
      });

      expect(lines).toContain('search backend: youcom warning (missing YDC_API_KEY)');
    } finally {
      if (original !== undefined) process.env.YDC_API_KEY = original;
    }
  });

  it('reports youcom ok for a healthy mocked response', async () => {
    const original = process.env.YDC_API_KEY;
    process.env.YDC_API_KEY = 'key';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ results: [{ title: 'A', url: 'https://example.com' }] })
    });

    try {
      const lines = await checkBackendHealth(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'youcom', fallback: 'duckduckgo' } },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      expect(lines).toContain('search backend: youcom ok');
      expect(lines).toContain('search fallback: duckduckgo');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://api.you.com/v1/agents/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-API-Key': 'key' })
        })
      );
    } finally {
      if (original === undefined) delete process.env.YDC_API_KEY;
      else process.env.YDC_API_KEY = original;
    }
  });

  it('reports youcom warning for non-ok mocked response', async () => {
    const original = process.env.YDC_API_KEY;
    process.env.YDC_API_KEY = 'key';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: vi.fn() });

    try {
      const lines = await checkBackendHealth(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'youcom' } },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      expect(lines).toContain('search backend: youcom warning (HTTP 401)');
    } finally {
      if (original === undefined) delete process.env.YDC_API_KEY;
      else process.env.YDC_API_KEY = original;
    }
  });

  it('warns when exa search is selected without an API key', async () => {
    const original = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;

    try {
      const lines = await checkBackendHealth({
        ...DEFAULT_BACKEND_CONFIG,
        search: { provider: 'exa' }
      });

      expect(lines).toContain('search backend: exa warning (missing EXA_API_KEY)');
    } finally {
      if (original !== undefined) process.env.EXA_API_KEY = original;
    }
  });

  it('reports exa ok for a healthy mocked response', async () => {
    const original = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = 'key';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ results: [{ title: 'A', url: 'https://example.com' }] })
    });

    try {
      const lines = await checkBackendHealth(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'exa', fallback: 'duckduckgo' } },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      expect(lines).toContain('search backend: exa ok');
      expect(lines).toContain('search fallback: duckduckgo');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://api.exa.ai/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-api-key': 'key' })
        })
      );
    } finally {
      if (original === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = original;
    }
  });

  it('warns when tavily search is selected without an API key', async () => {
    const original = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const lines = await checkBackendHealth({
        ...DEFAULT_BACKEND_CONFIG,
        search: { provider: 'tavily' }
      });

      expect(lines).toContain('search backend: tavily warning (missing TAVILY_API_KEY)');
    } finally {
      if (original !== undefined) process.env.TAVILY_API_KEY = original;
    }
  });

  it('reports tavily ok for a healthy mocked response', async () => {
    const original = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'key';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ results: [{ title: 'A', url: 'https://example.com' }] })
    });

    try {
      const lines = await checkBackendHealth(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'tavily', fallback: 'duckduckgo' } },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      expect(lines).toContain('search backend: tavily ok');
      expect(lines).toContain('search fallback: duckduckgo');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://api.tavily.com/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer /) })
        })
      );
    } finally {
      if (original === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = original;
    }
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
