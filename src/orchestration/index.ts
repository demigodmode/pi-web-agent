import { createBackendSet, type BackendSet } from '../backends/factory.js';
import type { BackendConfig } from '../backends/config.js';
import type { RepoCache } from '../repo/repo-cache.js';
import type { ResearchFetchInput, SearchInput, WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { createResearchOrchestrator } from './research-orchestrator.js';
import { createResearchWorker } from './research-worker.js';

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
  return Object.assign(orchestrator, {
    /** Releases the backend set this workflow created. Injected capabilities and the repo cache are left alone. */
    async close() {
      await backends?.close?.();
    }
  });
}
