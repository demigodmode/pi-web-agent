import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRepoMeta, parseLsRemote, pickRef } from '../../src/repo/repo-meta.js';
import { createFixtureRepo, type FixtureRepo } from './git-fixtures.js';

type Api = { fetchImpl: typeof fetch; calls: Array<{ url: string; auth: string | null; accept: string | null }> };

function githubApi({
  size = 12,
  isPrivate = false,
  defaultBranch = 'main',
  defaultSha = 'a'.repeat(40),
  status = 200,
  headers = {}
}: { size?: number; isPrivate?: boolean; defaultBranch?: string; defaultSha?: string; status?: number; headers?: Record<string, string> } = {}): Api {
  const calls: Api['calls'] = [];
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const sent = new Headers(init?.headers);
    calls.push({ url, auth: sent.get('authorization'), accept: sent.get('accept') });
    if (status !== 200) return new Response('{"message":"nope"}', { status, headers });
    if (url.includes('/commits/')) return new Response(defaultSha, { status: 200 });
    return Response.json({ size, private: isPrivate, default_branch: defaultBranch });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const fixtures: FixtureRepo[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('repo metadata', () => {
  it('resolves the default branch commit when there is no ref', async () => {
    const api = githubApi({ defaultBranch: 'trunk', defaultSha: 'b'.repeat(40) });
    const result = await fetchRepoMeta({ owner: 'acme', repo: 'widget' }, { fetchImpl: api.fetchImpl, git: {} });
    expect(result).toEqual({
      ok: true,
      meta: { owner: 'acme', repo: 'widget', sizeKb: 12, private: false, sha: 'b'.repeat(40), ref: 'trunk' }
    });
    expect(api.calls.map((call) => call.url)).toEqual([
      'https://api.github.com/repos/acme/widget',
      'https://api.github.com/repos/acme/widget/commits/trunk'
    ]);
    expect(api.calls[1].accept).toBe('application/vnd.github.sha');
  });

  it('sends the token when there is one and keeps it out of messages', async () => {
    const api = githubApi({ status: 404 });
    const result = await fetchRepoMeta({ owner: 'acme', repo: 'secret' }, { fetchImpl: api.fetchImpl, token: 'sekret', git: {} });
    expect(api.calls[0].auth).toBe('Bearer sekret');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('REPO_NOT_FOUND');
      expect(result.failure.failure.kind).toBe('bad_request');
      expect(result.failure.message).not.toContain('sekret');
    }
  });

  it('maps 404 without a token to auth_failed with the private repo hint', async () => {
    const result = await fetchRepoMeta({ owner: 'acme', repo: 'secret' }, { fetchImpl: githubApi({ status: 404 }).fetchImpl, git: {} });
    expect(result).toEqual({
      ok: false,
      failure: {
        code: 'REPO_NOT_FOUND',
        message: "acme/secret wasn't found, or it's private and there's no access. For private repos run `gh auth login` or set GITHUB_TOKEN.",
        failure: { kind: 'auth_failed' }
      }
    });
  });

  it.each([
    [401, {}, 'auth_failed', 'REPO_AUTH_FAILED'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited', 'REPO_RATE_LIMITED'],
    [429, {}, 'rate_limited', 'REPO_RATE_LIMITED'],
    [403, {}, 'auth_failed', 'REPO_FORBIDDEN'],
    [502, {}, 'transient', 'REPO_META_FAILED']
  ])('maps HTTP %s', async (status, headers, kind, code) => {
    const result = await fetchRepoMeta({ owner: 'acme', repo: 'widget' }, { fetchImpl: githubApi({ status, headers }).fetchImpl, git: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe(code);
      expect(result.failure.failure.kind).toBe(kind);
    }
  });

  it('reports a network error as transient', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await fetchRepoMeta({ owner: 'acme', repo: 'widget' }, { fetchImpl, git: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.failure.kind).toBe('transient');
  });

  it('gives up on a stalled API within the budget', async () => {
    const fetchImpl = ((_input: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const started = Date.now();
    const result = await fetchRepoMeta({ owner: 'acme', repo: 'widget' }, { fetchImpl, git: {}, timeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toEqual({
      ok: false,
      failure: { code: 'REPO_META_TIMEOUT', message: "GitHub didn't answer within 0s.", failure: { kind: 'transient' } }
    });
  });

  it('throws the abort error when the caller cancels', async () => {
    const controller = new AbortController();
    const fetchImpl = ((_input: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const pending = fetchRepoMeta({ owner: 'acme', repo: 'widget' }, { fetchImpl, git: {}, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Operation aborted');
  });

  it('refuses an oversized repo before listing refs', async () => {
    const runGitImpl = vi.fn();
    const result = await fetchRepoMeta(
      { owner: 'acme', repo: 'huge', refAndPath: 'main/src' },
      { fetchImpl: githubApi({ size: 1.2 * 1024 * 1024 }).fetchImpl, git: {}, runGitImpl }
    );
    expect(result).toEqual({
      ok: false,
      failure: {
        code: 'REPO_TOO_LARGE',
        message: 'acme/huge is 1.2GB, over the 300MB limit; ask about a specific file URL instead.',
        failure: { kind: 'bad_request' }
      }
    });
    expect(runGitImpl).not.toHaveBeenCalled();
  });

  it('takes a full SHA as the ref without listing refs', async () => {
    const runGitImpl = vi.fn();
    const sha = 'c'.repeat(40);
    const result = await fetchRepoMeta(
      { owner: 'acme', repo: 'widget', refAndPath: `${sha}/src/auth` },
      { fetchImpl: githubApi().fetchImpl, git: {}, runGitImpl }
    );
    expect(result).toEqual({ ok: true, meta: expect.objectContaining({ sha, ref: sha, pathScope: 'src/auth' }) });
    expect(runGitImpl).not.toHaveBeenCalled();
  });

  describe('against a real remote', () => {
    it('picks the longest ref, prefers a branch over a same-name tag and peels annotated tags', async () => {
      const fixture = createFixtureRepo({ 'README.md': 'hello' });
      fixtures.push(fixture);
      const mainSha = fixture.sha;
      fixture.tag('feature');
      const tagFeatureSha = fixture.sha;
      fixture.newBranch('feature/x');
      const featureX = fixture.commit({ 'src/a.ts': 'a' });
      fixture.tag('a/b/c/d/e');
      const deepTagSha = fixture.sha;
      fixture.newBranch('a/b/c/d/e/f');
      const deepBranch = fixture.commit({ 'src/b.ts': 'b' });
      fixture.newBranch('dup');
      const dupBranch = fixture.commit({ 'src/c.ts': 'c' });
      fixture.checkout('main');
      fixture.tag('dup');
      fixture.tag('v1', { annotated: true });

      const meta = (refAndPath: string) =>
        fetchRepoMeta({ owner: 'acme', repo: 'widget', refAndPath }, { fetchImpl: githubApi().fetchImpl, git: fixture.gitEnv() });

      await expect(meta('feature/x/src')).resolves.toEqual({ ok: true, meta: expect.objectContaining({ ref: 'feature/x', sha: featureX, pathScope: 'src' }) });
      await expect(meta('feature')).resolves.toEqual({ ok: true, meta: expect.objectContaining({ ref: 'feature', sha: tagFeatureSha }) });
      await expect(meta('a/b/c/d/e/f/src')).resolves.toEqual({ ok: true, meta: expect.objectContaining({ ref: 'a/b/c/d/e/f', sha: deepBranch, pathScope: 'src' }) });
      await expect(meta('a/b/c/d/e/g')).resolves.toEqual({ ok: true, meta: expect.objectContaining({ ref: 'a/b/c/d/e', sha: deepTagSha, pathScope: 'g' }) });
      await expect(meta('dup')).resolves.toEqual({ ok: true, meta: expect.objectContaining({ ref: 'dup', sha: dupBranch }) });
      await expect(meta('v1')).resolves.toEqual({ ok: true, meta: expect.objectContaining({ ref: 'v1', sha: mainSha }) });
      await expect(meta('nope/src')).resolves.toEqual({
        ok: false,
        failure: { code: 'REPO_REF_NOT_FOUND', message: "Couldn't find that branch, tag or commit in acme/widget.", failure: { kind: 'bad_request' } }
      });
    });
  });
});

describe('ls-remote parsing', () => {
  it('prefers peeled commits for annotated tags', () => {
    const refs = parseLsRemote(
      ['1111111111111111111111111111111111111111\trefs/heads/main', '2222222222222222222222222222222222222222\trefs/tags/v1', '3333333333333333333333333333333333333333\trefs/tags/v1^{}', ''].join('\n')
    );
    expect(refs.heads.get('main')).toBe('1111111111111111111111111111111111111111');
    expect(refs.tags.get('v1')).toBe('3333333333333333333333333333333333333333');
  });

  it('matches only on / boundaries', () => {
    const refs = parseLsRemote('1111111111111111111111111111111111111111\trefs/heads/feat\n');
    expect(pickRef(refs, 'feature/x')).toBeUndefined();
    expect(pickRef(refs, 'feat/x/')).toEqual({ ref: 'feat', sha: '1111111111111111111111111111111111111111', pathScope: 'x' });
  });
});
