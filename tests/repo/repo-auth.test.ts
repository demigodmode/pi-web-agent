import { describe, expect, it, vi } from 'vitest';
import { GH_TOKEN_TIMEOUT_MS } from '../../src/repo/limits.js';
import { resolveGithubToken } from '../../src/repo/repo-auth.js';

describe('resolveGithubToken', () => {
  it('prefers GITHUB_TOKEN and never asks gh', async () => {
    const runGh = vi.fn();
    await expect(resolveGithubToken({ env: { GITHUB_TOKEN: '  env-token \n' }, runGh })).resolves.toEqual({ token: 'env-token', source: 'env' });
    expect(runGh).not.toHaveBeenCalled();
  });

  it('uses the gh token when GITHUB_TOKEN is empty, with a short timeout', async () => {
    const runGh = vi.fn(async () => ({ code: 0, stdout: 'gho_abc123\n' }));
    await expect(resolveGithubToken({ env: { GITHUB_TOKEN: '   ' }, runGh })).resolves.toEqual({ token: 'gho_abc123', source: 'gh' });
    expect(runGh).toHaveBeenCalledWith(['auth', 'token', '--hostname', 'github.com'], GH_TOKEN_TIMEOUT_MS);
  });

  it('falls back to no token when gh is not signed in', async () => {
    const runGh = vi.fn(async () => ({ code: 1, stdout: '' }));
    await expect(resolveGithubToken({ env: {}, runGh })).resolves.toEqual({ source: 'none' });
  });

  it('falls back to no token when gh is missing or blows up', async () => {
    const runGh = vi.fn(async () => {
      throw new Error('spawn gh ENOENT');
    });
    await expect(resolveGithubToken({ env: {}, runGh })).resolves.toEqual({ source: 'none' });
  });

  it('treats an empty gh answer as no token', async () => {
    const runGh = vi.fn(async () => ({ code: 0, stdout: '\n' }));
    await expect(resolveGithubToken({ env: {}, runGh })).resolves.toEqual({ source: 'none' });
  });
});
