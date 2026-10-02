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
  const closed = await Promise.allSettled(caches.splice(0).map((c) => c.close()));
  const cleanupErrors: unknown[] = [];
  for (const f of fixtures.splice(0)) {
    try {
      f.cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  const rejected = closed.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  if (cleanupErrors[0]) throw cleanupErrors[0];
}, 30_000);

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

describe('repo code search end to end', () => {
  it('answers from the nested file with a pinned citation', async () => {
    const code = [
      "import { oauthClient } from './client';",
      '',
      'export async function refreshToken(session) {',
      '  // Swap the refresh token for a new OAuth access token.',
      "  return oauthClient.post('/token', { grant_type: 'refresh_token' });",
      '}'
    ].join('\n');
    const repo = createFixtureRepo({
      'README.md': '# Widget\nWe refresh OAuth tokens for you.',
      'src/auth/token-refresh.ts': code,
      'src/auth/session.ts': 'export const refreshSession = (oauth) => oauth.token;',
      'node_modules/lib/refresh-token.js': code
    });
    fixtures.push(repo);
    const base = mkdtempSync(join(tmpdir(), 'pwa-e2e-search-'));
    temps.push(base);
    const cache = createRepoCache({ baseDir: base, bootId: 'testboot' });
    caches.push(cache);
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      String(input).includes('/commits/') ? new Response(repo.sha) : Response.json({ size: 1, private: false, default_branch: 'main' })
    ) as unknown as typeof fetch;
    const search = vi.fn();
    const workflow = createResearchWorkflow({
      search,
      fetchPage: vi.fn(),
      headlessFetch: vi.fn(),
      researchRepo: (input) => researchRepo(input.url, input, { fetchImpl, cache, git: repo.gitEnv(), resolveToken: async () => ({ source: 'none' }) })
    });

    const result = await workflow.run({ query: 'where does this project refresh OAuth tokens? https://github.com/acme/widget' });

    expect(search).not.toHaveBeenCalled();
    const summary = result.evidence[0].summary;
    expect(summary).toContain(`https://github.com/acme/widget/blob/${repo.sha}/src/auth/token-refresh.ts#L1-L6`);
    expect(summary).toContain("return oauthClient.post('/token'");
    expect(summary).not.toContain('node_modules');
  });
});
