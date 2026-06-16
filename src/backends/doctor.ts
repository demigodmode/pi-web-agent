import type { BackendConfig, FirecrawlOptions, SearxngOptions } from './config.js';

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function braveDoctorUrl() {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', 'pi-web-agent-doctor');
  url.searchParams.set('count', '1');
  return url.toString();
}

function searxngDoctorUrl(baseUrl: string, options: SearxngOptions = {}) {
  const url = new URL('/search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('q', 'pi-web-agent-doctor');
  url.searchParams.set('format', 'json');
  if (options.categories?.length) url.searchParams.set('categories', options.categories.join(','));
  if (options.language) url.searchParams.set('language', options.language);
  if (options.safesearch !== undefined) url.searchParams.set('safesearch', String(options.safesearch));
  return url.toString();
}

function firecrawlDoctorBody(options: FirecrawlOptions = {}) {
  return {
    url: 'https://example.com',
    formats: options.formats ?? ['markdown'],
    ...(options.onlyMainContent !== undefined ? { onlyMainContent: options.onlyMainContent } : {})
  };
}

export async function checkBackendHealth(
  config: BackendConfig,
  {
    fetchImpl = fetch,
    timeoutMs = 3_000
  }: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {}
): Promise<string[]> {
  const lines: string[] = [];

  if (config.search.provider === 'duckduckgo') {
    lines.push('search backend: duckduckgo');
  } else if (config.search.provider === 'brave') {
    const apiKey = process.env.PI_WEB_AGENT_BRAVE_API_KEY;
    if (!apiKey?.trim()) {
      lines.push('search backend: brave warning (missing PI_WEB_AGENT_BRAVE_API_KEY)');
    } else {
      const timeout = withTimeout(timeoutMs);
      try {
        const response = await fetchImpl(braveDoctorUrl(), {
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': apiKey
          },
          signal: timeout.signal
        });
        if (!response.ok) {
          lines.push(`search backend: brave warning (HTTP ${response.status})`);
        } else {
          const json = (await response.json()) as { web?: { results?: unknown } };
          lines.push(Array.isArray(json.web?.results)
            ? 'search backend: brave ok'
            : 'search backend: brave warning (unexpected response)');
        }
      } catch (error) {
        lines.push(`search backend: brave warning (${message(error)})`);
      } finally {
        timeout.done();
      }
    }
  } else if (!config.search.baseUrl) {
    lines.push('search backend: searxng warning (missing baseUrl)');
  } else {
    const timeout = withTimeout(timeoutMs);
    try {
      const response = await fetchImpl(searxngDoctorUrl(config.search.baseUrl, config.search.options), { signal: timeout.signal });
      const json = (await response.json()) as { results?: unknown };
      lines.push(response.ok && Array.isArray(json.results)
        ? 'search backend: searxng ok'
        : 'search backend: searxng warning (unexpected response)');
    } catch (error) {
      lines.push(`search backend: searxng warning (${message(error)})`);
    } finally {
      timeout.done();
    }
  }

  if (config.search.fallback) {
    lines.push(`search fallback: ${config.search.fallback}`);
  }

  if (config.fetch.provider === 'http') {
    lines.push('fetch backend: http');
  } else if (!config.fetch.baseUrl) {
    lines.push('fetch backend: firecrawl warning (missing baseUrl)');
  } else {
    const timeout = withTimeout(timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (config.fetch.apiKey ?? process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY) {
        headers.Authorization = `Bearer ${config.fetch.apiKey ?? process.env.PI_WEB_AGENT_FIRECRAWL_API_KEY}`;
      }
      const response = await fetchImpl(new URL('/v1/scrape', config.fetch.baseUrl).toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(firecrawlDoctorBody(config.fetch.options)),
        signal: timeout.signal
      });
      lines.push(response.ok ? 'fetch backend: firecrawl ok' : `fetch backend: firecrawl warning (HTTP ${response.status})`);
    } catch (error) {
      lines.push(`fetch backend: firecrawl warning (${message(error)})`);
    } finally {
      timeout.done();
    }
  }

  if (config.fetch.fallback) {
    lines.push(`fetch fallback: ${config.fetch.fallback}`);
  }

  if (config.headless.provider === 'local-browser') {
    lines.push('headless backend: local-browser (managed Chromium fallback configured)');
  }

  return lines;
}
