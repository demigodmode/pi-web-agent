import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
import { createRepoCache, type RepoCache } from '../../src/repo/repo-cache.js';
import { readRepoOverview, resolveInside } from '../../src/repo/repo-overview.js';
import { researchRepo, type RepoResearchDeps } from '../../src/repo/repo-research.js';
import { READER_TEXT_CAP } from '../../src/readers/limits.js';
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

  it('throws and releases the lease when the caller cancels during the final README read', async () => {
    const { cache, deps } = setup({ 'README.md': 'root' });
    const { open: originalOpen } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let finalReadStarted!: () => void;
    const finalRead = new Promise<void>((resolve) => { finalReadStarted = resolve; });
    let readmeClosed = false;
    const open = vi.mocked(fsPromises.open).mockImplementation(async (path, flags) => {
      const handle = await originalOpen(path, flags);
      if (!String(path).endsWith('README.md')) return handle;
      return {
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const result = await handle.read(buffer, offset, length, position);
          finalReadStarted();
          await readGate;
          return result;
        },
        close: async () => {
          readmeClosed = true;
          await handle.close();
        }
      } as never;
    });
    const controller = new AbortController();
    const run = researchRepo('https://github.com/acme/widget', { query: 'q', signal: controller.signal }, deps);
    try {
      await finalRead;
      controller.abort();
      releaseRead();
      await expect(run).rejects.toThrow('Operation aborted');
      expect(readmeClosed).toBe(true);
      await expect(cache.close()).resolves.toBeUndefined();
      await expect(fsPromises.stat(cache.root)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      releaseRead();
      open.mockReset();
      await cache.close();
    }
  });

  it('returns a cache-closed failure and awaits cleanup when shutdown starts during the final README read', async () => {
    const { cache, deps } = setup({ 'README.md': 'root' });
    const { open: originalOpen } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let finalReadStarted!: () => void;
    const finalRead = new Promise<void>((resolve) => { finalReadStarted = resolve; });
    let readmeClosed = false;
    const open = vi.mocked(fsPromises.open).mockImplementation(async (path, flags) => {
      const handle = await originalOpen(path, flags);
      if (!String(path).endsWith('README.md')) return handle;
      return {
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const result = await handle.read(buffer, offset, length, position);
          finalReadStarted();
          await readGate;
          return result;
        },
        close: async () => {
          readmeClosed = true;
          await handle.close();
        }
      } as never;
    });
    const run = researchRepo('https://github.com/acme/widget', { query: 'q' }, deps);
    try {
      await finalRead;
      const close = cache.close();
      releaseRead();
      await expect(run).resolves.toEqual({ ok: false, error: expect.objectContaining({ code: 'REPO_CACHE_CLOSED', failure: { kind: 'transient' } }) });
      expect(readmeClosed).toBe(true);
      await expect(close).resolves.toBeUndefined();
      await expect(fsPromises.stat(cache.root)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      releaseRead();
      open.mockReset();
      await cache.close();
    }
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
  it('refuses .git path segments before they can expose clone internals', async () => {
    const { repo, deps } = setup({ 'README.md': 'root' });
    mkdirSync(join(repo.work, '.GIT', 'objects'), { recursive: true });
    mkdirSync(join(repo.work, '.git\\objects'), { recursive: true });
    await expect(resolveInside(repo.work, '.git')).resolves.toBeUndefined();
    await expect(resolveInside(repo.work, '.GIT/objects')).resolves.toBeUndefined();
    await expect(resolveInside(repo.work, '.git\\objects')).resolves.toBeUndefined();
    await expect(researchRepo('https://github.com/acme/widget/tree/main/.git', { query: 'q' }, deps)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'REPO_PATH_NOT_FOUND' })
    });
  });

  it('refuses Windows-normalized .git path segments', async () => {
    const { repo } = setup({ 'README.md': 'root' });
    mkdirSync(join(repo.work, '.git.', 'objects'), { recursive: true });
    mkdirSync(join(repo.work, '.git ', 'refs'), { recursive: true });
    mkdirSync(join(repo.work, 'nested', '.GiT.', 'objects'), { recursive: true });

    // Linux permits these names, so the pre-normalization resolver reaches them.
    if (process.platform !== 'win32') {
      expect(await fsPromises.realpath(join(repo.work, '.git.'))).toBe(join(repo.work, '.git.'));
      expect(await fsPromises.realpath(join(repo.work, '.git '))).toBe(join(repo.work, '.git '));
    }
    await expect(resolveInside(repo.work, '.git.')).resolves.toBeUndefined();
    await expect(resolveInside(repo.work, '.git ')).resolves.toBeUndefined();
    await expect(resolveInside(repo.work, 'nested/.GiT./objects')).resolves.toBeUndefined();
    await expect(resolveInside(repo.work, 'nested\\.GiT.\\objects')).resolves.toBeUndefined();
    await expect(readRepoOverview(repo.work, { pathScope: '.git.' })).resolves.toBeUndefined();
  });

  it('refuses paths that climb out of the clone', async () => {
    const { repo } = setup({ 'README.md': 'root', 'src/a.ts': 'a' });
    expect(await resolveInside(repo.work, 'src')).toBe(join(repo.work, 'src'));
    expect(await resolveInside(repo.work, '../')).toBeUndefined();
    expect(await resolveInside(repo.work, 'src/../../')).toBeUndefined();
    expect(await resolveInside(repo.work, 'README.md')).toBeUndefined();
  });
});

describe('readRepoOverview', () => {
  it('reads a bounded README buffer and closes its file handle', async () => {
    const { repo } = setup({ 'README.md': 'x'.repeat(READER_TEXT_CAP * 8) });
    let requestedLength = 0;
    const handle = {
      read: vi.fn(async (buffer: Buffer, _offset: number, length: number) => {
        requestedLength = length;
        buffer.fill('x', 0, length);
        return { bytesRead: length, buffer };
      }),
      close: vi.fn(async () => undefined)
    };
    const open = vi.mocked(fsPromises.open).mockResolvedValue(handle as never);
    try {
      const overview = await readRepoOverview(repo.work, {});
      expect(overview?.readme).toHaveLength(READER_TEXT_CAP);
      expect(open).toHaveBeenCalledWith(join(repo.work, 'README.md'), 'r');
      expect(requestedLength).toBeLessThanOrEqual(READER_TEXT_CAP * 4);
      expect(handle.close).toHaveBeenCalledOnce();
    } finally {
      open.mockReset();
    }
  });

  it('closes the README handle when its bounded read fails', async () => {
    const { repo } = setup({ 'README.md': 'root' });
    const failure = new Error('read failed');
    const handle = {
      read: vi.fn(async () => { throw failure; }),
      close: vi.fn(async () => undefined)
    };
    const open = vi.mocked(fsPromises.open).mockResolvedValue(handle as never);
    try {
      await expect(readRepoOverview(repo.work, {})).rejects.toThrow(failure);
      expect(handle.close).toHaveBeenCalledOnce();
    } finally {
      open.mockReset();
    }
  });
});
