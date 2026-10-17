import { raceAbort, throwIfAborted } from '../abort.js';
import { extractDirectUrls } from './direct-url.js';

export type ResearchBudgetReason = 'deadline' | 'search-limit' | 'fetch-limit' | 'headless-limit';

export type ResearchBudgetSnapshot = {
  searches: number;
  fetches: number;
  headless: number;
  limitReason?: ResearchBudgetReason;
};

export type ResearchRunBudget = ReturnType<typeof createResearchRunBudget>;

export function createResearchRunBudget({
  signal: callerSignal,
  now = () => Date.now(),
  timeoutMs = 120_000,
  maxSearches = 5,
  maxFetches = 20,
  maxHeadless = 2,
  track = () => undefined
}: {
  signal?: AbortSignal;
  now?: () => number;
  timeoutMs?: number;
  maxSearches?: number;
  maxFetches?: number;
  maxHeadless?: number;
  track?: (promise: Promise<unknown>) => void;
}) {
  const deadline = now() + timeoutMs;
  const deadlineController = new AbortController();
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadlineController.signal]) : deadlineController.signal;
  const visitedUrls = new Set<string>();
  const counts = { searches: 0, fetches: 0, headless: 0 };
  let limitReason: ResearchBudgetReason | undefined;
  const timer = setTimeout(() => {
    limitReason = 'deadline';
    deadlineController.abort();
  }, Math.max(0, timeoutMs));
  timer.unref?.();

  function deadlineReached() {
    return deadlineController.signal.aborted || now() >= deadline;
  }

  function claim(kind: keyof typeof counts, max: number, reason: ResearchBudgetReason) {
    throwIfAborted(callerSignal);
    if (deadlineReached()) {
      limitReason = 'deadline';
      return false;
    }
    if (counts[kind] >= max) {
      limitReason = reason;
      return false;
    }
    counts[kind]++;
    return true;
  }

  return {
    signal,
    visitedUrls,
    claimSearch: () => claim('searches', maxSearches, 'search-limit'),
    claimFetch(url: string) {
      throwIfAborted(callerSignal);
      if (deadlineReached()) {
        limitReason = 'deadline';
        return false;
      }
      const canonical = extractDirectUrls(url)[0] ?? url;
      if (visitedUrls.has(canonical)) return false;
      if (!claim('fetches', maxFetches, 'fetch-limit')) return false;
      visitedUrls.add(canonical);
      return true;
    },
    claimHeadless: () => claim('headless', maxHeadless, 'headless-limit'),
    deadlineReached,
    snapshot(): ResearchBudgetSnapshot { return { ...counts, ...(limitReason ? { limitReason } : {}) }; },
    wait<T>(promise: Promise<T>): Promise<T> {
      track(promise);
      return raceAbort(promise, signal);
    },
    dispose() { clearTimeout(timer); }
  };
}
