import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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

const raceGate = vi.hoisted(() => {
  let reached!: () => void;
  let release!: () => void;
  const state: {
    enabled: boolean;
    abortable: boolean;
    reached: Promise<void>;
    allow: Promise<void>;
    reset(): void;
    reach(): void;
    release(): void;
  } = {
    enabled: false,
    abortable: false,
    reached: Promise.resolve(),
    allow: Promise.resolve(),
    reset() {
      this.enabled = false;
      this.abortable = false;
      this.reached = new Promise<void>((resolve) => { reached = resolve; });
      this.allow = new Promise<void>((resolve) => { release = resolve; });
    },
    reach: () => reached(),
    release: () => release()
  };
  state.reset();
  return state;
});

const tmpdirGate = vi.hoisted(() => ({
  path: undefined as string | undefined,
  reset() {
    this.path = undefined;
  }
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    tmpdir: () => tmpdirGate.path ?? actual.tmpdir()
  };
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
    },
  };
});

vi.mock('../../src/abort.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/abort.js')>();
  return {
    ...actual,
    raceAbort: async <T>(work: Promise<T>, signal: AbortSignal) => {
      const result = await actual.raceAbort(work, signal);
      if (raceGate.enabled) {
        raceGate.reach();
        if (raceGate.abortable) {
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => reject(abortError());
            signal.addEventListener('abort', onAbort, { once: true });
            raceGate.allow.then(() => {
              signal.removeEventListener('abort', onAbort);
              resolve();
            });
          });
        } else {
          await raceGate.allow;
        }
      }
      return result;
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
  raceGate.reset();
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
  it('uses a per-user default cache base', async () => {
    const c = cache({});
    const user = typeof process.getuid === 'function' ? String(process.getuid()) : undefined;
    try {
      expect(dirname(c.root)).toBe(join(tmpdir(), `pi-web-agent-repos-${user}`));
      expect(basename(c.root)).toMatch(/^testboot-\d+-[0-9a-f]+$/);
    } finally {
      await c.close();
    }
  });

  it('uses unknown for a throwing Windows user lookup and closes a default cache cleanly', async () => {
    const parent = baseDir();
    tmpdirGate.path = parent;
    const lookup = vi.fn(() => { throw new Error('unavailable'); });
    const c = cache({
      platform: 'win32',
      userInfo: lookup
    });
    const result = await c.acquire('k', fakeClone());
    try {
      expect(dirname(c.root)).toBe(join(parent, 'pi-web-agent-repos-unknown'));
      expect(lookup).toHaveBeenCalledOnce();
      expect(result.ok).toBe(true);
    } finally {
      if (result.ok) result.lease.release();
      await c.close();
      tmpdirGate.reset();
    }
    expect(existsSync(c.root)).toBe(false);
  });

  it('sanitizes the Windows user name for the default cache base', async () => {
    const parent = baseDir();
    tmpdirGate.path = parent;
    const c = cache({
      platform: 'win32',
      userInfo: () => ({ username: 'A user/name', uid: 1, gid: 1, shell: '', homedir: '' })
    });
    try {
      expect(dirname(c.root)).toBe(join(parent, 'pi-web-agent-repos-A-user-name'));
    } finally {
      await c.close();
      tmpdirGate.reset();
    }
  });

  it('keeps the numeric uid default cache base on linux', async () => {
    const parent = baseDir();
    tmpdirGate.path = parent;
    const lookup = vi.fn(() => { throw new Error('should not be called'); });
    const c = cache({
      platform: 'linux',
      userInfo: lookup
    });
    try {
      expect(dirname(c.root)).toBe(join(parent, `pi-web-agent-repos-${process.getuid!()}`));
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      await c.close();
      tmpdirGate.reset();
    }
  });

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

  it('keeps a just-finished clone while its waiter receives the first lease', async () => {
    const c = cache({ baseDir: baseDir(), maxIdleBytes: 10 });
    const held = await c.acquire('held', fakeClone(10));
    if (!held.ok) throw new Error('acquire failed');

    raceGate.reset();
    raceGate.enabled = true;
    const second = c.acquire('second', fakeClone(10), new AbortController().signal);
    await raceGate.reached;
    held.lease.release();
    raceGate.release();

    const result = await second;
    try {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(existsSync(result.lease.dir)).toBe(true);
      expect(readFileSync(join(result.lease.dir, 'data'), 'utf8')).toBe('x'.repeat(10));
    } finally {
      if (result.ok) result.lease.release();
    }
  });

  it('evicts a ready clone when its final waiter cancels', async () => {
    const c = cache({ baseDir: baseDir(), maxIdleBytes: 10 });
    const held = await c.acquire('held', fakeClone(10));
    if (!held.ok) throw new Error('acquire failed');

    let secondDir = '';
    const controller = new AbortController();
    raceGate.reset();
    raceGate.enabled = true;
    raceGate.abortable = true;
    const second = c.acquire('second', async (dest, signal) => {
      secondDir = dest;
      return fakeClone(10)(dest, signal);
    }, controller.signal);
    await raceGate.reached;
    held.lease.release();
    controller.abort();

    await expect(second).rejects.toThrow('Operation aborted');
    await vi.waitFor(() => expect(existsSync(secondDir)).toBe(false));
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

  it('waits for a cancelled clone cleanup before acquiring the same key again', async () => {
    rmGate.reset();
    const c = cache({ baseDir: baseDir() });
    let cancelledDir = '';
    const first: CloneFn = async (dest, signal) => {
      cancelledDir = dest;
      await mkdir(dest, { recursive: true });
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => reject(abortError()), 50);
        }, { once: true });
      });
      throw new Error('unreachable');
    };
    const controller = new AbortController();
    const pending = c.acquire('same-key', first, controller.signal);
    await vi.waitFor(() => expect(cancelledDir).not.toBe(''));
    rmGate.path = cancelledDir;
    controller.abort();
    await expect(pending).rejects.toThrow('Operation aborted');

    const freshClone = fakeClone(20);
    const retry = c.acquire('same-key', freshClone);
    let acquired: Awaited<typeof retry> | undefined;
    try {
      await rmGate.started;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(freshClone.calls).toHaveLength(0);

      rmGate.release();
      acquired = await retry;
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;
      expect(freshClone.calls).toHaveLength(1);
      expect(existsSync(acquired.lease.dir)).toBe(true);
      expect(readFileSync(join(acquired.lease.dir, 'data'), 'utf8')).toHaveLength(20);
    } finally {
      rmGate.release();
      acquired ??= await retry;
      if (acquired.ok) acquired.lease.release();
      rmGate.reset();
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

  it('creates the cache base and instance folders private to this user', async () => {
    const parent = baseDir();
    const base = join(parent, 'cache');
    const c = cache({ baseDir: base });
    const result = await c.acquire('k', fakeClone());
    if (!result.ok) throw new Error('acquire failed');
    try {
      expect(lstatSync(base).mode & 0o777).toBe(0o700);
      expect(lstatSync(c.root).mode & 0o777).toBe(0o700);
    } finally {
      result.lease.release();
    }
  });

  it('accepts a mode 755 base on win32 and removes its instance after a lease is released', async () => {
    const parent = baseDir();
    const base = join(parent, 'cache');
    mkdirSync(base);
    chmodSync(base, 0o755);
    const c = cache({ baseDir: base, platform: 'win32' });
    const result = await c.acquire('k', fakeClone());
    try {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(readFileSync(join(result.lease.dir, 'data'), 'utf8')).toBe('x'.repeat(10));
    } finally {
      if (result.ok) result.lease.release();
      await c.close();
    }
    expect(existsSync(c.root)).toBe(false);
  });

  it('refuses a mode 755 base on linux', async () => {
    const parent = baseDir();
    const base = join(parent, 'cache');
    mkdirSync(base);
    chmodSync(base, 0o755);
    const c = cache({ baseDir: base, platform: 'linux' });
    const result = await c.acquire('k', fakeClone());
    try {
      expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'REPO_CACHE_UNSAFE' }) });
    } finally {
      if (result.ok) result.lease.release();
    }
  });

  it.each(['win32', 'linux'] as const)('refuses a symlink cache base on %s', async (platform) => {
    const parent = baseDir();
    const base = join(parent, 'cache');
    symlinkSync(parent, base);
    const c = cache({ baseDir: base, platform });
    const result = await c.acquire('k', fakeClone());
    try {
      expect(result).toEqual({ ok: false, failure: expect.objectContaining({ code: 'REPO_CACHE_UNSAFE' }) });
    } finally {
      if (result.ok) result.lease.release();
    }
  });

  it.each([
    ['a symlink', (base: string, target: string) => symlinkSync(target, base)],
    ['world-readable permissions', (base: string) => {
      mkdirSync(base);
      chmodSync(base, 0o755);
    }],
    ['group-readable permissions', (base: string) => {
      mkdirSync(base);
      chmodSync(base, 0o750);
    }]
  ])('refuses an unsafe cache base with %s', async (_description, makeUnsafe) => {
    const parent = baseDir();
    const base = join(parent, 'cache');
    makeUnsafe(base, parent);
    const leftover = join(parent, 'otherboot-999999-dead');
    mkdirSync(leftover);
    const c = cache({ baseDir: base });
    const clone = fakeClone();

    const result = await c.acquire('k', clone);
    try {
      expect(result).toEqual({
        ok: false,
        failure: {
          code: 'REPO_CACHE_UNSAFE',
          message: `the repo cache folder ${base} isn't private to this user`,
          failure: { kind: 'not_configured' }
        }
      });
      expect(clone.calls).toHaveLength(0);
      await c.sweepLeftovers();
      await c.close();
      expect(existsSync(leftover)).toBe(true);
    } finally {
      if (result.ok) result.lease.release();
    }
  });

  it('sweeps safe leftovers when the cache is created', async () => {
    const base = baseDir();
    const leftover = join(base, 'otherboot-999999-dead');
    mkdirSync(leftover);
    const c = cache({ baseDir: base });

    await vi.waitFor(() => expect(existsSync(leftover)).toBe(false));
    await c.close();
  });

  it('retries after an unsafe cache base is repaired', async () => {
    const parent = baseDir();
    const base = join(parent, 'cache');
    mkdirSync(base);
    chmodSync(base, 0o750);
    const c = cache({ baseDir: base });

    await expect(c.acquire('k', fakeClone())).resolves.toEqual({ ok: false, failure: expect.objectContaining({ code: 'REPO_CACHE_UNSAFE' }) });
    chmodSync(base, 0o700);
    const result = await c.acquire('k', fakeClone());
    try {
      expect(result.ok).toBe(true);
    } finally {
      if (result.ok) result.lease.release();
    }
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
