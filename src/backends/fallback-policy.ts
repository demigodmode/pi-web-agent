import { buildFetchPresentation } from '../presentation/fetch-presentation.js';
import { buildSearchPresentation } from '../presentation/search-presentation.js';
import type { Attempt, FailureInfo, ResearchFetchInput, SearchProviderName, WebFetchResponse, WebSearchResponse } from '../types.js';
import { failureOf, shouldFallBack } from './failure.js';
import type { ProviderHealth, ProviderHealthState } from './provider-health.js';

export const RETRY_BASE_MS = 500;
export const RETRY_JITTER_MS = 250;

export type PolicyDeps = {
  health: ProviderHealth;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

type Search = (input: { query: string }) => Promise<WebSearchResponse>;
type FetchPage = (input: ResearchFetchInput) => Promise<WebFetchResponse>;

const USER_FIXABLE_KINDS: ReadonlySet<string> = new Set(['not_configured', 'auth_failed', 'quota_exhausted']);

/** Only user-fixable failures keep the provider's message; everything else stays message-free. */
function detailFor(failure: FailureInfo, message: string | undefined): string | undefined {
  return message && USER_FIXABLE_KINDS.has(failure.kind) ? message : undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelay(deps: PolicyDeps): number {
  return RETRY_BASE_MS + Math.floor((deps.random ?? Math.random)() * RETRY_JITTER_MS);
}

function skipAttempt(backend: string, state: Exclude<ProviderHealthState, { state: 'available' }>): Attempt {
  return {
    backend,
    outcome: 'skipped',
    failure: state.failure,
    skipReason: state.state,
    ...(state.state === 'cooling_down' ? { cooldownUntil: state.until } : {}),
    ...(state.detail ? { detail: state.detail } : {})
  };
}

function skipMessage(backend: string, state: Exclude<ProviderHealthState, { state: 'available' }>): string {
  const base = state.state === 'cooling_down'
    ? `${backend} is cooling down after ${state.failure.kind} until ${new Date(state.until).toISOString()}.`
    : `${backend} is disabled for this session after ${state.failure.kind}.`;
  return state.detail ? `${base} ${state.detail}` : base;
}

function failedAttempt(backend: string, failure: FailureInfo, state: ProviderHealthState, detail?: string): Attempt {
  return {
    backend,
    outcome: 'failed',
    failure,
    ...(state.state === 'cooling_down' ? { cooldownUntil: state.until } : {}),
    ...(detail ? { detail } : {})
  };
}

/**
 * One provider under the #55 policy: skip when cooling down or disabled,
 * retry exactly once on transient, record state. Never falls back itself.
 */
export function withSearchPolicy(name: SearchProviderName, search: Search, deps: PolicyDeps, healthKey: string = name): Search {
  return async (input) => {
    const state = deps.health.get(healthKey);
    if (state.state !== 'available') {
      return {
        status: 'error',
        results: [],
        metadata: { backend: name, cacheHit: false, attempts: [skipAttempt(name, state)] },
        error: { code: 'BACKEND_UNAVAILABLE', message: skipMessage(name, state), failure: state.failure }
      };
    }

    const attempts: Attempt[] = [];
    let result = await search(input);
    let failure = failureOf(result);
    if (failure?.kind === 'transient') {
      attempts.push({ backend: name, outcome: 'retried', failure });
      await (deps.sleep ?? defaultSleep)(retryDelay(deps));
      result = await search(input);
      failure = failureOf(result);
    }

    if (failure) {
      const detail = detailFor(failure, result.error?.message);
      attempts.push(failedAttempt(name, failure, deps.health.record(healthKey, failure, detail), detail));
    } else {
      attempts.push({ backend: name, outcome: result.results.length > 0 ? 'results' : 'empty' });
    }
    return { ...result, metadata: { ...result.metadata, attempts: [...(result.metadata.attempts ?? []), ...attempts] } };
  };
}

function unavailableMessage(attempts: Attempt[], messages: Map<string, string> = new Map()): string {
  const byProvider = new Map<string, Attempt>();
  for (const attempt of attempts) {
    if (attempt.outcome === 'failed' || attempt.outcome === 'skipped') byProvider.set(attempt.backend, attempt);
  }
  const entries = [...byProvider.values()].sort((a, b) => {
    const aUntil = a.cooldownUntil ?? Number.POSITIVE_INFINITY;
    const bUntil = b.cooldownUntil ?? Number.POSITIVE_INFINITY;
    return aUntil - bUntil;
  });
  const parts = entries.map((attempt) => {
    const kind = attempt.failure?.kind ?? 'bad_response';
    if (attempt.cooldownUntil !== undefined) {
      return `${attempt.backend} ${kind} (available again at ${new Date(attempt.cooldownUntil).toISOString()})`;
    }
    // Keep the provider's own hint for problems the user has to fix, e.g. a missing key or base URL.
    const hint = USER_FIXABLE_KINDS.has(kind)
      ? attempt.detail ?? (attempt.outcome === 'failed' ? messages.get(attempt.backend) : undefined)
      : undefined;
    return hint ? `${attempt.backend} ${kind} (${hint})` : `${attempt.backend} ${kind}`;
  });
  return `No search backend is available: ${parts.join(', ')}.`;
}

/**
 * A failed link's unavailable providers, from its own attempts: the last failed or skipped
 * attempt per backend with that attempt's kind. A fanout link reports each provider, not the
 * aggregate. Falls back to the aggregate only when the link carries no failed or skipped attempts.
 */
function unavailableFor(result: WebSearchResponse, failure: FailureInfo): Array<{ provider: string; kind: FailureInfo['kind']; message: string }> {
  const message = result.error?.message ?? failure.kind;
  const byProvider = new Map<string, { provider: string; kind: FailureInfo['kind']; message: string }>();
  for (const entry of result.metadata.coverage?.unavailable ?? []) {
    byProvider.set(entry.provider, { ...entry, message });
  }
  const attempts = result.metadata.attempts ?? [];
  const relevant = attempts.filter((a) => a.outcome === 'failed' || a.outcome === 'skipped');
  if (relevant.length === 0) {
    byProvider.set(result.metadata.backend, { provider: result.metadata.backend, kind: failure.kind, message });
  }
  for (const attempt of relevant) {
    byProvider.delete(attempt.backend); // keep insertion order at the latest attempt
    byProvider.set(attempt.backend, {
      provider: attempt.backend,
      kind: attempt.failure?.kind ?? failure.kind,
      message: attempt.detail ?? message
    });
  }
  return [...byProvider.values()];
}

/**
 * Tries providers in order under the precedence in the #55 spec: terminal and
 * bad_request failures stop the chain; a result or a valid empty response is
 * returned; everything else falls back.
 */
export function chainSearch(providers: Search[], deps: PolicyDeps): Search {
  return async (input) => {
    const attempts: Attempt[] = [];
    const unavailable: Array<{ provider: string; kind: FailureInfo['kind']; message: string }> = [];
    let lastFailure: FailureInfo | undefined;
    let firstBackend: SearchProviderName | undefined;
    // Keep an earlier fanout's provenance (which providers were tried) when a later link answers.
    let fanout: WebSearchResponse['metadata']['fanout'];

    for (const provider of providers) {
      const result = await provider(input);
      firstBackend ??= result.metadata.backend;
      attempts.push(...(result.metadata.attempts ?? []));
      fanout ??= result.metadata.fanout;
      const failure = failureOf(result);

      if (!failure) {
        const first = unavailable[0];
        const merged: WebSearchResponse = {
          ...result,
          metadata: {
            ...result.metadata,
            ...(fanout && !result.metadata.fanout ? { fanout } : {}),
            attempts,
            ...(first
              ? {
                  fallbackFrom: first.provider as SearchProviderName,
                  fallbackReason: first.message,
                  coverage: { partial: true, unavailable: unavailable.map(({ provider, kind }) => ({ provider, kind })) }
                }
              : {})
          }
        };
        return { ...merged, presentation: buildSearchPresentation(merged) };
      }

      if (!shouldFallBack(failure.kind)) {
        const stopped: WebSearchResponse = { ...result, metadata: { ...result.metadata, attempts } };
        return { ...stopped, presentation: buildSearchPresentation(stopped) };
      }

      for (const entry of unavailableFor(result, failure)) {
        const existing = unavailable.findIndex((u) => u.provider === entry.provider);
        if (existing >= 0) unavailable.splice(existing, 1);
        unavailable.push(entry);
      }
      lastFailure = failure;
    }

    const exhausted: WebSearchResponse = {
      status: 'error',
      results: [],
      metadata: { backend: firstBackend ?? 'duckduckgo', cacheHit: false, attempts },
      error: {
        code: 'SEARCH_BACKENDS_UNAVAILABLE',
        message: unavailableMessage(attempts, new Map(unavailable.map((entry) => [entry.provider, entry.message]))),
        failure: lastFailure ?? { kind: 'bad_response' }
      }
    };
    return { ...exhausted, presentation: buildSearchPresentation(exhausted) };
  };
}

/**
 * Firecrawl under the policy, with the optional HTTP fallback. The HTTP fetcher
 * talks to the model-chosen site, not a service, so it has no provider health.
 */
export function withFetchPolicy(primary: FetchPage, fallback: FetchPage | undefined, deps: PolicyDeps, healthKey = 'firecrawl'): FetchPage {
  const finish = (result: WebFetchResponse): WebFetchResponse => ({ ...result, presentation: buildFetchPresentation(result) });

  return async (input) => {
    const attempts: Attempt[] = [];
    const state = deps.health.get(healthKey);
    let first: WebFetchResponse | undefined;

    if (state.state !== 'available') {
      attempts.push(skipAttempt('firecrawl', state));
      first = {
        status: 'error',
        url: input.url,
        metadata: { method: 'firecrawl', cacheHit: false },
        error: { code: 'BACKEND_UNAVAILABLE', message: skipMessage('firecrawl', state), failure: state.failure }
      };
    } else {
      first = await primary(input);
      let failure = failureOf(first);
      if (failure?.kind === 'transient') {
        attempts.push({ backend: 'firecrawl', outcome: 'retried', failure });
        await (deps.sleep ?? defaultSleep)(retryDelay(deps));
        first = await primary(input);
        failure = failureOf(first);
      }
      if (failure) {
        const detail = detailFor(failure, first.error?.message);
        attempts.push(failedAttempt('firecrawl', failure, deps.health.record(healthKey, failure, detail), detail));
      }
      else attempts.push({ backend: 'firecrawl', outcome: first.status === 'ok' ? 'results' : 'empty' });
    }

    const failure = failureOf(first);
    const fallBack = first.status === 'needs_headless' || (failure !== undefined && shouldFallBack(failure.kind));
    if (!fallback || !fallBack) {
      return finish({ ...first, metadata: { ...first.metadata, attempts } });
    }

    const second = await fallback(input);
    attempts.push({ backend: 'http', outcome: second.status === 'ok' ? 'results' : 'failed', ...(second.error?.failure ? { failure: second.error.failure } : {}) });
    return finish({
      ...second,
      metadata: {
        ...second.metadata,
        attempts,
        fallbackFrom: 'firecrawl',
        fallbackReason: first.error?.message ?? 'Firecrawl fetch failed.'
      }
    });
  };
}
