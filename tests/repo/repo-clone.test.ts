import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureGitVersion, runGit } from '../../src/repo/git-runner.js';
import { cloneRepo } from '../../src/repo/repo-clone.js';
import { createFixtureRepo, FAKE_GIT_OLD, FAKE_GIT_SLEEP, fakeGit, isAlive, readPids, type FixtureRepo } from './git-fixtures.js';

const fixtures: FixtureRepo[] = [];
const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwa-clone-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const fixture = (files: Parameters<typeof createFixtureRepo>[0]) => {
  const repo = createFixtureRepo(files);
  fixtures.push(repo);
  return repo;
};

describe('cloneRepo', () => {
  it('fetches exactly the requested commit at depth 1', async () => {
    const repo = fixture({ 'README.md': 'hello', 'src/auth/refresh.ts': 'export const refresh = 1;' });
    const dest = join(tempDir(), 'clone');
    const result = await cloneRepo({ owner: 'acme', repo: 'widget', sha: repo.sha, dest }, { git: repo.gitEnv() });
    expect(result).toEqual({ ok: true, sha: repo.sha });
    expect(readFileSync(join(dest, 'src/auth/refresh.ts'), 'utf8')).toBe('export const refresh = 1;');
  });

  it('still gets the requested commit after the branch moved on', async () => {
    const repo = fixture({ 'version.txt': 'one' });
    const first = repo.sha;
    repo.commit({ 'version.txt': 'two' });
    const dest = join(tempDir(), 'clone');
    const result = await cloneRepo({ owner: 'acme', repo: 'widget', sha: first, dest }, { git: repo.gitEnv() });
    expect(result).toEqual({ ok: true, sha: first });
    expect(readFileSync(join(dest, 'version.txt'), 'utf8')).toBe('one');
  });

  it('checks symlinks out as plain files', async () => {
    const repo = fixture({ 'README.md': 'hi', escape: { symlink: '../../../etc/passwd' } });
    const dest = join(tempDir(), 'clone');
    await cloneRepo({ owner: 'acme', repo: 'widget', sha: repo.sha, dest }, { git: repo.gitEnv() });
    expect(lstatSync(join(dest, 'escape')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dest, 'escape'), 'utf8')).toBe('../../../etc/passwd');
  });

  it('ignores a user config that rewrites the remote', async () => {
    const repo = fixture({ 'README.md': 'hi' });
    const home = tempDir();
    writeFileSync(join(home, '.gitconfig'), '[url "ssh://git@nowhere.invalid/"]\n\tinsteadOf = file://\n');
    vi.stubEnv('HOME', home);
    vi.stubEnv('XDG_CONFIG_HOME', home);
    const dest = join(tempDir(), 'clone');
    const result = await cloneRepo({ owner: 'acme', repo: 'widget', sha: repo.sha, dest }, { git: repo.gitEnv() });
    expect(result).toEqual({ ok: true, sha: repo.sha });
  });

  it.each(['ssh://git@127.0.0.1:1/acme/widget.git', 'git://127.0.0.1:1/acme/widget.git'])('refuses a %s remote', async (remote) => {
    const dest = join(tempDir(), 'clone');
    const result = await cloneRepo({ owner: 'acme', repo: 'widget', sha: 'a'.repeat(40), dest }, { git: { remoteUrl: () => remote } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('REPO_CLONE_FAILED');
      expect(result.failure.message).toMatch(/not allowed/);
    }
    expect(existsSync(dest)).toBe(false);
  });

  it('times out, kills git and removes the folder', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    const dest = join(tempDir(), 'clone');
    const git = fakeGit(FAKE_GIT_SLEEP);
    await expect(ensureGitVersion(git)).resolves.toMatchObject({ ok: true });
    const pending = cloneRepo(
      { owner: 'acme', repo: 'widget', sha: 'a'.repeat(40), dest },
      { git, timeoutMs: 2_000 }
    );
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    const pids = readPids(pidFile)!;
    expect(isAlive(pids.pid)).toBe(true);
    const result = await pending.then(async (value) => {
      expect(isAlive(pids.pid)).toBe(false);
      await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
      return value;
    });
    expect(result).toEqual({
      ok: false,
      failure: { code: 'REPO_CLONE_TIMEOUT', message: 'Cloning acme/widget timed out after 2s.', failure: { kind: 'transient' } }
    });
    expect(existsSync(dest)).toBe(false);
  });

  it('cancels mid-clone, kills git and removes the folder', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    const dest = join(tempDir(), 'clone');
    const controller = new AbortController();
    const pending = cloneRepo({ owner: 'acme', repo: 'widget', sha: 'a'.repeat(40), dest }, { git: fakeGit(FAKE_GIT_SLEEP), signal: controller.signal });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    const pids = readPids(pidFile)!;
    controller.abort();
    const settled = pending.then(
      () => {
        throw new Error('expected clone cancellation');
      },
      async (error) => {
        expect(isAlive(pids.pid)).toBe(false);
        await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
        throw error;
      }
    );
    await expect(settled).rejects.toThrow('Operation aborted');
    expect(existsSync(dest)).toBe(false);
  });

  it('reports a missing or too old git', async () => {
    const dest = join(tempDir(), 'clone');
    const missing = await cloneRepo({ owner: 'acme', repo: 'widget', sha: 'a'.repeat(40), dest }, { git: { gitBinary: join(tempDir(), 'nope') } });
    expect(missing.ok === false && missing.failure.code).toBe('GIT_MISSING');
    const old = await cloneRepo({ owner: 'acme', repo: 'widget', sha: 'a'.repeat(40), dest }, { git: fakeGit(FAKE_GIT_OLD) });
    expect(old.ok === false && old.failure.code).toBe('GIT_TOO_OLD');
  });

  it('keeps the proxy password and token out of argv', async () => {
    const repo = fixture({ 'README.md': 'hi' });
    const seen: Array<{ args: string[]; env: { token?: string; proxyUrl?: string } }> = [];
    const runGitImpl = vi.fn(async (args: string[], options: Parameters<typeof runGit>[1]) => {
      seen.push({ args, env: options.env });
      return runGit(args, options);
    }) as unknown as typeof runGit;
    const dest = join(tempDir(), 'clone');
    await cloneRepo(
      { owner: 'acme', repo: 'widget', sha: repo.sha, dest },
      { git: repo.gitEnv({ token: 'sekret-token', proxyUrl: 'http://u:pw-secret@127.0.0.1:9/' }), runGitImpl }
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.args.join(' ')).not.toContain('sekret-token');
      expect(call.args.join(' ')).not.toContain('pw-secret');
      expect(call.env.token).toBe('sekret-token');
    }
  });

  it('reports a failed fetch with git’s reason', async () => {
    const repo = fixture({ 'README.md': 'hi' });
    const dest = join(tempDir(), 'clone');
    const result = await cloneRepo({ owner: 'acme', repo: 'widget', sha: 'd'.repeat(40), dest }, { git: repo.gitEnv() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('REPO_CLONE_FAILED');
    expect(existsSync(dest)).toBe(false);
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(repo.sha);
  });
});
