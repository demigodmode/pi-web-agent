import type { FailureInfo } from '../types.js';

const STATUS_TEXT: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not found',
  410: 'gone',
  429: 'too many requests',
  500: 'internal server error',
  502: 'bad gateway',
  503: 'service unavailable'
};

export function targetStatusMessage(status: number): string {
  return `HTTP ${status}${STATUS_TEXT[status] ? ` (${STATUS_TEXT[status]})` : ''}`;
}

export function targetStatusFailure(status: number): FailureInfo {
  return {
    kind: status === 401 || status === 403 || status === 429 ? 'blocked' : 'bad_response',
    httpStatus: status
  };
}

export function targetStatusMayNeedHeadless(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}
