import { extractReadableContentForQuery, extractReadableContentSafely } from '../extract/readability.js';
import { hasBotCheckContent } from '../extract/bot-check.js';
import { RedirectError } from './guarded-fetch.js';
import { findGuardError } from './network-guard.js';
import { PAGE_FETCH_TIMEOUT_MS, abortError, requestSignal, throwIfAborted } from '../abort.js';
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

function timedOut(url: string, timeoutMs: number): WebFetchResponse {
  return {
    status: 'error',
    url,
    metadata: { method: 'http', cacheHit: false },
    error: { code: 'FETCH_TIMEOUT', message: `${url} did not respond within ${timeoutMs / 1000}s.`, failure: { kind: 'transient' } }
  };
}

// undici's own messages ("fetch failed", "terminated") say little; the cause says what happened.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : undefined;
  return cause && cause !== error.message ? `${error.message} (${cause})` : error.message;
}

/**
 * A dropped connection, refused port, DNS or TLS failure, or a bad redirect is
 * a problem with this one page, not the whole run: report it like any other
 * failed read so the worker moves on to the next source (#76). A redirect loop
 * won't fix itself, so it isn't called transient.
 */
function fetchFailed(url: string, error: unknown): WebFetchResponse {
  return {
    status: 'error',
    url,
    metadata: { method: 'http', cacheHit: false },
    error: {
      code: 'FETCH_FAILED',
      message: `${url} could not be fetched: ${describeError(error)}.`,
      failure: { kind: error instanceof RedirectError ? 'bad_response' : 'transient' }
    }
  };
}

export function createHttpFetcher({
  fetchImpl = fetch,
  timeoutMs = PAGE_FETCH_TIMEOUT_MS
}: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  return async function httpFetch(url: string, query?: string, signal?: AbortSignal): Promise<WebFetchResponse> {
    throwIfAborted(signal);
    const requestAbort = requestSignal(signal, timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: requestAbort });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      const blocked = findGuardError(error);
      if (blocked) {
        return {
          status: 'error',
          url,
          metadata: { method: 'http', cacheHit: false },
          error: { code: blocked.code, message: blocked.message, failure: { kind: 'guard_refused' } }
        };
      }
      if (requestAbort.aborted) return timedOut(url, timeoutMs);
      return fetchFailed(url, error);
    }
    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('text/html')) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: 'unsupported',
        url: response.url,
        metadata: { method: 'http', cacheHit: false, contentType }
      };
    }

    let html: string;
    try {
      html = await response.text();
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (requestAbort.aborted) return timedOut(url, timeoutMs);
      return fetchFailed(url, error);
    }
    const baselineExtraction = extractReadableContentSafely(html);
    const queryExtraction = query ? extractReadableContentForQuery(html, query) : undefined;
    const extraction = queryExtraction ?? baselineExtraction;
    const content = {
      ...extraction.content,
      ...(hasBotCheckContent(html, 'html') ? { botCheck: true } : {})
    };

    if (
      looksLikeScriptShell(html) ||
      baselineExtraction.content.text.length < 40 ||
      isWeakHttpContent({ html, title: baselineExtraction.content.title, text: baselineExtraction.content.text })
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
      metadata: { method: 'http', cacheHit: false, contentType, truncated: queryExtraction?.omitted ?? content.text.length >= 4000 }
    };
  };
}
