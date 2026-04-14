import { headlessFetch } from '../fetch/headless-fetch.js';
import type { WebFetchHeadlessResponse } from '../types.js';

export function createWebFetchHeadlessTool({
  fetchPage = headlessFetch
}: {
  fetchPage?: (url: string) => Promise<WebFetchHeadlessResponse>;
} = {}) {
  return async function webFetchHeadless({ url }: { url: string }) {
    return fetchPage(url);
  };
}
