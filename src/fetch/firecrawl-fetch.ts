import type { FirecrawlOptions } from '../backends/config.js';
import { classifyHttpFailure, readResponseParts } from '../backends/provider-failure.js';
import { selectRelevantContent } from '../extract/section-selector.js';
import type { FailureInfo, WebFetchResponse } from '../types.js';

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
  options,
  fetchImpl = fetch
}: {
  baseUrl: string;
  apiKey?: string;
  options?: FirecrawlOptions;
  fetchImpl?: typeof fetch;
}) {
  return async function firecrawlFetch(url: string, query?: string): Promise<WebFetchResponse> {
    const failed = (message: string, failure: FailureInfo): WebFetchResponse => ({
      status: 'error',
      url,
      metadata: { method: 'firecrawl', cacheHit: false },
      error: { code: 'FETCH_FAILED', message, failure }
    });

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const body = {
      url,
      formats: options?.formats ?? ['markdown'],
      ...(options?.onlyMainContent !== undefined ? { onlyMainContent: options.onlyMainContent } : {})
    };

    let response: Response;
    try {
      response = await fetchImpl(buildScrapeUrl(baseUrl), { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (error) {
      return failed(`Firecrawl scrape failed: ${errorMessage(error)}`, { kind: 'transient' });
    }

    let parts: Awaited<ReturnType<typeof readResponseParts>>;
    try {
      parts = await readResponseParts(response);
    } catch (error) {
      return failed(`Firecrawl scrape response could not be read: ${errorMessage(error)}`, { kind: 'transient' });
    }
    if (!response.ok) {
      const code = (parts.json as { code?: unknown } | undefined)?.code;
      if (response.status === 500 && code === 'SCRAPE_ALL_ENGINES_FAILED') {
        // No extractable content (https://github.com/firecrawl/firecrawl/issues/2316): same as an empty page.
        return {
          status: 'needs_headless',
          url,
          metadata: { method: 'firecrawl', cacheHit: false },
          error: { code: 'WEAK_EXTRACTION', message: 'Firecrawl could not extract content from this page.' }
        };
      }
      return failed(`Firecrawl scrape failed: HTTP ${response.status}`, classifyHttpFailure('firecrawl', parts));
    }

    const parsed = parts.json as FirecrawlResponse | undefined;
    if (!parsed || typeof parsed !== 'object' || parsed.success === false) {
      return failed('Firecrawl returned a response that did not match the expected format.', {
        kind: 'bad_response',
        httpStatus: response.status
      });
    }

    const markdown = typeof parsed.data?.markdown === 'string' ? parsed.data.markdown : undefined;
    const html = typeof parsed.data?.html === 'string' ? parsed.data.html : undefined;
    const text = markdown ?? html ?? '';
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

    const selection = query
      ? selectRelevantContent({ source: text, format: markdown !== undefined ? 'markdown' : 'html', query })
      : undefined;
    const selectedText = selection?.text ?? text;

    return {
      status: 'ok',
      url: resolvedUrl,
      content: { title, text: selectedText, ...(selection?.anchor ? { sectionAnchor: selection.anchor } : {}) },
      metadata: { method: 'firecrawl', cacheHit: false, truncated: selection?.omitted ?? text.length >= 4000 }
    };
  };
}
