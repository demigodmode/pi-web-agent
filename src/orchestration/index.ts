import { createBackendSet } from '../backends/factory.js';
import type { BackendConfig } from '../backends/config.js';
import type { ResearchFetchInput, WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { createResearchOrchestrator } from './research-orchestrator.js';
import { createResearchWorker } from './research-worker.js';

export function createResearchWorkflow({
  backendConfig,
  search,
  fetchPage,
  headlessFetch
}: {
  backendConfig?: BackendConfig;
  search?: (input: { query: string }) => Promise<WebSearchResponse>;
  fetchPage?: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
  headlessFetch?: (input: ResearchFetchInput) => Promise<WebFetchHeadlessResponse>;
} = {}) {
  // Only build (and own) a backend set when something wasn't injected.
  const backends = search && fetchPage && headlessFetch ? undefined : createBackendSet(backendConfig);
  const resolvedSearch = search ?? backends!.search;
  const resolvedFetchPage = fetchPage ?? backends!.fetchPage;
  const resolvedHeadlessFetch = headlessFetch ?? backends!.headlessFetch;
  const worker = createResearchWorker({ search: resolvedSearch, fetchPage: resolvedFetchPage });
  const orchestrator = createResearchOrchestrator({
    worker,
    fetchDirect: resolvedFetchPage,
    headlessFetch: resolvedHeadlessFetch
  });
  return Object.assign(orchestrator, {
    /** Releases the backend set this workflow created. Injected capabilities are left alone. */
    async close() {
      await backends?.close?.();
    }
  });
}
