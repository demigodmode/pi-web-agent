import type { WebFetchHeadlessResponse, WebFetchResponse, WebSearchResponse } from '../types.js';
import { createWebFetchHeadlessTool } from '../tools/web-fetch-headless.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { createResearchOrchestrator } from './research-orchestrator.js';
import { createResearchWorker } from './research-worker.js';

export function createResearchWorkflow({
  search = createWebSearchTool(),
  fetchPage = createWebFetchTool(),
  headlessFetch = createWebFetchHeadlessTool()
}: {
  search?: (input: { query: string }) => Promise<WebSearchResponse>;
  fetchPage?: (input: { url: string }) => Promise<WebFetchResponse>;
  headlessFetch?: (input: { url: string }) => Promise<WebFetchHeadlessResponse>;
} = {}) {
  const worker = createResearchWorker({ search, fetchPage });
  return createResearchOrchestrator({ worker, headlessFetch });
}
