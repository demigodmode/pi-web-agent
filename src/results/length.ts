import type { LengthLimit, ResolvedLength } from './types.js';

export const AUTO_CONTEXT_FRACTION = 0.04;
export const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

export function resolveLengthLimit(limit: LengthLimit, window?: number): ResolvedLength {
  if (limit === 'standard') return { kind: 'standard' };
  if (typeof limit === 'number') return { kind: 'bounded', chars: Math.max(1000, Math.floor(limit)) };
  if (limit === 'short' || limit === 'medium') {
    return { kind: 'bounded', chars: limit === 'short' ? 4000 : 8000 };
  }
  if (window === undefined || !Number.isFinite(window) || window <= 0) return { kind: 'standard' };

  return {
    kind: 'bounded',
    chars: Math.max(1000, Math.floor(window * AUTO_CONTEXT_FRACTION * ESTIMATED_CHARACTERS_PER_TOKEN))
  };
}
