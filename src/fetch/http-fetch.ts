import { extractReadableContentSafely } from '../extract/readability.js';
import type { WebFetchResponse } from '../types.js';

function looksLikeScriptShell(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes('<script') && (lower.includes('id="app"') || lower.includes('id="root"'));
}

function isWeakHttpContent(options: { html: string; title?: string; text: string }): boolean {
  const normalizedText = options.text.replace(/\s+/g, ' ').trim();
  const normalizedHtml = options.html.replace(/\s+/g, ' ').trim();
  const textLength = normalizedText.length;
  const htmlLength = normalizedHtml.length;
  const hasGenericShellMarker = /enable javascript|javascript required|please turn on javascript/i.test(
    options.html
  );
  const veryShortBody = textLength > 0 && textLength < 120;
  const lowDensity = htmlLength > 0 && textLength / htmlLength < 0.02;

  return veryShortBody && (lowDensity || hasGenericShellMarker);
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
    const extraction = extractReadableContentSafely(html);
    const content = extraction.content;

    if (
      looksLikeScriptShell(html) ||
      content.text.length < 40 ||
      isWeakHttpContent({ html, title: content.title, text: content.text })
    ) {
      return {
        status: 'needs_headless',
        url: response.url,
        metadata: { method: 'http', cacheHit: false, contentType },
        error: {
          code: 'WEAK_EXTRACTION',
          message: 'HTTP extraction was not reliable enough.'
        }
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
