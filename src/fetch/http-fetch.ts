import { extractReadableContentForQuery, extractReadableContentSafely } from '../extract/readability.js';
import { clipCodePoints, codePoints } from '../results/content-length.js';
import { selectRelevantContent } from '../extract/section-selector.js';
import { detectAgentDirectedParagraphs, finalUrlAgentFileNote } from '../safety/agent-directed.js';
import { hasBotCheckContent } from '../extract/bot-check.js';
import { RedirectError } from './guarded-fetch.js';
import { findGuardError } from './network-guard.js';
import { targetStatusFailure, targetStatusMayNeedHeadless, targetStatusMessage } from './target-status.js';
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

const PLAIN_TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);
// Enough for a large llms-full.txt; anything past this is cut and reported as retrievalCut.
const PLAIN_TEXT_MAX_BYTES = 2 * 1024 * 1024;
const PLAIN_TEXT_MAX_CHARS = 4000;
const MARKDOWN_FILE_NAMES = new Set(['llms.txt', 'llms-full.txt']);

function mediaType(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

function charsetOf(contentType: string): string | undefined {
  return contentType.match(/;\s*charset\s*=\s*"?([^";\s]+)/i)?.[1];
}

function lastPathSegment(url: string): string | undefined {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : undefined;
  } catch {
    return undefined;
  }
}

function plainFormat(contentType: string, url: string): 'markdown' | 'text' {
  const type = mediaType(contentType);
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown';
  const name = lastPathSegment(url)?.toLowerCase() ?? '';
  return /\.(?:md|markdown|mdx)$/.test(name) || MARKDOWN_FILE_NAMES.has(name) ? 'markdown' : 'text';
}

function plainTitle(text: string, url: string): string | undefined {
  for (const line of text.split('\n', 30)) {
    const heading = line.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading) return heading;
  }
  return lastPathSegment(url);
}

// Colour and cursor codes from terminal logs are text, not control bytes.
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;
  const visible = text.replace(ANSI_CSI, '');
  const controls = visible.length - visible.replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F]/g, '').length;
  return controls / Math.max(visible.length, 1) > 0.05;
}

const HTML_DOCTYPE_OR_ROOT = /(?:<!doctype\s+html\b|<html\b)/iy;

// Leading whitespace and comments are skipped, so a commented page still sniffs as HTML.
function looksLikeHtml(text: string): boolean {
  let index = 0;
  for (;;) {
    while (index < text.length && /\s/.test(text[index]!)) index += 1;
    if (!text.startsWith('<!--', index)) break;
    const end = text.indexOf('-->', index + 4);
    if (end < 0) return false;
    index = end + 3;
  }
  HTML_DOCTYPE_OR_ROOT.lastIndex = index;
  return HTML_DOCTYPE_OR_ROOT.test(text);
}

/** Reads at most maxBytes. The second value says whether the body was cut short. */
async function readCappedText(response: Response, contentType: string, maxBytes: number): Promise<{ text: string; cut: boolean }> {
  if (!response.body) return { text: '', cut: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      cut = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const charset = charsetOf(contentType);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return { text: decoder.decode(bytes), cut };
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

function htmlPage({
  html, response, url, contentType, query, retrievalCut
}: {
  html: string;
  response: Response;
  url: string;
  contentType: string;
  query?: string;
  retrievalCut: boolean;
}): WebFetchResponse {
  const baselineExtraction = extractReadableContentSafely(html);
  const queryExtraction = query ? extractReadableContentForQuery(html, query) : undefined;
  const extraction = queryExtraction ?? baselineExtraction;
  const note = finalUrlAgentFileNote(response.url || url);
  const content = {
    ...extraction.content,
    sourceSafety: {
      flaggedParagraphs: note ? [] : extraction.content.sourceSafety?.flaggedParagraphs ?? [],
      agentNotes: note ? [note] : []
    },
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
    metadata: {
      method: 'http', cacheHit: false, contentType,
      retrievalCut,
      selectionOmitted: queryExtraction?.omitted ?? false,
      truncated: queryExtraction?.omitted ?? content.text.length >= 4000
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
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const error = {
        code: 'HTTP_STATUS',
        message: targetStatusMessage(response.status),
        failure: targetStatusFailure(response.status)
      };
      if (targetStatusMayNeedHeadless(response.status)) {
        return {
          status: 'needs_headless', url: response.url || url,
          metadata: { method: 'http', cacheHit: false }, error
        };
      }
      return {
        status: 'error', url: response.url || url,
        metadata: { method: 'http', cacheHit: false }, error
      };
    }
    const contentType = response.headers.get('content-type') ?? '';
    const plain = PLAIN_TEXT_TYPES.has(mediaType(contentType));

    if (!contentType.includes('text/html') && !plain) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: 'unsupported',
        url: response.url,
        metadata: { method: 'http', cacheHit: false, contentType }
      };
    }

    if (!plain) {
      let html: string;
      try {
        html = await response.text();
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (requestAbort.aborted) return timedOut(url, timeoutMs);
        return fetchFailed(url, error);
      }
      return htmlPage({ html, response, url, contentType, query, retrievalCut: false });
    }

    let body: { text: string; cut: boolean };
    try {
      body = await readCappedText(response, contentType, PLAIN_TEXT_MAX_BYTES);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (requestAbort.aborted) return timedOut(url, timeoutMs);
      return fetchFailed(url, error);
    }
    const raw = body.text.replace(/^\uFEFF/, '');
    if (looksBinary(raw)) {
      return {
        status: 'unsupported', url: response.url, metadata: { method: 'http', cacheHit: false, contentType },
        error: { code: 'BINARY_CONTENT', message: 'The response looks like a binary file, not text.' }
      };
    }
    // Some servers label HTML as plain text. Read it like any other page.
    if (looksLikeHtml(raw)) {
      return htmlPage({ html: raw, response, url, contentType, query, retrievalCut: body.cut });
    }

    const text = raw.replace(/\r\n?/g, '\n');
    if (!text.trim()) {
      return {
        status: 'unsupported', url: response.url, metadata: { method: 'http', cacheHit: false, contentType },
        error: { code: 'EMPTY_BODY', message: 'The page returned no text.' }
      };
    }

    const finalUrl = response.url || url;
    const format = plainFormat(contentType, finalUrl);
    const note = finalUrlAgentFileNote(finalUrl);
    const selection = query
      ? selectRelevantContent({ source: text, format, query, maxLength: PLAIN_TEXT_MAX_CHARS })
      : undefined;
    const content = {
      title: plainTitle(text, finalUrl),
      text: selection?.text ?? clipCodePoints(text, PLAIN_TEXT_MAX_CHARS),
      sourceSafety: {
        flaggedParagraphs: note ? [] : detectAgentDirectedParagraphs(text, format),
        agentNotes: note ? [note] : []
      },
      ...(selection?.anchor ? { sectionAnchor: selection.anchor } : {})
    };

    return {
      status: 'ok',
      url: finalUrl,
      content,
      metadata: {
        method: 'http', cacheHit: false, contentType,
        retrievalCut: body.cut,
        selectionOmitted: selection?.omitted ?? false,
        truncated: selection ? selection.omitted : codePoints(text) >= PLAIN_TEXT_MAX_CHARS
      }
    };
  };
}
