/**
 * Cancellation (#59). Pi hands every tool call an AbortSignal and waits for the
 * tool to settle, so every layer checks it and passes it on. A cancel is always
 * abortError(), whichever layer notices it first.
 */

/** Page and reader fetches have no other bound: a server that never answers would stall the run. */
export const PAGE_FETCH_TIMEOUT_MS = 15_000;

/** Firecrawl renders the page on its side, so it gets longer than a plain fetch. */
export const FIRECRAWL_FETCH_TIMEOUT_MS = 45_000;

/** PDFs can be large and the timer stays armed through the whole download, so they get more room than a plain page fetch. */
export const PDF_FETCH_TIMEOUT_MS = 60_000;

export function abortError(): Error {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/**
 * The caller's signal plus a per-request timeout. To tell a cancel from a
 * timeout afterwards, check the caller's signal, not the error.
 */
export function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** For requests made inside a library that takes a fetch but no signal (YouTube captions). */
export function fetchWithSignal(fetchImpl: typeof fetch, signal: AbortSignal): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetchImpl(input, { ...init, signal })) as typeof fetch;
}

/**
 * Settles with `work`, or rejects with abortError() as soon as the signal fires.
 * `work` keeps running after a cancel; whoever owns it still has to wait for it.
 */
export async function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // The abandoned work may still reject later; that is not an unhandled rejection.
  // Attach this before the early throw below, since the signal may already be aborted.
  work.catch(() => undefined);
  throwIfAborted(signal);
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
