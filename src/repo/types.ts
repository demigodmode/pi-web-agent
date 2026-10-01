import type { FailureInfo } from '../types.js';

/** Every repo research problem other than a cancel. Always returned, never thrown. */
export type RepoFailure = { code: string; message: string; failure: FailureInfo };

export function repoFailure(code: string, message: string, kind: FailureInfo['kind']): RepoFailure {
  return { code, message, failure: { kind } };
}
