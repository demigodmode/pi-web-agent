import { describe, expect, it } from 'vitest';
import { refusalMessage, secretRefusal } from '../../src/safety/refusal.js';

describe('secret refusal', () => {
  it('uses the fixed GitHub recovery guidance', () => {
    expect(refusalMessage('github')).toBe('Refused: the query contains what looks like a GitHub token. Remove it and try again. For private GitHub content, set GITHUB_TOKEN or run gh auth login instead.');
  });

  it.each(['openai', 'anthropic', 'aws', 'slack', 'stripe', 'google', 'npm', 'private-key', 'assignment', 'url-password'] as const)('uses fixed text for %s', (kind) => {
    expect(refusalMessage(kind)).not.toMatch(/undefined|\[object Object\]/);
  });

  it('uses plain password-or-token wording for generic assignments', () => {
    expect(refusalMessage('assignment')).toBe('Refused: the query contains what looks like a password or token. Remove it and try again.');
  });

  it('returns a presentation-safe error response without the matched value', () => {
    const response = secretRefusal({ kind: 'github' });
    expect(response).toMatchObject({
      status: 'error',
      findings: [],
      sources: [],
      error: { code: 'SECRET_IN_QUERY', message: refusalMessage('github') }
    });
  });
});
