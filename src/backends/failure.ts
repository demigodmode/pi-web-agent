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
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // Only accept something that looks like an HTTP-date; Date.parse happily reads "-5" as a year.
  if (!/[a-z]/i.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at) || at <= now) return undefined;
  return at - now;
}
