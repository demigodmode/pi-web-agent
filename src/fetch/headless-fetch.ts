import type { WebFetchHeadlessResponse } from '../types.js';

export async function headlessFetch(url: string): Promise<WebFetchHeadlessResponse> {
  return {
    status: 'error',
    url,
    metadata: { method: 'headless', cacheHit: false },
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Headless fetch is not implemented in the first MVP slice.'
    }
  };
}
