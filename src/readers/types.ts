import type { WebFetchResponse } from '../types.js';

export type SpecialContentReader = {
  name: string;
  /** Cheap URL-shape check. No network. */
  canHandle(url: string): boolean;
  /** Optional: claim a response by content-type after a normal fetch (e.g. application/pdf). */
  canHandleContentType?(contentType: string): boolean;
  /** Produce a normal WebFetchResponse. Must never throw. The signal cancels the reader's requests. */
  read(url: string, signal?: AbortSignal): Promise<WebFetchResponse>;
};
