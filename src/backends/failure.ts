import type { FailureInfo, FailureKind, ToolError } from '../types.js';

const TERMINAL_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>(['config_global', 'guard_refused']);
const NO_FALLBACK_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>(['bad_request', 'config_global', 'guard_refused']);

/** Terminal failures never retry, never fall back, never escalate to headless (#55). */
export function isTerminalFailure(failure: FailureInfo | undefined): boolean {
  return failure !== undefined && TERMINAL_KINDS.has(failure.kind);
}

export function shouldFallBack(kind: FailureKind): boolean {
  return !NO_FALLBACK_KINDS.has(kind);
}

/** An error result's failure. Unclassified errors are treated as bad_response: fall back, no retry, no state. */
export function failureOf(result: { status: string; error?: ToolError }): FailureInfo | undefined {
  if (result.status !== 'error') return undefined;
  return result.error?.failure ?? { kind: 'bad_response' };
}

/** RFC 9110 Retry-After: delay-seconds (non-negative integer) or an HTTP-date. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    // A huge digit string overflows to Infinity; keep it finite (and JSON-safe) so the
    // cooldown clamps to the maximum instead of falling back to the default.
    return Number.isFinite(ms) ? Math.min(ms, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  }
  // IMF-fixdate only (RFC 9110 preferred form). V8's Date.parse accepts things like "-5" or "abc 2099".
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at) || at <= now) return undefined;
  return at - now;
}
