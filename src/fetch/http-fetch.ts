import { extractReadableContent } from '../extract/readability.js';
import type { WebFetchResponse } from '../types.js';

function looksLikeScriptShell(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes('<script') && (lower.includes('id="app"') || lower.includes('id="root"'));
}

export function createHttpFetcher({
  fetchImpl = fetch
}: {
  fetchImpl?: typeof fetch;
} = {}) {
  return async function httpFetch(url: string): Promise<WebFetchResponse> {
    const response = await fetchImpl(url);
    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('text/html')) {
      return {
        status: 'unsupported',
        url: response.url,
        metadata: { method: 'http', cacheHit: false, contentType }
      };
    }

    const html = await response.text();
    const content = extractReadableContent(html);

    if (looksLikeScriptShell(html) || content.text.length < 40) {
      return {
        status: 'needs_headless',
        url: response.url,
        metadata: { method: 'http', cacheHit: false, contentType },
        error: { code: 'WEAK_EXTRACTION', message: 'HTTP extraction was not reliable enough.' }
      };
    }

    return {
      status: 'ok',
      url: response.url,
      content,
      metadata: { method: 'http', cacheHit: false, contentType, truncated: content.text.length >= 4000 }
    };
  };
}
