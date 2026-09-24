import { headlessFetch } from '../fetch/headless-fetch.js';
import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import type { ResearchFetchInput, WebFetchHeadlessResponse } from '../types.js';

export function createWebFetchHeadlessTool({
  fetchPage = ({ url, query }) => headlessFetch(url, { query })
}: {
  fetchPage?: (input: ResearchFetchInput) => Promise<WebFetchHeadlessResponse>;
} = {}) {
  return async function webFetchHeadless({ url, query }: ResearchFetchInput): Promise<WebFetchHeadlessResponse> {
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

    const result = await fetchPage({ url, ...(query ? { query } : {}) });
    return {
      ...result,
      presentation: buildFetchPresentation(result)
    };
  };
}
