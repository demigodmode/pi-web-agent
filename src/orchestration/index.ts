import { createBackendSet } from '../backends/factory.js';
import type { BackendConfig } from '../backends/config.js';
import type { WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
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
  fetchPage?: (input: { url: string }) => Promise<WebFetchResponse>;
  headlessFetch?: (input: { url: string }) => Promise<WebFetchHeadlessResponse>;
} = {}) {
  const backends = createBackendSet(backendConfig);
  const resolvedSearch = search ?? backends.search;
  const resolvedFetchPage = fetchPage ?? backends.fetchPage;
  const resolvedHeadlessFetch = headlessFetch ?? backends.headlessFetch;
  const worker = createResearchWorker({ search: resolvedSearch, fetchPage: resolvedFetchPage });
  return createResearchOrchestrator({ worker, headlessFetch: resolvedHeadlessFetch });
}
