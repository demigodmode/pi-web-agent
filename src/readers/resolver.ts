import type { ResearchFetchInput, WebFetchResponse } from '../types.js';
import type { SpecialContentReader } from './types.js';

type ResolverDeps = {
  readers: SpecialContentReader[];
  fallback: (input: ResearchFetchInput) => Promise<WebFetchResponse>;
};

export function createSpecialContentResolver({ readers, fallback }: ResolverDeps) {
  return async function resolve(input: ResearchFetchInput): Promise<WebFetchResponse> {
    const matched = readers.find((reader) => reader.canHandle(input.url));
    if (matched) {
      return matched.read(input.url);
    }

    const response = await fallback(input);
    if (response.status === 'unsupported' && response.metadata.contentType) {
      const byContentType = readers.find((reader) => reader.canHandleContentType?.(response.metadata.contentType!));
      if (byContentType) {
        return byContentType.read(input.url);
      }
    }
    return response;
  };
}
