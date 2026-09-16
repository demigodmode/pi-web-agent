import type { FailureInfo } from '../types.js';

export const DEFAULT_COOLDOWN_MS = 60_000;
export const MIN_COOLDOWN_MS = 1000;
export const MAX_COOLDOWN_MS = 15 * 60_000;

export type ProviderHealthState =
  | { state: 'available' }
  | { state: 'cooling_down'; until: number; failure: FailureInfo }
  | { state: 'disabled'; failure: FailureInfo };

export type ProviderHealth = {
  get(key: string): ProviderHealthState;
  record(key: string, failure: FailureInfo): ProviderHealthState;
};

/** The applied cooldown. The provider's own value stays in failure.providerRetryAfterMs. */
export function cooldownFor(failure: FailureInfo): number {
  const raw = failure.providerRetryAfterMs;
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_COOLDOWN_MS;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, raw));
}

/**
 * Per backend set. The set is rebuilt on any effective config change, so fixed
 * credentials or new endpoints take effect without restarting Pi.
 */
export function createProviderHealth({ now = Date.now }: { now?: () => number } = {}): ProviderHealth {
  const states = new Map<string, Exclude<ProviderHealthState, { state: 'available' }>>();

  function get(key: string): ProviderHealthState {
    const current = states.get(key);
    if (!current) return { state: 'available' };
    if (current.state === 'cooling_down' && current.until <= now()) {
      states.delete(key);
      return { state: 'available' };
    }
    return current;
  }

  function record(key: string, failure: FailureInfo): ProviderHealthState {
    const current = get(key);
    if (current.state === 'disabled') return current;

    switch (failure.kind) {
      case 'rate_limited': {
        const next = { state: 'cooling_down' as const, until: now() + cooldownFor(failure), failure };
        states.set(key, next);
        return next;
      }
      case 'quota_exhausted':
      case 'auth_failed':
      case 'not_configured': {
        const next = { state: 'disabled' as const, failure };
        states.set(key, next);
        return next;
      }
      default:
        return current;
    }
  }

  return { get, record };
}
