import { headlessFetch } from '../fetch/headless-fetch.js';
import type { WebFetchHeadlessResponse } from '../types.js';

export function createWebFetchHeadlessTool({
  fetchPage = headlessFetch
}: {
  fetchPage?: (url: string) => Promise<WebFetchHeadlessResponse>;
} = {}) {
  return async function webFetchHeadless({ url }: { url: string }): Promise<WebFetchHeadlessResponse> {
    if (!/^https?:\/\//.test(url)) {
      return {
        status: 'unsupported',
        url,
        metadata: { method: 'headless', cacheHit: false },
        error: { code: 'UNSUPPORTED_URL', message: 'Only http and https URLs are supported.' }
      };
    }

    return fetchPage(url);
  };
}
