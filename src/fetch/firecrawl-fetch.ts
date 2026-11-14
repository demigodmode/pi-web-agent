import type { FirecrawlOptions } from '../backends/config.js';
import { classifyHttpFailure, readResponseParts } from '../backends/provider-failure.js';
import { selectRelevantContent } from '../extract/section-selector.js';
import { hasBotCheckContent } from '../extract/bot-check.js';
import { FIRECRAWL_FETCH_TIMEOUT_MS, abortError, requestSignal, throwIfAborted } from '../abort.js';
import { targetStatusFailure, targetStatusMayNeedHeadless, targetStatusMessage } from './target-status.js';
import type { FailureInfo, WebFetchResponse } from '../types.js';
import { detectAgentDirectedParagraphs, finalUrlAgentFileNote } from '../safety/agent-directed.js';

type FirecrawlResponse = {
  success?: boolean;
  code?: unknown;
  data?: {
    markdown?: unknown;
    html?: unknown;
    metadata?: {
      title?: unknown;
      sourceURL?: unknown;
      statusCode?: unknown;
    };
    statusCode?: unknown;
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
  fetchImpl = fetch,
  timeoutMs = FIRECRAWL_FETCH_TIMEOUT_MS
}: {
  baseUrl: string;
  apiKey?: string;
  options?: FirecrawlOptions;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  return async function firecrawlFetch(url: string, query?: string, signal?: AbortSignal): Promise<WebFetchResponse> {
    throwIfAborted(signal);
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

    const requestAbort = requestSignal(signal, timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(buildScrapeUrl(baseUrl), { method: 'POST', headers, body: JSON.stringify(body), signal: requestAbort });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      const message = requestAbort.aborted ? `Firecrawl did not answer within ${timeoutMs / 1000}s.` : `Firecrawl scrape failed: ${errorMessage(error)}`;
      return failed(message, { kind: 'transient' });
    }

    let parts: Awaited<ReturnType<typeof readResponseParts>>;
    try {
      parts = await readResponseParts(response);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      return failed(`Firecrawl scrape response could not be read: ${errorMessage(error)}`, { kind: 'transient' });
    }
    const parsed = parts.json as FirecrawlResponse | undefined;
    const targetStatuses = [parsed?.data?.statusCode, parsed?.data?.metadata?.statusCode]
      .filter((status): status is number => typeof status === 'number');
    // A terminal result for the requested page is more useful than the
    // provider's own status, including when Firecrawl wraps it in an API 500.
    const targetStatus = targetStatuses.find((status) => status === 404 || status === 410 || (status >= 500 && status <= 599))
      ?? targetStatuses.find((status) => status >= 400 && status <= 599);
    if (targetStatus !== undefined) {
      const error = { code: 'HTTP_STATUS', message: targetStatusMessage(targetStatus), failure: targetStatusFailure(targetStatus) };
      if (targetStatusMayNeedHeadless(targetStatus)) {
        return { status: 'needs_headless', url, metadata: { method: 'firecrawl', cacheHit: false }, error };
      }
      return { status: 'error', url, metadata: { method: 'firecrawl', cacheHit: false }, error };
    }

    if (response.status === 500 && parsed?.code === 'SCRAPE_ALL_ENGINES_FAILED') {
      return {
        status: 'needs_headless',
        url,
        metadata: { method: 'firecrawl', cacheHit: false },
        error: { code: 'WEAK_EXTRACTION', message: 'Firecrawl could not extract useful page text.' }
      };
    }

    if (!response.ok) {
      return failed(`Firecrawl scrape failed: HTTP ${response.status}`, classifyHttpFailure('firecrawl', parts));
    }

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
    const note = finalUrlAgentFileNote(resolvedUrl);
    const sourceSafety = {
      flaggedParagraphs: note ? [] : detectAgentDirectedParagraphs(markdown ?? html!, markdown !== undefined ? 'markdown' : 'html'),
      agentNotes: note ? [note] : []
    };

    return {
      status: 'ok',
      url: resolvedUrl,
      content: {
        title,
        text: selectedText,
        sourceSafety,
        ...(hasBotCheckContent(text, markdown !== undefined ? 'markdown' : 'html') ? { botCheck: true } : {}),
        ...(selection?.anchor ? { sectionAnchor: selection.anchor } : {})
      },
      metadata: {
        method: 'firecrawl', cacheHit: false,
        retrievalCut: false,
        selectionOmitted: selection?.omitted ?? false,
        truncated: selection?.omitted ?? text.length >= 4000
      }
    };
  };
}
