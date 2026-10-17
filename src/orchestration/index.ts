import { createBackendSet, type BackendSet } from '../backends/factory.js';
import type { BackendConfig } from '../backends/config.js';
import type { RepoCache } from '../repo/repo-cache.js';
import type { ResearchFetchInput, SearchInput, WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { createResearchOrchestrator } from './research-orchestrator.js';
import { createResearchWorker } from './research-worker.js';

const WORKFLOW_DRAIN_GRACE_MS = 5_000;

async function waitWithin<T>(work: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  // The caller is allowed to proceed at the deadline, but a backend may still
  // settle later. Keep observing that result so a late rejection is handled.
  void work.catch(() => undefined);
  let timer: number | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = globalThis.setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createResearchWorkflow({
  backendConfig,
  search,
  fetchPage,
  headlessFetch,
  repoCache,
  researchRepo
}: {
  backendConfig?: BackendConfig;
  search?: (input: SearchInput) => Promise<WebSearchResponse>;
  fetchPage?: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
  headlessFetch?: (input: ResearchFetchInput) => Promise<WebFetchHeadlessResponse>;
  /** The extension's session repo cache (#72). */
  repoCache?: RepoCache;
  /** Test seam: repo research without a backend set. */
  researchRepo?: BackendSet['researchRepo'];
} = {}) {
  // Only build (and own) a backend set when something wasn't injected.
  const backends = search && fetchPage && headlessFetch ? undefined : createBackendSet(backendConfig, repoCache ? { repoCache } : {});
  const resolvedSearch = search ?? backends!.search;
  const resolvedFetchPage = fetchPage ?? backends!.fetchPage;
  const resolvedHeadlessFetch = headlessFetch ?? backends!.headlessFetch;
  const worker = createResearchWorker({ search: resolvedSearch, fetchPage: resolvedFetchPage });
  const orchestrator = createResearchOrchestrator({
    worker,
    fetchDirect: resolvedFetchPage,
    headlessFetch: resolvedHeadlessFetch,
    researchRepo: researchRepo ?? backends?.researchRepo
  });
  let closing: Promise<void> | undefined;
  return Object.assign(orchestrator, {
    /** Releases the backend set this workflow created. Injected capabilities and the repo cache are left alone. */
    close: () => (closing ??= (async () => {
      await waitWithin(orchestrator.drain(), WORKFLOW_DRAIN_GRACE_MS);
      await waitWithin(Promise.resolve(backends?.close?.()), WORKFLOW_DRAIN_GRACE_MS);
    })())
  });
}
