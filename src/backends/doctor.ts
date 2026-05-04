import type { BackendConfig } from './config.js';

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function searxngDoctorUrl(baseUrl: string) {
  const url = new URL('/search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('q', 'pi-web-agent-doctor');
  url.searchParams.set('format', 'json');
  return url.toString();
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
  } else if (!config.search.baseUrl) {
    lines.push('search backend: searxng warning (missing baseUrl)');
  } else {
    const timeout = withTimeout(timeoutMs);
    try {
      const response = await fetchImpl(searxngDoctorUrl(config.search.baseUrl), { signal: timeout.signal });
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
        body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
        signal: timeout.signal
      });
      lines.push(response.ok ? 'fetch backend: firecrawl ok' : `fetch backend: firecrawl warning (HTTP ${response.status})`);
    } catch (error) {
      lines.push(`fetch backend: firecrawl warning (${message(error)})`);
    } finally {
      timeout.done();
    }
  }

  return lines;
}
