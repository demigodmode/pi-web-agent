import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRepoCache, type RepoCache } from '../../src/repo/repo-cache.js';
import { resolveInside } from '../../src/repo/repo-overview.js';
import { researchRepo, type RepoResearchDeps } from '../../src/repo/repo-research.js';
import { createFixtureRepo, type FixtureRepo } from './git-fixtures.js';

const fixtures: FixtureRepo[] = [];
const caches: RepoCache[] = [];
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(caches.splice(0).map((c) => c.close()));
  for (const f of fixtures.splice(0)) f.cleanup();
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(files: Parameters<typeof createFixtureRepo>[0], api: { status?: number; size?: number } = {}) {
  const repo = createFixtureRepo(files);
  fixtures.push(repo);
  const base = mkdtempSync(join(tmpdir(), 'pwa-research-'));
  temps.push(base);
  const cache = createRepoCache({ baseDir: base, bootId: 'testboot' });
  caches.push(cache);
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (api.status) return new Response('{}', { status: api.status });
    if (url.includes('/commits/')) return new Response(repo.sha);
    return Response.json({ size: api.size ?? 10, private: false, default_branch: 'main' });
  }) as unknown as typeof fetch;
  const deps: RepoResearchDeps = { fetchImpl, cache, git: repo.gitEnv(), resolveToken: async () => ({ source: 'none' }) };
  return { repo, cache, deps, fetchImpl };
}

describe('researchRepo', () => {
  it('returns the README and folder listing pinned to the commit', async () => {
    const { repo, deps } = setup({ 'README.md': '# Widget\nMakes widgets.', 'src/index.ts': 'x', 'package.json': '{}' });
    const result = await researchRepo('https://github.com/acme/widget', { query: 'what is this' }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      status: 'ok',
      url: `https://github.com/acme/widget/tree/${repo.sha}`,
      metadata: { method: 'github', cacheHit: false },
      content: { title: 'acme/widget' }
    });
    const text = result.response.content!.text;
    expect(text).toContain(`Repository acme/widget at main (${repo.sha.slice(0, 12)})`);
    expect(text).toContain('Makes widgets.');
    expect(text).toContain('[dir] src');
    expect(text).toContain('package.json');
    expect(text).not.toContain('.git');
  });

  it('reuses the clone on a follow-up question', async () => {
    const { deps } = setup({ 'README.md': 'hi' });
    await researchRepo('https://github.com/acme/widget', { query: 'a' }, deps);
    const second = await researchRepo('https://github.com/acme/widget', { query: 'b' }, deps);
    expect(second.ok && second.response.metadata.cacheHit).toBe(true);
  });

  it('scopes a /tree/ link to its folder', async () => {
    const { repo, deps } = setup({ 'README.md': 'root', 'src/auth/README.md': 'auth notes', 'src/auth/refresh.ts': 'x' });
    const result = await researchRepo('https://github.com/acme/widget/tree/main/src/auth', { query: 'q' }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.url).toBe(`https://github.com/acme/widget/tree/${repo.sha}/src/auth`);
    expect(result.response.content!.text).toContain('auth notes');
    expect(result.response.content!.text).toContain('refresh.ts');
  });

  it('refuses a folder that is not there', async () => {
    const { deps } = setup({ 'README.md': 'root' });
    const result = await researchRepo('https://github.com/acme/widget/tree/main/nope', { query: 'q' }, deps);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'REPO_PATH_NOT_FOUND', failure: { kind: 'bad_request' } }) });
  });

  it('passes metadata failures through without cloning', async () => {
    const { deps, cache } = setup({ 'README.md': 'root' }, { status: 404 });
    const acquire = vi.spyOn(cache, 'acquire');
    const result = await researchRepo('https://github.com/acme/widget', { query: 'q' }, deps);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'REPO_NOT_FOUND' }) });
    expect(acquire).not.toHaveBeenCalled();
  });

  it('throws the abort error when the caller cancels', async () => {
    const { deps } = setup({ 'README.md': 'root' });
    const controller = new AbortController();
    controller.abort();
    await expect(researchRepo('https://github.com/acme/widget', { query: 'q', signal: controller.signal }, deps)).rejects.toThrow('Operation aborted');
  });

  it('rejects something that is not a repo link', async () => {
    const { deps } = setup({ 'README.md': 'root' });
    await expect(researchRepo('https://example.com/x', { query: 'q' }, deps)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'REPO_URL_INVALID' })
    });
  });
});

describe('resolveInside', () => {
  it('refuses paths that climb out of the clone', async () => {
    const { repo } = setup({ 'README.md': 'root', 'src/a.ts': 'a' });
    expect(await resolveInside(repo.work, 'src')).toBe(join(repo.work, 'src'));
    expect(await resolveInside(repo.work, '../')).toBeUndefined();
    expect(await resolveInside(repo.work, 'src/../../')).toBeUndefined();
    expect(await resolveInside(repo.work, 'README.md')).toBeUndefined();
  });
});
