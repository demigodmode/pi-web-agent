import type { WebFetchResponse } from '../types.js';

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    markdown?: unknown;
    html?: unknown;
    metadata?: {
      title?: unknown;
      sourceURL?: unknown;
    };
  };
  error?: unknown;
};

function buildScrapeUrl(baseUrl: string) {
  return new URL('/v1/scrape', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createFirecrawlFetcher({
  baseUrl,
  apiKey,
  fetchImpl = fetch
}: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}) {
  return async function firecrawlFetch(url: string): Promise<WebFetchResponse> {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetchImpl(buildScrapeUrl(baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ url, formats: ['markdown'] })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = (await response.json()) as FirecrawlResponse;
      if (parsed.success === false) {
        throw new Error(typeof parsed.error === 'string' ? parsed.error : 'Firecrawl scrape failed.');
      }

      const text = typeof parsed.data?.markdown === 'string'
        ? parsed.data.markdown
        : typeof parsed.data?.html === 'string'
          ? parsed.data.html
          : '';
      const resolvedUrl = typeof parsed.data?.metadata?.sourceURL === 'string'
        ? parsed.data.metadata.sourceURL
        : url;
      const title = typeof parsed.data?.metadata?.title === 'string'
        ? parsed.data.metadata.title
        : undefined;

      if (!text.trim()) {
        return {
          status: 'needs_headless',
          url: resolvedUrl,
          metadata: { method: 'firecrawl', cacheHit: false },
          error: { code: 'WEAK_EXTRACTION', message: 'Firecrawl did not return useful page text.' }
        };
      }

      return {
        status: 'ok',
        url: resolvedUrl,
        content: { title, text },
        metadata: { method: 'firecrawl', cacheHit: false, truncated: text.length >= 4000 }
      };
    } catch (error) {
      return {
        status: 'error',
        url,
        metadata: { method: 'firecrawl', cacheHit: false },
        error: { code: 'FETCH_FAILED', message: `Firecrawl scrape failed: ${errorMessage(error)}` }
      };
    }
  };
}
