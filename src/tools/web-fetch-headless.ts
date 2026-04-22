import { headlessFetch } from '../fetch/headless-fetch.js';
import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import type { WebFetchHeadlessResponse } from '../types.js';

export function createWebFetchHeadlessTool({
  fetchPage = headlessFetch
}: {
  fetchPage?: (url: string) => Promise<WebFetchHeadlessResponse>;
} = {}) {
  return async function webFetchHeadless({ url }: { url: string }): Promise<WebFetchHeadlessResponse> {
    if (!/^https?:\/\//.test(url)) {
      const result: WebFetchHeadlessResponse = {
        status: 'unsupported',
        url,
        metadata: { method: 'headless', cacheHit: false },
        error: { code: 'UNSUPPORTED_URL', message: 'Only http and https URLs are supported.' }
      };

      return {
        ...result,
        presentation: buildFetchPresentation(result)
      };
    }

    const result = await fetchPage(url);
    return {
      ...result,
      presentation: buildFetchPresentation(result)
    };
  };
}
