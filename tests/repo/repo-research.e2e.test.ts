import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchWorkflow } from '../../src/orchestration/index.js';
import { createRepoCache, type RepoCache } from '../../src/repo/repo-cache.js';
import { researchRepo } from '../../src/repo/repo-research.js';
import { createFixtureRepo, type FixtureRepo } from './git-fixtures.js';

const fixtures: FixtureRepo[] = [];
const caches: RepoCache[] = [];
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(caches.splice(0).map((c) => c.close()));
  for (const f of fixtures.splice(0)) f.cleanup();
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world() {
  const repo = createFixtureRepo({ 'README.md': '# Widget\nWidget makes widgets for tests.', 'src/index.ts': 'export {};' });
  fixtures.push(repo);
  const base = mkdtempSync(join(tmpdir(), 'pwa-e2e-'));
  temps.push(base);
  const cache = createRepoCache({ baseDir: base, bootId: 'testboot' });
  caches.push(cache);
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
    String(input).includes('/commits/') ? new Response(repo.sha) : Response.json({ size: 1, private: false, default_branch: 'main' })
  ) as unknown as typeof fetch;
  const research = vi.fn((input: { url: string; query: string; signal?: AbortSignal }) =>
    researchRepo(input.url, input, { fetchImpl, cache, git: repo.gitEnv(), resolveToken: async () => ({ source: 'none' }) })
  );
  const search = vi.fn(async () => ({
    status: 'ok' as const,
    results: [{ title: 'acme/widget', url: 'https://github.com/acme/widget', snippet: 'widgets' }],
    metadata: { backend: 'duckduckgo' as const, cacheHit: false }
  }));
  const fetchPage = vi.fn(async ({ url }: { url: string }) => ({
    status: 'ok' as const,
    url,
    content: { title: 'acme/widget', text: 'README reader output: Widget makes widgets for tests, according to the README.' },
    metadata: { method: 'github' as const, cacheHit: false }
  }));
  const headlessFetch = vi.fn();
  const workflow = createResearchWorkflow({ search, fetchPage, headlessFetch, researchRepo: research });
  return { repo, cache, research, search, fetchPage, workflow };
}

describe('repo research end to end', () => {
  it('answers a typed repo URL from the clone, pinned to the commit, without searching', async () => {
    const { repo, research, search, fetchPage, workflow } = world();
    const result = await workflow.run({ query: 'what is in https://github.com/acme/widget ?' });
    expect(research).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.evidence[0]).toMatchObject({ url: `https://github.com/acme/widget/tree/${repo.sha}`, method: 'github' });
    expect(result.evidence[0].summary).toContain('Widget makes widgets for tests.');
    expect(result.evidence[0].summary).toContain('[dir] src');
  });

  it('leaves a repo URL that only turns up in search to the README reader', async () => {
    const { research, fetchPage, workflow } = world();
    await workflow.run({ query: 'widget library for tests' });
    expect(research).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/acme/widget' }));
  });

  it('leaves no clone folders once the session ends', async () => {
    const { cache, workflow } = world();
    await workflow.run({ query: 'what is in https://github.com/acme/widget ?' });
    expect(existsSync(cache.root)).toBe(true);
    await cache.close();
    expect(existsSync(cache.root)).toBe(false);
  });
});
