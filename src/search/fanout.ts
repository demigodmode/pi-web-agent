import { buildSearchPresentation } from '../presentation/search-presentation.js';
import { canonicalizeUrl } from '../orchestration/url.js';
import { failureOf, isTerminalFailure } from '../backends/failure.js';
import type { Attempt, FailureInfo, FanoutMetadata, FanoutMode, FanoutOutcome, SearchProviderName, SearchResult, WebSearchResponse } from '../types.js';

export type FanoutProvider = {
  name: SearchProviderName;
  search: (input: { query: string }) => Promise<WebSearchResponse>;
};

const FANOUT_MIN_RESULTS = 3;

type RankedEntry = {
  result: SearchResult;
  providers: Set<SearchProviderName>;
  bestRank: number;
};

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function primaryLooksWeak(results: SearchResult[]): boolean {
  if (results.length < FANOUT_MIN_RESULTS) return true;
  const hosts = new Set(results.map((r) => hostOf(r.url)).filter(Boolean));
  return hosts.size <= 1;
}

function merge(lists: Array<{ name: SearchProviderName; results: SearchResult[] }>): SearchResult[] {
  const byKey = new Map<string, RankedEntry>();

  for (const { name, results } of lists) {
    const seenThisProvider = new Set<string>();
    results.forEach((result, index) => {
      const key = canonicalizeUrl(result.url) ?? result.url;
      if (seenThisProvider.has(key)) return; // ignore duplicates within a single provider's own list
      seenThisProvider.add(key);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { result: { ...result }, providers: new Set([name]), bestRank: index });
        return;
      }
      existing.providers.add(name);
      existing.bestRank = Math.min(existing.bestRank, index);
      if ((result.title?.length ?? 0) > (existing.result.title?.length ?? 0)) existing.result.title = result.title;
      if ((result.snippet?.length ?? 0) > (existing.result.snippet?.length ?? 0)) existing.result.snippet = result.snippet;
    });
  }

  return [...byKey.values()]
    .sort((a, b) => b.providers.size - a.providers.size || a.bestRank - b.bestRank)
    .map((entry) => entry.result);
}

function withPresentation(result: WebSearchResponse): WebSearchResponse {
  return { ...result, presentation: buildSearchPresentation(result) };
}

const FANOUT_PROVIDER_TIMEOUT_MS = 8000;

/** A provider that doesn't answer in time (or throws) counts as a transient failure, so one
 *  slow/unreachable provider (e.g. a down self-hosted SearXNG) can't stall the whole fanout. */
function withTimeout(promise: Promise<WebSearchResponse>, ms: number, name: SearchProviderName): Promise<WebSearchResponse> {
  const timedOut = (): WebSearchResponse => ({
    status: 'error',
    results: [],
    metadata: { backend: name, cacheHit: false },
    error: { code: 'FETCH_FAILED', message: `${name} did not answer in time.`, failure: { kind: 'transient' } }
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(timedOut()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(timedOut());
      }
    );
  });
}

function outcomeOf(name: SearchProviderName, response: WebSearchResponse): FanoutOutcome {
  const failure = failureOf(response);
  if (!failure) {
    return response.results.length > 0 ? { provider: name, outcome: 'results', count: response.results.length } : { provider: name, outcome: 'empty' };
  }
  const skipped = response.metadata.attempts?.find((a) => a.outcome === 'skipped');
  return skipped
    ? { provider: name, outcome: 'skipped', failure, ...(skipped.skipReason ? { skipReason: skipped.skipReason } : {}) }
    : { provider: name, outcome: 'failed', failure };
}

export function createFanoutSearch({
  providers,
  mode,
  timeoutMs = FANOUT_PROVIDER_TIMEOUT_MS
}: {
  providers: FanoutProvider[];
  mode: Exclude<FanoutMode, 'off'>;
  timeoutMs?: number;
}) {
  return async function fanoutSearch({ query }: { query: string }): Promise<WebSearchResponse> {
    const [primary, ...rest] = providers;

    async function runSet(set: FanoutProvider[]) {
      const responses = await Promise.all(set.map((p) => withTimeout(p.search({ query }), timeoutMs, p.name)));
      return set.map((provider, i) => ({ provider, response: responses[i] }));
    }

    function finalize(entries: Array<{ provider: FanoutProvider; response: WebSearchResponse }>, resolvedMode: Exclude<FanoutMode, 'off'>): WebSearchResponse {
      const outcomes = entries.map(({ provider, response }) => outcomeOf(provider.name, response));
      const attempts: Attempt[] = entries.flatMap(({ response }) => response.metadata.attempts ?? []);
      const contributing = entries.filter((_, i) => outcomes[i].outcome === 'results');
      const fanout: FanoutMetadata = {
        mode: resolvedMode,
        providers: contributing.map(({ provider }) => provider.name),
        outcomes
      };
      const skippedNames = outcomes.filter((o) => o.outcome !== 'results').map((o) => o.provider);
      if (skippedNames.length > 0) fanout.skipped = skippedNames;

      // 1. terminal
      const terminal = entries.find(({ response }) => isTerminalFailure(failureOf(response)));
      if (terminal) {
        return withPresentation({ ...terminal.response, metadata: { ...terminal.response.metadata, backend: primary.name, fanout, attempts } });
      }

      const unavailable = outcomes
        .filter((o) => o.outcome === 'failed' || o.outcome === 'skipped')
        .map((o) => ({ provider: o.provider, kind: (o.failure as FailureInfo).kind }));
      const coverage = unavailable.length > 0 ? { coverage: { partial: true as const, unavailable } } : {};

      // 2. results
      if (contributing.length > 0) {
        return withPresentation({
          status: 'ok',
          results: merge(contributing.map(({ provider, response }) => ({ name: provider.name, results: response.results }))),
          metadata: { backend: primary.name, cacheHit: false, fanout, attempts, ...coverage }
        });
      }

      // 3. valid empty
      if (outcomes.some((o) => o.outcome === 'empty')) {
        return withPresentation({ status: 'ok', results: [], metadata: { backend: primary.name, cacheHit: false, fanout, attempts, ...coverage } });
      }

      // 4. all failed or skipped: non-terminal, so an outer fallback may still run
      const lastFailure = [...outcomes].reverse().find((o) => o.failure)?.failure ?? { kind: 'bad_response' as const };
      return withPresentation({
        status: 'error',
        results: [],
        metadata: { backend: primary.name, cacheHit: false, fanout, attempts },
        error: { code: 'FANOUT_ALL_FAILED', message: 'Every fanout provider failed or was unavailable.', failure: lastFailure }
      });
    }

    if (mode === 'auto') {
      const primaryResponse = await withTimeout(primary.search({ query }), timeoutMs, primary.name);
      if (isTerminalFailure(failureOf(primaryResponse))) {
        return finalize([{ provider: primary, response: primaryResponse }], 'auto');
      }
      if (primaryResponse.status === 'ok' && primaryResponse.results.length > 0 && !primaryLooksWeak(primaryResponse.results)) {
        return withPresentation(primaryResponse); // strong primary: no fanout
      }
      return finalize([{ provider: primary, response: primaryResponse }, ...(await runSet(rest))], 'auto');
    }

    return finalize(await runSet(providers), 'on');
  };
}
