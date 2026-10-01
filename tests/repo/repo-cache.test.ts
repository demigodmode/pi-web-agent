import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortError } from '../../src/abort.js';
import { createRepoCache, type CloneFn, type RepoCache } from '../../src/repo/repo-cache.js';

const rmGate = vi.hoisted(() => {
  let start!: () => void;
  let release!: () => void;
  const state: {
    path: string;
    started: Promise<void>;
    allow: Promise<void>;
    reset(): void;
    start(): void;
    release(): void;
  } = {
    path: '',
    started: Promise.resolve(),
    allow: Promise.resolve(),
    reset() {
      this.path = '';
      this.started = new Promise<void>((resolve) => { start = resolve; });
      this.allow = new Promise<void>((resolve) => { release = resolve; });
    },
    start: () => start(),
    release: () => release()
  };
  state.reset();
  return state;
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (path: string, options?: Parameters<typeof actual.rm>[1]) => {
      if (path === rmGate.path) {
        rmGate.start();
        await rmGate.allow;
      }
      return actual.rm(path, options);
    }
  };
});

const temps: string[] = [];
const caches: RepoCache[] = [];
const baseDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwa-cache-'));
  temps.push(dir);
  return dir;
};
const cache = (options: Parameters<typeof createRepoCache>[0]) => {
  const created = createRepoCache({ bootId: 'testboot', ...options });
  caches.push(created);
  return created;
};
afterEach(async () => {
  await Promise.all(caches.splice(0).map((c) => c.close()));
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeClone(bytes = 10, gate?: Promise<void>): CloneFn & { calls: AbortSignal[] } {
  const calls: AbortSignal[] = [];
  const fn = (async (dest: string, signal: AbortSignal) => {
    calls.push(signal);
    if (gate) {
      await new Promise<void>((resolve, reject) => {
        gate.then(resolve);
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    }
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'data'), 'x'.repeat(bytes));
    return { ok: true as const, sha: 'a'.repeat(40) };
  }) as CloneFn & { calls: AbortSignal[] };
  fn.calls = calls;
  return fn;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('repo cache', () => {
  it('reuses a clone for the same key', async () => {
    const c = cache({ baseDir: baseDir() });
    const clone = fakeClone();
    const first = await c.acquire('acme/widget@a', clone);
    const second = await c.acquire('acme/widget@a', clone);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(clone.calls).toHaveLength(1);
    expect(first.lease.reused).toBe(false);
    expect(second.lease.reused).toBe(true);
    expect(second.lease.dir).toBe(first.lease.dir);
    expect(first.lease.dir.startsWith(c.root)).toBe(true);
    first.lease.release();
    second.lease.release();
  });

  it('shares one clone between concurrent callers', async () => {
    const c = cache({ baseDir: baseDir() });
    const gate = deferred();
    const clone = fakeClone(10, gate.promise);
    const a = c.acquire('k', clone);
    const b = c.acquire('k', clone);
    gate.resolve();
    const [ra, rb] = await Promise.all([a, b]);
    try {
      expect(clone.calls).toHaveLength(1);
      expect(ra.ok && rb.ok).toBe(true);
    } finally {
      if (ra.ok) ra.lease.release();
      if (rb.ok) rb.lease.release();
    }
  });

  it('lets one caller cancel without stopping the clone for another', async () => {
    const c = cache({ baseDir: baseDir() });
    const gate = deferred();
    const clone = fakeClone(10, gate.promise);
    const controller = new AbortController();
    const a = c.acquire('k', clone, controller.signal);
    const b = c.acquire('k', clone);
    controller.abort();
    await expect(a).rejects.toThrow('Operation aborted');
    await vi.waitFor(() => expect(clone.calls).toHaveLength(1));
    expect(clone.calls[0].aborted).toBe(false);
    gate.resolve();
    const rb = await b;
    try {
      expect(rb.ok).toBe(true);
    } finally {
      if (rb.ok) rb.lease.release();
    }
  });

  it('aborts the clone when every caller has gone', async () => {
    const c = cache({ baseDir: baseDir() });
    const clone = fakeClone(10, new Promise(() => undefined));
    const one = new AbortController();
    const two = new AbortController();
    const a = c.acquire('k', clone, one.signal);
    const b = c.acquire('k', clone, two.signal);
    await vi.waitFor(() => expect(clone.calls).toHaveLength(1));
    one.abort();
    two.abort();
    await expect(a).rejects.toThrow('Operation aborted');
    await expect(b).rejects.toThrow('Operation aborted');
    await vi.waitFor(() => expect(clone.calls[0].aborted).toBe(true));
    const again = fakeClone();
    await vi.waitFor(async () => {
      const retry = await c.acquire('k', again);
      expect(retry.ok).toBe(true);
      if (retry.ok) retry.lease.release();
    });
    expect(again.calls).toHaveLength(1);
  });

  it('removes a clone that finishes after its sole caller cancels', async () => {
    const c = cache({ baseDir: baseDir(), maxIdleBytes: 0 });
    const written = deferred();
    const finish = deferred();
    let cancelledDir = '';
    const first: CloneFn = async (dest) => {
      cancelledDir = dest;
      await mkdir(dest, { recursive: true });
      await writeFile(join(dest, 'data'), 'x'.repeat(64));
      written.resolve();
      await finish.promise;
      return { ok: true, sha: 'a'.repeat(40) };
    };
    const controller = new AbortController();
    const pending = c.acquire('k', first, controller.signal);
    await written.promise;
    controller.abort();
    await expect(pending).rejects.toThrow('Operation aborted');
    finish.resolve();
    await vi.waitFor(() => expect(existsSync(cancelledDir)).toBe(false));

    const fresh = fakeClone();
    const retry = await c.acquire('k', fresh);
    try {
      expect(fresh.calls).toHaveLength(1);
    } finally {
      if (retry.ok) retry.lease.release();
    }
  });

  it('waits for an evicted clone to be removed before recreating its directory', async () => {
    rmGate.reset();
    const c = cache({ baseDir: baseDir(), maxIdleBytes: 0 });
    const first = await c.acquire('same-key', fakeClone(10));
    if (!first.ok) throw new Error('acquire failed');
    rmGate.path = first.lease.dir;
    first.lease.release();
    await rmGate.started;

    const freshClone = fakeClone(20);
    const fresh = c.acquire('same-key', freshClone);
    let retry: Awaited<typeof fresh> | undefined;
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(freshClone.calls).toHaveLength(0);

      rmGate.release();
      retry = await fresh;
      expect(retry.ok).toBe(true);
      if (!retry.ok) return;
      expect(freshClone.calls).toHaveLength(1);
      expect(existsSync(retry.lease.dir)).toBe(true);
      expect(readFileSync(join(retry.lease.dir, 'data'), 'utf8')).toHaveLength(20);
    } finally {
      rmGate.release();
      retry ??= await fresh;
      if (retry.ok) retry.lease.release();
      rmGate.reset();
    }
  });

  it('never evicts a leased clone and evicts idle ones oldest first', async () => {
    let clock = 0;
    const c = cache({ baseDir: baseDir(), maxIdleBytes: 250, now: () => ++clock });
    const held = await c.acquire('held', fakeClone(1_000));
    const one = await c.acquire('one', fakeClone(100));
    const two = await c.acquire('two', fakeClone(100));
    const three = await c.acquire('three', fakeClone(100));
    if (!held.ok || !one.ok || !two.ok || !three.ok) throw new Error('acquire failed');
    one.lease.release();
    two.lease.release();
    three.lease.release();
    await vi.waitFor(() => expect(existsSync(one.lease.dir)).toBe(false));
    expect(existsSync(two.lease.dir)).toBe(true);
    expect(existsSync(three.lease.dir)).toBe(true);
    expect(existsSync(held.lease.dir)).toBe(true);
    held.lease.release();
  });

  it('keeps two cache instances in one process out of each other’s folders', async () => {
    const base = baseDir();
    const a = cache({ baseDir: base });
    const b = cache({ baseDir: base });
    expect(a.root).not.toBe(b.root);
    const ra = await a.acquire('k', fakeClone());
    const rb = await b.acquire('k', fakeClone());
    if (!ra.ok || !rb.ok) throw new Error('acquire failed');
    ra.lease.release();
    rb.lease.release();
    await a.close();
    expect(existsSync(a.root)).toBe(false);
    expect(existsSync(rb.lease.dir)).toBe(true);
  });

  it('closes in order: no new work, clones aborted, readers told to stop and awaited, then the folder goes', async () => {
    const c = cache({ baseDir: baseDir() });
    const ready = await c.acquire('reading', fakeClone());
    if (!ready.ok) throw new Error('acquire failed');
    const inFlight = fakeClone(10, new Promise(() => undefined));
    const cloning = c.acquire('cloning', inFlight);
    await vi.waitFor(() => expect(inFlight.calls).toHaveLength(1));
    let readerStopped = false;
    const reader = (async () => {
      while (!ready.lease.signal.aborted) await new Promise((r) => setTimeout(r, 5));
      readerStopped = true;
      await new Promise((r) => setTimeout(r, 30));
      ready.lease.release();
    })();
    await c.close();
    expect(inFlight.calls[0].aborted).toBe(true);
    await expect(cloning).resolves.toEqual({ ok: false, failure: expect.objectContaining({ code: 'REPO_CACHE_CLOSED' }) });
    expect(readerStopped).toBe(true);
    expect(existsSync(c.root)).toBe(false);
    await reader;
    await expect(c.acquire('late', fakeClone())).resolves.toEqual({ ok: false, failure: expect.objectContaining({ code: 'REPO_CACHE_CLOSED' }) });
  });

  it('removes the folder after the grace period even if a reader never lets go', async () => {
    const c = cache({ baseDir: baseDir(), closeGraceMs: 50 });
    const stuck = await c.acquire('k', fakeClone());
    if (!stuck.ok) throw new Error('acquire failed');
    await c.close();
    expect(existsSync(c.root)).toBe(false);
    stuck.lease.release();
  });

  it('sweeps leftovers from dead processes and other boots, and nothing else', async () => {
    const base = baseDir();
    const dead = join(base, 'testboot-999999-aaaa');
    const otherBoot = join(base, `otherboot-${process.pid}-bbbb`);
    const alive = join(base, 'testboot-4242-cccc');
    const unrelated = join(base, 'something-else');
    for (const dir of [dead, otherBoot, alive, unrelated]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'f'), 'x');
    }
    const c = cache({ baseDir: base, isPidAlive: (pid) => pid === 4242 || pid === process.pid });
    await c.sweepLeftovers();
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(otherBoot)).toBe(false);
    expect(existsSync(alive)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('passes a clone failure to every waiter and forgets it', async () => {
    const c = cache({ baseDir: baseDir() });
    const failing: CloneFn = async () => ({ ok: false, failure: { code: 'REPO_CLONE_FAILED', message: 'nope', failure: { kind: 'transient' } } });
    await expect(c.acquire('k', failing)).resolves.toEqual({ ok: false, failure: expect.objectContaining({ code: 'REPO_CLONE_FAILED' }) });
    const retry = await c.acquire('k', fakeClone());
    expect(retry.ok).toBe(true);
    if (retry.ok) retry.lease.release();
  });
});
