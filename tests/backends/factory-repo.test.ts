import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BACKEND_CONFIG } from '../../src/backends/config.js';
import { createBackendSet } from '../../src/backends/factory.js';
import { createNetworkGuard } from '../../src/fetch/network-guard.js';
import { createRepoCache, type RepoCache } from '../../src/repo/repo-cache.js';
import { createFixtureRepo, type FixtureRepo } from '../repo/git-fixtures.js';

const offline = () => ({
  networkGuard: createNetworkGuard({}, { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
  createModelFetch: () => ((input: Parameters<typeof fetch>[0], init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch,
  createGuardProxy: vi.fn(async () => {
    throw new Error('tests must not start a real guard proxy');
  })
});

const fixtures: FixtureRepo[] = [];
const caches: RepoCache[] = [];
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(caches.splice(0).map((c) => c.close()));
  for (const f of fixtures.splice(0)) f.cleanup();
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('backend set repo research', () => {
  it('has no researchRepo without a repo cache', () => {
    expect(createBackendSet(DEFAULT_BACKEND_CONFIG, offline()).researchRepo).toBeUndefined();
  });

  it('researches a repo through the shared cache', async () => {
    const repo = createFixtureRepo({ 'README.md': 'Widget docs' });
    fixtures.push(repo);
    const base = mkdtempSync(join(tmpdir(), 'pwa-factory-repo-'));
    temps.push(base);
    const repoCache = createRepoCache({ baseDir: base, bootId: 'testboot' });
    caches.push(repoCache);
    const repoApiFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      String(input).includes('/commits/') ? new Response(repo.sha) : Response.json({ size: 1, private: false, default_branch: 'main' })
    ) as unknown as typeof fetch;

    const backends = createBackendSet(DEFAULT_BACKEND_CONFIG, {
      ...offline(),
      repoCache,
      repoGitEnv: repo.gitEnv(),
      repoApiFetch,
      resolveGithubToken: async () => ({ source: 'none' })
    });
    const result = await backends.researchRepo!({ url: 'https://github.com/acme/widget', query: 'what is it' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.content?.text).toContain('Widget docs');
    await backends.close();
    const again = await repoCache.acquire('x', async () => ({ ok: true, sha: 'a'.repeat(40) }));
    expect(again.ok).toBe(true);
    if (again.ok) again.lease.release();
  });

  it('reports an invalid proxy as a config error for repo research too', async () => {
    const base = mkdtempSync(join(tmpdir(), 'pwa-factory-repo-'));
    temps.push(base);
    const repoCache = createRepoCache({ baseDir: base, bootId: 'testboot' });
    caches.push(repoCache);
    const backends = createBackendSet({ ...DEFAULT_BACKEND_CONFIG, proxy: { url: 'htttp://bad' } }, { ...offline(), repoCache });
    await expect(backends.researchRepo!({ url: 'https://github.com/acme/widget', query: 'q' })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'BACKEND_CONFIG_INVALID', failure: { kind: 'config_global' } })
    });
  });
});
