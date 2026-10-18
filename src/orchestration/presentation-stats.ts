import { isBotCheckContent } from '../extract/bot-check.js';
import type { FetchMethod, WebFetchHeadlessResponse, WebFetchResponse } from '../types.js';
import { canonicalizeUrl } from './url.js';

export type PresentationReadMethod = FetchMethod | 'repo';

export type PresentationStats = {
  searches: number;
  executedQueries: string[];
  pagesRead: number;
  failedReads: number;
  methods: Partial<Record<PresentationReadMethod, number>>;
};

type Attempt = { id: string; requestedIds: Set<string> };

export function createPresentationStats() {
  const executedQueries: string[] = [];
  const successfulIds = new Set<string>();
  const failures = new Map<string, Attempt>();
  const pending = new Map<string, Attempt>();
  const methodsByUrl = new Map<string, PresentationReadMethod>();
  const identity = (url: string) => canonicalizeUrl(url) ?? url;

  const recordAttempt = (collection: Map<string, Attempt>, url: string, requestedUrl?: string) => {
    const id = identity(url);
    const requestedId = requestedUrl ? identity(requestedUrl) : undefined;
    const existing = collection.get(id);
    const requestedIds = existing?.requestedIds ?? new Set<string>();
    if (requestedId) requestedIds.add(requestedId);
    collection.set(id, { id, requestedIds });
  };

  return {
    recordSearch(query: string) {
      executedQueries.push(query);
    },

    recordFailure(attemptedUrl: string) {
      recordAttempt(failures, attemptedUrl);
    },

    recordRead(result: WebFetchResponse | WebFetchHeadlessResponse, method: PresentationReadMethod = result.metadata.method, requestedUrl?: string) {
      if (result.status === 'needs_headless') {
        recordAttempt(pending, result.url, requestedUrl);
        return;
      }

      const readable = result.status === 'ok'
        && Boolean(result.content?.text.trim())
        && (method === 'repo' || !isBotCheckContent({
          title: result.content?.title,
          text: result.content?.text ?? '',
          botCheck: result.content?.botCheck
        }));
      if (!readable) {
        recordAttempt(failures, result.url, requestedUrl);
        return;
      }

      const finalId = identity(result.url);
      successfulIds.add(finalId);
      if (requestedUrl) successfulIds.add(identity(requestedUrl));
      if (!methodsByUrl.has(finalId)) methodsByUrl.set(finalId, method);
    },

    snapshot(): PresentationStats {
      const unresolved = new Set<string>();
      for (const attempt of [...failures.values(), ...pending.values()]) {
        if (!successfulIds.has(attempt.id) && ![...attempt.requestedIds].some((id) => successfulIds.has(id))) {
          unresolved.add(attempt.id);
        }
      }
      const methods: Partial<Record<PresentationReadMethod, number>> = {};
      for (const method of methodsByUrl.values()) methods[method] = (methods[method] ?? 0) + 1;
      return {
        searches: executedQueries.length,
        executedQueries: [...executedQueries],
        pagesRead: methodsByUrl.size,
        failedReads: unresolved.size,
        methods: { ...methods }
      };
    }
  };
}

export type PresentationStatsCollector = ReturnType<typeof createPresentationStats>;
