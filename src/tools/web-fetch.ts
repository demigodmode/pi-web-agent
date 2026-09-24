import { createHttpFetcher } from '../fetch/http-fetch.js';
import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import type { ResearchFetchInput, WebFetchResponse } from '../types.js';

export function createWebFetchTool({
  fetchPage = ({ url, query }) => createHttpFetcher()(url, query)
}: {
  fetchPage?: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
} = {}) {
  return async function webFetch({ url, query }: ResearchFetchInput): Promise<WebFetchResponse> {
    if (!/^https?:\/\//.test(url)) {
      const result: WebFetchResponse = {
        status: 'unsupported',
        url,
        metadata: { method: 'http', cacheHit: false },
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
