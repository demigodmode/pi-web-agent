import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDoctorLines, checkBackendHealth } from '../../src/backends/doctor.js';
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
      json: vi.fn().mockResolvedValue({ results: { web: [{ title: 'A', url: 'https://example.com' }] } })
    });

    try {
      const lines = await checkBackendHealth(
        { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'youcom', fallback: 'duckduckgo' } },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      );

      expect(lines).toContain('search backend: youcom ok');
      expect(lines).toContain('search fallback: duckduckgo');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://ydc-index.io/v1/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-API-Key': 'key' })
        })
      );
      expect(JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body)).toEqual({ query: 'pi-web-agent-doctor', count: 1 });
    } finally {
      if (original === undefined) delete process.env.YDC_API_KEY;
      else process.env.YDC_API_KEY = original;
    }
  });

  it('reports youcom ok for a valid empty response and warns for malformed or all-invalid responses', async () => {
    const original = process.env.YDC_API_KEY;
    process.env.YDC_API_KEY = 'key';

    try {
      for (const [body, expected] of [
        [{ results: { web: [], news: [] } }, 'search backend: youcom ok'],
        [{ results: { web: [{ title: 'Missing URL' }] } }, 'search backend: youcom warning (unexpected response)'],
        [{ results: {} }, 'search backend: youcom warning (unexpected response)']
      ] as const) {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue(body) });
        const lines = await checkBackendHealth(
          { ...DEFAULT_BACKEND_CONFIG, search: { provider: 'youcom' } },
          { fetchImpl: fetchImpl as unknown as typeof fetch }
        );
        expect(lines).toContain(expected);
      }
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

  it('reports search fanout mode and providers', async () => {
    const fetchImpl = vi.fn();

    const result = await checkBackendHealth({
      search: {
        provider: 'duckduckgo',
        fanout: { mode: 'on', providers: ['brave', 'exa'] }
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(result).toContain('search fanout: on (brave, exa)');
  });

  it('reports search fanout with auto mode and all providers', async () => {
    const fetchImpl = vi.fn();

    const result = await checkBackendHealth({
      search: {
        provider: 'duckduckgo',
        fanout: { mode: 'auto', providers: ['duckduckgo', 'searxng', 'brave', 'youcom', 'exa', 'tavily'] }
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(result).toContain('search fanout: auto (duckduckgo, searxng, brave, youcom, exa, tavily)');
  });

  it('warns when fanout includes searxng without baseUrl', async () => {
    const fetchImpl = vi.fn();

    const result = await checkBackendHealth({
      search: {
        provider: 'duckduckgo',
        fanout: { mode: 'on', providers: ['brave', 'searxng'] }
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(result).toContain('search fanout: on (brave, searxng)');
    expect(result).toContain('search fanout provider searxng warning (missing baseUrl)');
  });

  it('warns when fanout includes hosted provider without API key', async () => {
    const original = process.env.PI_WEB_AGENT_BRAVE_API_KEY;
    delete process.env.PI_WEB_AGENT_BRAVE_API_KEY;

    try {
      const fetchImpl = vi.fn();

      const result = await checkBackendHealth({
        search: {
          provider: 'duckduckgo',
          fanout: { mode: 'on', providers: ['duckduckgo', 'brave'] }
        },
        fetch: { provider: 'http' },
        headless: { provider: 'local-browser' }
      }, { fetchImpl });

      expect(result).toContain('search fanout: on (duckduckgo, brave)');
      expect(result).toContain('search fanout provider brave warning (missing PI_WEB_AGENT_BRAVE_API_KEY)');
    } finally {
      if (original !== undefined) process.env.PI_WEB_AGENT_BRAVE_API_KEY = original;
    }
  });

  it('checks the configured google-serp endpoint and rejects an error envelope with an empty organic array', async () => {
    const original = process.env.PI_WEB_AGENT_GOOGLE_SERP_API_KEY;
    process.env.PI_WEB_AGENT_GOOGLE_SERP_API_KEY = 'serp-key';

    try {
      const healthy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 0, organic: [{ title: 'A', link: 'https://example.com' }] })
      } as unknown as Response);

      const ok = await checkBackendHealth({
        ...DEFAULT_BACKEND_CONFIG,
        search: { provider: 'google-serp', baseUrl: 'https://serp.example/search' }
      }, { fetchImpl: healthy });

      expect(ok).toContain('search backend: google-serp ok');
      expect(healthy).toHaveBeenCalledWith(
        'https://serp.example/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': 'serp-key' })
        })
      );

      // The shape a rejected key comes back in: HTTP 200, empty organic array, failure in the
      // envelope. Reporting this as "ok" would send users looking in the wrong place.
      const rejected = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 1001, error: 'Unauthorized', organic: [] })
      } as unknown as Response);

      const warned = await checkBackendHealth({
        ...DEFAULT_BACKEND_CONFIG,
        search: { provider: 'google-serp', baseUrl: 'https://serp.example/search' }
      }, { fetchImpl: rejected });

      expect(warned).toContain('search backend: google-serp warning ("Unauthorized" (provider status 1001))');
      expect(warned).not.toContain('search backend: google-serp ok');
    } finally {
      if (original === undefined) delete process.env.PI_WEB_AGENT_GOOGLE_SERP_API_KEY;
      else process.env.PI_WEB_AGENT_GOOGLE_SERP_API_KEY = original;
    }
  });

  it('preserves SearXNG path in baseUrl with trailing slash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    } as Response);

    await checkBackendHealth({
      search: {
        provider: 'searxng',
        baseUrl: 'https://host/searx/',
        options: { categories: ['general'] }
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://host/searx/search?q=pi-web-agent-doctor&format=json&categories=general',
      expect.any(Object)
    );
  });

  it('preserves SearXNG path in baseUrl without trailing slash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    } as Response);

    await checkBackendHealth({
      search: {
        provider: 'searxng',
        baseUrl: 'https://host/searx',
        options: { language: 'en' }
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://host/searx/search?q=pi-web-agent-doctor&format=json&language=en',
      expect.any(Object)
    );
  });

  it('handles SearXNG with port correctly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    } as Response);

    await checkBackendHealth({
      search: {
        provider: 'searxng',
        baseUrl: 'http://host:8080',
        options: {}
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://host:8080/search?q=pi-web-agent-doctor&format=json',
      expect.any(Object)
    );
  });

  it('handles SearXNG with port and trailing slash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    } as Response);

    await checkBackendHealth({
      search: {
        provider: 'searxng',
        baseUrl: 'http://host:8080/',
        options: {}
      },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://host:8080/search?q=pi-web-agent-doctor&format=json',
      expect.any(Object)
    );
  });
});

describe('browser doctor line', () => {
  it('shows an auto-detected browser with its source', () => {
    expect(browserDoctorLines({ ok: true, executablePath: '/usr/bin/chromium', browser: 'chromium', source: 'auto' })).toEqual([
      'browser: chromium /usr/bin/chromium (auto)'
    ]);
  });

  it('flags a sandboxed find and says how to fix it', () => {
    expect(browserDoctorLines({
      ok: true,
      executablePath: '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
      browser: 'chromium',
      source: 'auto',
      sandboxed: true
    })).toEqual([
      'browser: chromium /var/lib/flatpak/exports/bin/org.chromium.Chromium (auto, sandboxed; may not start under Playwright, set backends.headless.executablePath if headless fails)'
    ]);
  });

  it('names the config source for a configured path', () => {
    expect(browserDoctorLines({ ok: true, executablePath: '/opt/chrome', browser: 'configured', source: 'config' })).toEqual([
      'browser: configured /opt/chrome (config)'
    ]);
  });

  it('names the env var for a configured path', () => {
    expect(browserDoctorLines({ ok: true, executablePath: '/opt/chrome', browser: 'configured', source: 'env' })).toEqual([
      'browser: configured /opt/chrome (PI_WEB_AGENT_BROWSER_PATH)'
    ]);
  });

  it('adds setup guidance when nothing is found', () => {
    const [line] = browserDoctorLines({
      ok: false,
      error: { code: 'BROWSER_NOT_FOUND', message: 'No compatible local browser was found for headless fetch.' }
    });

    expect(line).toContain('browser: missing (BROWSER_NOT_FOUND)');
    expect(line).toContain('backends.headless.executablePath');
    expect(line).toContain('PI_WEB_AGENT_BROWSER_PATH');
    expect(line).toContain("install Playwright's Chromium");
  });

  it('warns with the source when a configured path is missing', () => {
    expect(browserDoctorLines({
      ok: false,
      error: {
        code: 'CONFIGURED_BROWSER_NOT_FOUND',
        message: 'Configured browser path was not found: /opt/gone (from PI_WEB_AGENT_BROWSER_PATH)'
      }
    })).toEqual([
      'browser: warning, Configured browser path was not found: /opt/gone (from PI_WEB_AGENT_BROWSER_PATH)'
    ]);
  });
});

describe('degoog doctor checks', () => {
  const fixture = (name: string) => readFileSync(new URL(`../fixtures/degoog/${name}`, import.meta.url), 'utf8');
  const enginesFixture = JSON.parse(fixture('engines.json')) as { engines: Array<{ id: string; origin: { kind: string } }>; defaults: Record<string, boolean> };
  const searchFixture = fixture('search.json');
  const json = (body: unknown, status = 200) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const html = (status = 200) => new Response('<!doctype html><html></html>', { status, headers: { 'content-type': 'text/html' } });
  const degoogConfig = (baseUrl = 'http://localhost:4444') => ({
    search: { provider: 'degoog' as const, ...(baseUrl ? { baseUrl } : {}) },
    fetch: { provider: 'http' as const },
    headless: { provider: 'local-browser' as const }
  });
  const routes = (engines: Response | (() => Response), search: Response | (() => Response) = json(JSON.parse(searchFixture))) =>
    vi.fn(async (input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/engines')) return typeof engines === 'function' ? engines() : engines;
      return typeof search === 'function' ? search() : search;
    });
  const defaultEngines = () => json(enginesFixture);
  const coreOnly = () => json({ engines: enginesFixture.engines.filter((e) => e.origin.kind === 'core'), defaults: { 'degoog-engine': true } });
  const noneEnabled = () => json({
    engines: enginesFixture.engines,
    defaults: Object.fromEntries(Object.keys(enginesFixture.defaults).map((id) => [id, false]))
  });
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.PI_WEB_AGENT_DEGOOG_API_KEY;
    delete process.env.PI_WEB_AGENT_DEGOOG_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.PI_WEB_AGENT_DEGOOG_API_KEY;
    else process.env.PI_WEB_AGENT_DEGOOG_API_KEY = savedKey;
  });

  it('warns when no baseUrl is configured and makes no request', async () => {
    const fetchImpl = vi.fn();
    const result = await checkBackendHealth(degoogConfig(''), { fetchImpl });
    expect(result).toContain('search backend: degoog warning (missing baseUrl)');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports ok when engines are enabled and the probe returns results and engine timings', async () => {
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(defaultEngines()) });

    expect(result).toContain('search backend: degoog ok');
    expect(result.filter((line) => line.includes('degoog warning'))).toEqual([]);
  });

  it('probes api/search with q only and no format', async () => {
    const fetchImpl = routes(defaultEngines());
    await checkBackendHealth(degoogConfig('http://localhost:4444/'), { fetchImpl });

    const searchCall = fetchImpl.mock.calls.map((call) => String(call[0])).find((url) => url.includes('/api/search'));
    expect(searchCall).toBe('http://localhost:4444/api/search?q=pi-web-agent-doctor');
  });

  it('reports a non-2xx engines response with the status and a base URL hint', async () => {
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(html(404)) });
    expect(result).toContain('search backend: degoog warning (HTTP 404 from /api/engines, check the base URL)');
  });

  it('reports a non-JSON engines response as an unexpected response, not an HTTP status', async () => {
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(html(200)) });
    expect(result).toContain('search backend: degoog warning (unexpected response from /api/engines, check the base URL)');
    expect(result.some((line) => line.includes('HTTP 200'))).toBe(false);
  });

  it('does not print ok over an engine warning, but the probe still catches a 401', async () => {
    const result = await checkBackendHealth(degoogConfig(), {
      fetchImpl: routes(coreOnly(), json({ error: 'You shall not pass!' }, 401))
    });
    expect(result).toContain('search backend: degoog warning (HTTP 401, check PI_WEB_AGENT_DEGOOG_API_KEY)');
    expect(result).not.toContain('search backend: degoog ok');
  });

  it('names a misconfigured engine (ok status with an error reason and no results) in the failed-probe warning', async () => {
    const failed = {
      ...JSON.parse(searchFixture),
      results: [],
      engineTimings: [
        { name: 'Wikipedia', id: 'w', time: 3, resultCount: 0, status: 'ok', errorReason: 'Engine is missing its API token' }
      ]
    };
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(defaultEngines(), json(failed)) });
    expect(result).toContain('search backend: degoog warning (every engine failed: Wikipedia (Engine is missing its API token))');
  });

  it('does not flag an ok engine with no reason and no results as failed', async () => {
    const empty = { results: [], engineTimings: [{ name: 'Wikipedia', id: 'w', time: 3, resultCount: 0, status: 'ok' }] };
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(defaultEngines(), json(empty)) });
    expect(result).toContain('search backend: degoog ok');
  });

  it('reports a network error on the engines request', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes('/api/engines')) throw new Error('connect ECONNREFUSED');
      return json(JSON.parse(searchFixture));
    });
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl });
    expect(result).toContain('search backend: degoog warning (connect ECONNREFUSED)');
  });

  it('warns when only the builtin core engine is installed', async () => {
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(coreOnly()) });
    expect(result).toContain(
      "search backend: degoog warning (no search engines installed; install some in degoog's settings, searches will come back empty until then)"
    );
  });

  it('warns when web engines exist but none is enabled by default', async () => {
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(noneEnabled()) });
    expect(result).toContain("search backend: degoog warning (no web search engines are enabled; enable some in degoog's settings)");
    expect(result).not.toContain(
      "search backend: degoog warning (no search engines installed; install some in degoog's settings, searches will come back empty until then)"
    );
  });

  it('sends the bearer on every request when the key is set', async () => {
    process.env.PI_WEB_AGENT_DEGOOG_API_KEY = 'd'.repeat(64);
    const fetchImpl = routes(defaultEngines());
    await checkBackendHealth(degoogConfig(), { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${'d'.repeat(64)}` });
    }
  });

  it('warns on a 401 probe and names the env var', async () => {
    const result = await checkBackendHealth(degoogConfig(), {
      fetchImpl: routes(defaultEngines(), json({ error: 'You shall not pass!' }, 401))
    });
    expect(result).toContain('search backend: degoog warning (HTTP 401, check PI_WEB_AGENT_DEGOOG_API_KEY)');
    expect(result).not.toContain('search backend: degoog ok');
  });

  it('warns on another non-2xx probe status', async () => {
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(defaultEngines(), json('boom', 500)) });
    expect(result).toContain('search backend: degoog warning (HTTP 500)');
  });

  it('warns when the probe body is not the native shape', async () => {
    const result = await checkBackendHealth(degoogConfig(), {
      fetchImpl: routes(defaultEngines(), json({ results: [] }))
    });
    expect(result).toContain('search backend: degoog warning (unexpected response)');
  });

  it('warns and lists the engines when every engine in the probe failed', async () => {
    const failed = {
      ...JSON.parse(searchFixture),
      results: [],
      engineTimings: [
        { name: 'Brave Search', id: 'b', time: 142, resultCount: 0, status: 'rate_limited', errorReason: 'Brave Search upstream returned HTTP 429' },
        { name: 'DuckDuckGo', id: 'd', time: 900, resultCount: 0, status: 'timeout' }
      ]
    };
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl: routes(defaultEngines(), json(failed)) });
    expect(result).toContain(
      'search backend: degoog warning (every engine failed: Brave Search (Brave Search upstream returned HTTP 429), DuckDuckGo (timeout))'
    );
  });

  it('keeps the order: engine checks come before the probe', async () => {
    const fetchImpl = routes(coreOnly());
    const result = await checkBackendHealth(degoogConfig(), { fetchImpl });
    const emptyIndex = result.findIndex((line) => line.includes('no search engines installed'));
    expect(emptyIndex).toBe(0);
    expect(result.filter((line) => line.includes('degoog'))).toHaveLength(1);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/api/search'))).toBe(true);
  });

  it('skips the probe when the engines request already failed', async () => {
    const fetchImpl = routes(html(500));
    await checkBackendHealth(degoogConfig(), { fetchImpl });
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('/api/search'))).toBe(false);
  });

  it('warns in fanout when degoog is in the set without a baseUrl', async () => {
    const result = await checkBackendHealth({
      search: { provider: 'duckduckgo', fanout: { mode: 'on', providers: ['duckduckgo', 'degoog'] } },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl: vi.fn() });
    expect(result).toContain('search fanout provider degoog warning (missing baseUrl)');
  });

  it('does not warn in fanout when degoog has a baseUrl', async () => {
    const result = await checkBackendHealth({
      search: { provider: 'duckduckgo', baseUrls: { degoog: 'http://localhost:4444' }, fanout: { mode: 'on', providers: ['duckduckgo', 'degoog'] } },
      fetch: { provider: 'http' },
      headless: { provider: 'local-browser' }
    }, { fetchImpl: vi.fn() });
    expect(result.filter((line) => line.includes('degoog warning'))).toEqual([]);
  });
});
