import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { raceAbort, throwIfAborted } from '../abort.js';
import { REPO_CLOSE_GRACE_MS, REPO_IDLE_CACHE_MAX_BYTES } from './limits.js';
import { repoFailure, type RepoFailure } from './types.js';

export type Lease = {
  dir: string;
  sha: string;
  reused: boolean;
  signal: AbortSignal;
  release(): void;
};
export type CloneFn = (dest: string, signal: AbortSignal) => Promise<{ ok: true; sha: string } | { ok: false; failure: RepoFailure }>;
export type AcquireResult = { ok: true; lease: Lease } | { ok: false; failure: RepoFailure };

export type RepoCache = {
  readonly root: string;
  acquire(key: string, clone: CloneFn, signal?: AbortSignal): Promise<AcquireResult>;
  sweepLeftovers(): Promise<void>;
  close(): Promise<void>;
};

export type RepoCacheOptions = {
  baseDir?: string;
  maxIdleBytes?: number;
  closeGraceMs?: number;
  bootId?: string;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
  now?: () => number;
};

type Outcome = { ok: true } | { ok: false; failure: RepoFailure };
type Entry = {
  key: string;
  dir: string;
  state: 'cloning' | 'ready';
  sha?: string;
  size: number;
  leases: number;
  lastReleased: number;
  waiters: number;
  controller: AbortController;
  ready: Promise<Outcome>;
};

const FOLDER = /^([0-9a-z]+)-(\d+)-([0-9a-f]+)$/;
const closedFailure = () => repoFailure('REPO_CACHE_CLOSED', 'The session is ending, so the repo was not searched.', 'transient');
const cancelledCloneFailure = () => repoFailure('REPO_CLONE_CANCELLED', 'The clone was cancelled.', 'transient');

function currentBootId(): string {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim().replace(/[^0-9a-z]/gi, '').toLowerCase();
  } catch {
    return 'b0';
  }
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    const items = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const path = join(current, item.name);
      if (item.isDirectory()) stack.push(path);
      else if (item.isFile()) total += (await lstat(path).catch(() => ({ size: 0 }))).size;
    }
  }
  return total;
}

export function createRepoCache(options: RepoCacheOptions = {}): RepoCache {
  const baseDir = options.baseDir ?? join(tmpdir(), 'pi-web-agent-repos');
  const bootId = options.bootId ?? currentBootId();
  const pid = options.pid ?? process.pid;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const now = options.now ?? Date.now;
  const maxIdleBytes = options.maxIdleBytes ?? REPO_IDLE_CACHE_MAX_BYTES;
  const closeGraceMs = options.closeGraceMs ?? REPO_CLOSE_GRACE_MS;
  const ownName = `${bootId}-${pid}-${randomBytes(6).toString('hex')}`;
  const root = join(baseDir, ownName);

  const entries = new Map<string, Entry>();
  const removals = new Set<Promise<void>>();
  const removalsByDir = new Map<string, Promise<void>>();
  const closing = new AbortController();
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let leaseCount = 0;
  let onLeasesDrained: (() => void) | undefined;

  const remove = (dir: string) => {
    const existing = removalsByDir.get(dir);
    if (existing) return existing;
    const removal: Promise<void> = rm(dir, { recursive: true, force: true })
      .catch(() => undefined)
      .finally(() => {
        removals.delete(removal);
        if (removalsByDir.get(dir) === removal) removalsByDir.delete(dir);
      });
    removals.add(removal);
    removalsByDir.set(dir, removal);
    return removal;
  };

  const sweepLeftovers = async () => {
    let names: string[];
    try {
      names = await readdir(baseDir);
    } catch {
      return;
    }
    await Promise.all(names.map(async (name) => {
      if (name === ownName) return;
      const match = FOLDER.exec(name);
      if (!match) return;
      if (match[1] === bootId && isPidAlive(Number(match[2]))) return;
      await rm(join(baseDir, name), { recursive: true, force: true }).catch(() => undefined);
    }));
  };
  const initialSweep = sweepLeftovers();

  const evictIdle = () => {
    const idle = [...entries.values()]
      .filter((entry) => entry.state === 'ready' && entry.leases === 0)
      .sort((a, b) => a.lastReleased - b.lastReleased);
    let total = idle.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of idle) {
      if (total <= maxIdleBytes) break;
      entries.delete(entry.key);
      total -= entry.size;
      void remove(entry.dir);
    }
  };

  const makeLease = (entry: Entry, reused: boolean): Lease => {
    entry.leases++;
    leaseCount++;
    let released = false;
    return {
      dir: entry.dir,
      sha: entry.sha!,
      reused,
      signal: closing.signal,
      release() {
        if (released) return;
        released = true;
        entry.leases--;
        leaseCount--;
        entry.lastReleased = now();
        if (leaseCount === 0) onLeasesDrained?.();
        if (!closed) evictIdle();
      }
    };
  };

  const joinClone = async (entry: Entry, signal: AbortSignal | undefined): Promise<AcquireResult> => {
    entry.waiters++;
    try {
      const outcome = signal ? await raceAbort(entry.ready, signal) : await entry.ready;
      if (!outcome.ok) return { ok: false, failure: outcome.failure };
      if (closed) return { ok: false, failure: closedFailure() };
      const lease = makeLease(entry, false);
      evictIdle();
      return { ok: true, lease };
    } finally {
      entry.waiters--;
      if (entry.waiters === 0 && entry.state === 'cloning') entry.controller.abort();
    }
  };

  const acquire = async (key: string, clone: CloneFn, signal?: AbortSignal): Promise<AcquireResult> => {
    if (closed) return { ok: false, failure: closedFailure() };
    throwIfAborted(signal);
    const existing = entries.get(key);
    if (existing?.controller.signal.aborted) {
      if (signal) await raceAbort(existing.ready, signal);
      else await existing.ready;
      return acquire(key, clone, signal);
    }
    if (existing?.state === 'ready') return { ok: true, lease: makeLease(existing, true) };
    if (existing) return joinClone(existing, signal);

    const controller = new AbortController();
    const entry: Entry = {
      key,
      dir: join(root, createHash('sha256').update(key).digest('hex')),
      state: 'cloning',
      size: 0,
      leases: 0,
      lastReleased: 0,
      waiters: 0,
      controller,
      ready: Promise.resolve({ ok: true })
    };
    entries.set(key, entry);
    entry.ready = (async (): Promise<Outcome> => {
      try {
        await initialSweep;
        await sweepLeftovers();
        const priorRemoval = removalsByDir.get(entry.dir);
        if (priorRemoval) await raceAbort(priorRemoval, controller.signal);
        await mkdir(root, { recursive: true });
        throwIfAborted(controller.signal);
        const result = await clone(entry.dir, controller.signal);
        if (!result.ok) {
          entries.delete(key);
          await remove(entry.dir);
          return result;
        }
        if (closed || controller.signal.aborted) {
          entries.delete(key);
          await remove(entry.dir);
          return { ok: false, failure: closed ? closedFailure() : cancelledCloneFailure() };
        }
        entry.size = await folderSize(entry.dir);
        if (closed || controller.signal.aborted) {
          entries.delete(key);
          await remove(entry.dir);
          return { ok: false, failure: closed ? closedFailure() : cancelledCloneFailure() };
        }
        entry.sha = result.sha;
        entry.state = 'ready';
        return { ok: true };
      } catch (error) {
        entries.delete(key);
        await remove(entry.dir);
        if (closed) return { ok: false, failure: closedFailure() };
        if (controller.signal.aborted) return { ok: false, failure: cancelledCloneFailure() };
        return { ok: false, failure: repoFailure('REPO_CACHE_FAILED', `Couldn't prepare the clone: ${error instanceof Error ? error.message : String(error)}`, 'transient') };
      }
    })();
    return joinClone(entry, signal);
  };

  const close = () => (closePromise ??= (async () => {
    closed = true;
    const cloning = [...entries.values()].filter((entry) => entry.state === 'cloning');
    for (const entry of cloning) entry.controller.abort();
    await Promise.allSettled(cloning.map((entry) => entry.ready));
    closing.abort();
    if (leaseCount > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, closeGraceMs);
        timer.unref?.();
        onLeasesDrained = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    await Promise.allSettled([...removals]);
    entries.clear();
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  })());

  return { root, acquire, sweepLeftovers, close };
}
