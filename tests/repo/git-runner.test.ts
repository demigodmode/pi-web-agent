import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureGitVersion,
  gitProcessEnv,
  productionGitEnv,
  proxyUrlForGit,
  runGit
} from '../../src/repo/git-runner.js';
import { FAKE_GIT_ERROR, FAKE_GIT_OLD, FAKE_GIT_SLEEP, fakeGit, isAlive, readPids } from './git-fixtures.js';

const sleepingVersionGit = (key: string) => fakeGit(FAKE_GIT_SLEEP, { gitArgsPrefix: [FAKE_GIT_SLEEP, key] });
const temps: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwa-git-runner-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('git runner', () => {
  it('runs real git', async () => {
    const result = await runGit(['--version'], { timeoutMs: 10_000, env: {} });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stdout).toMatch(/^git version \d+\.\d+/);
  });

  it('isolates git from the parent environment and the user config', () => {
    const env = gitProcessEnv(
      { token: 'sekret-token', proxyUrl: 'http://u:p@proxy.local:3128/', extraAllowedProtocols: ['file'] },
      { PATH: '/usr/bin', HOME: '/home/x', GIT_DIR: '/evil', GIT_CONFIG_PARAMETERS: "'core.x=1'", HTTPS_PROXY: 'http://other:1', no_proxy: '*' }
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.no_proxy).toBeUndefined();
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_CONFIG_GLOBAL).toBe(devNull);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_LFS_SKIP_SMUDGE).toBe('1');
    expect(env.GCM_INTERACTIVE).toBe('never');

    const config = Object.fromEntries(
      Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]])
    );
    expect(config).toEqual({
      'protocol.allow': 'never',
      'protocol.https.allow': 'always',
      'protocol.file.allow': 'always',
      'core.symlinks': 'false',
      'http.proxy': 'http://u:p@proxy.local:3128/',
      'http.https://github.com/.extraHeader': 'Authorization: Basic eC1hY2Nlc3MtdG9rZW46c2VrcmV0LXRva2Vu'
    });
  });

  it('never lets production wiring reach the test-only transports', () => {
    expect(productionGitEnv()).toEqual({});
    expect(productionGitEnv({ proxyUrl: 'http://proxy.local:3128/' })).toEqual({ proxyUrl: 'http://proxy.local:3128/' });
    const env = productionGitEnv({ proxyUrl: 'http://proxy.local:3128/' }) as Record<string, unknown>;
    expect(env.remoteUrl).toBeUndefined();
    expect(env.extraAllowedProtocols).toBeUndefined();
  });

  it('builds the proxy URL for git with credentials from config or env', () => {
    expect(proxyUrlForGit({ url: 'http://proxy.local:3128', username: 'u', password: 'p@ss' })).toBe('http://u:p%40ss@proxy.local:3128/');
    vi.stubEnv('PI_WEB_AGENT_PROXY_USERNAME', 'envuser');
    vi.stubEnv('PI_WEB_AGENT_PROXY_PASSWORD', 'envpass');
    expect(proxyUrlForGit({ url: 'http://proxy.local:3128' })).toBe('http://envuser:envpass@proxy.local:3128/');
  });

  it('ignores url rewrites in the user git config', async () => {
    const home = tempDir();
    writeFileSync(join(home, '.gitconfig'), '[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n');
    const leaky = execFileSync('git', ['config', '--global', '--get-regexp', '^url\\.'], {
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig') },
      encoding: 'utf8'
    });
    expect(leaky).toContain('insteadof');
    vi.stubEnv('HOME', home);
    vi.stubEnv('XDG_CONFIG_HOME', home);
    const isolated = await runGit(['config', '--get-regexp', '^url\\.'], { timeoutMs: 10_000, env: {} });
    expect(isolated.ok).toBe(false);
  });

  it('reports a missing git clearly', async () => {
    const result = await runGit(['--version'], { timeoutMs: 5_000, env: { gitBinary: join(tempDir(), 'no-such-git') } });
    expect(result).toEqual({
      ok: false,
      failure: { code: 'GIT_MISSING', message: "git isn't installed, so repo code can't be searched.", failure: { kind: 'not_configured' } }
    });
  });

  it('refuses git older than 2.32', async () => {
    const result = await runGit(['status'], { timeoutMs: 5_000, env: fakeGit(FAKE_GIT_OLD) });
    expect(result).toEqual({
      ok: false,
      failure: { code: 'GIT_TOO_OLD', message: 'git 2.32 or newer is needed to search repo code.', failure: { kind: 'not_configured' } }
    });
    const version = await ensureGitVersion(fakeGit(FAKE_GIT_OLD));
    expect(version.ok).toBe(false);
  });

  it('does not start an uncached version check when already cancelled', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    vi.stubEnv('FAKE_GIT_SLEEP_VERSION', '1');
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(runGit(['fetch'], { timeoutMs: 5_000, signal: controller.signal, env: sleepingVersionGit('pre-aborted') })).rejects.toThrow(
        'Operation aborted'
      );
      expect(readPids(pidFile)).toBeUndefined();
    } finally {
      const pids = readPids(pidFile);
      if (pids && isAlive(pids.pid)) process.kill(-pids.pid, 'SIGKILL');
    }
  });

  it('kills and awaits an uncached version check when its only caller cancels', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    vi.stubEnv('FAKE_GIT_SLEEP_VERSION', '1');
    const controller = new AbortController();
    const running = runGit(['fetch'], { timeoutMs: 30_000, signal: controller.signal, env: sleepingVersionGit('sole-caller') });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    controller.abort();
    await expect(running).rejects.toThrow('Operation aborted');
    const pids = readPids(pidFile)!;
    expect(isAlive(pids.pid)).toBe(false);
    await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
  });

  it('keeps a shared version check alive until its last caller cancels', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    vi.stubEnv('FAKE_GIT_SLEEP_VERSION', '1');
    const firstController = new AbortController();
    const secondController = new AbortController();
    const env = sleepingVersionGit('shared-callers');
    const first = runGit(['fetch'], { timeoutMs: 30_000, signal: firstController.signal, env });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    const second = runGit(['fetch'], { timeoutMs: 30_000, signal: secondController.signal, env });
    firstController.abort();
    await expect(first).rejects.toThrow('Operation aborted');
    const pids = readPids(pidFile)!;
    expect(isAlive(pids.pid)).toBe(true);
    secondController.abort();
    await expect(second).rejects.toThrow('Operation aborted');
    expect(isAlive(pids.pid)).toBe(false);
    await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
  });

  it("returns a last waiter's timeout after the remaining caller cancels the shared version check", async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    vi.stubEnv('FAKE_GIT_SLEEP_VERSION', '1');
    const env = sleepingVersionGit('last-timeout');
    const firstController = new AbortController();
    const first = runGit(['fetch'], { timeoutMs: 30_000, signal: firstController.signal, env });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    const second = runGit(['fetch'], { timeoutMs: 400, env });
    firstController.abort();
    await expect(first).rejects.toThrow('Operation aborted');
    await expect(second).resolves.toMatchObject({ ok: false, failure: { code: 'GIT_TIMEOUT' } });
    const pids = readPids(pidFile)!;
    expect(isAlive(pids.pid)).toBe(false);
    await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
  });

  it('keeps a shared version check alive past the first caller timeout', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    vi.stubEnv('FAKE_GIT_SLEEP_VERSION', '1');
    const env = sleepingVersionGit('first-timeout');
    const first = runGit(['fetch'], { timeoutMs: 400, env });
    const controller = new AbortController();
    const second = runGit(['fetch'], { timeoutMs: 30_000, signal: controller.signal, env });
    await expect(first).resolves.toMatchObject({ ok: false, failure: { code: 'GIT_TIMEOUT' } });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    const state = await Promise.race([second.then(() => 'settled'), new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 900))]);
    expect(state).toBe('waiting');
    const pids = readPids(pidFile)!;
    expect(isAlive(pids.pid)).toBe(true);
    controller.abort();
    await expect(second).rejects.toThrow('Operation aborted');
    expect(isAlive(pids.pid)).toBe(false);
    await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
  });

  it('spends the caller timeout budget on an uncached version check', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    vi.stubEnv('FAKE_GIT_SLEEP_VERSION', '1');
    const started = Date.now();
    const result = await runGit(['fetch'], { timeoutMs: 400, env: sleepingVersionGit('version-timeout') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('GIT_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(1_500);
    const pids = readPids(pidFile);
    if (pids) {
      expect(isAlive(pids.pid)).toBe(false);
      await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
    }
  });

  it('keeps each shared version-check wait within its caller timeout budget', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    vi.stubEnv('FAKE_GIT_SLEEP_VERSION', '1');
    const env = sleepingVersionGit('shared-timeout');
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = runGit(['fetch'], { timeoutMs: 30_000, signal: firstController.signal, env });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    const second = runGit(['fetch'], { timeoutMs: 400, signal: secondController.signal, env });
    try {
      const result = await Promise.race([second, new Promise<undefined>((resolve) => setTimeout(resolve, 1_500))]);
      expect(result).toMatchObject({ ok: false, failure: { code: 'GIT_TIMEOUT' } });
      expect(isAlive(readPids(pidFile)!.pid)).toBe(true);
    } finally {
      firstController.abort();
      secondController.abort();
      await Promise.allSettled([first, second]);
      const pids = readPids(pidFile);
      if (pids && isAlive(pids.pid)) process.kill(-pids.pid, 'SIGKILL');
    }
  });

  it('kills the whole process group on timeout and returns only after git exited', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    const env = fakeGit(FAKE_GIT_SLEEP);
    await expect(runGit(['--version'], { timeoutMs: 10_000, env })).resolves.toMatchObject({ ok: true });
    const running = runGit(['fetch'], { timeoutMs: 2_000, env });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    const pids = readPids(pidFile)!;
    expect(isAlive(pids.pid)).toBe(true);
    const result = await running;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GIT_TIMEOUT');
      expect(result.failure.failure.kind).toBe('transient');
    }
    expect(isAlive(pids.pid)).toBe(false);
    await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
  });

  it('throws the abort error on cancel, after killing the group', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    vi.stubEnv('FAKE_GIT_PID_FILE', pidFile);
    const controller = new AbortController();
    const running = runGit(['fetch'], { timeoutMs: 30_000, signal: controller.signal, env: fakeGit(FAKE_GIT_SLEEP) });
    await vi.waitFor(() => expect(readPids(pidFile)).toBeDefined());
    controller.abort();
    await expect(running).rejects.toThrow('Operation aborted');
    const pids = readPids(pidFile)!;
    expect(isAlive(pids.pid)).toBe(false);
    await vi.waitFor(() => expect(isAlive(pids.grandchild)).toBe(false));
  });

  it('does not start git when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runGit(['--version'], { timeoutMs: 5_000, signal: controller.signal, env: {} })).rejects.toThrow('Operation aborted');
  });

  it('keeps raw and encoded Basic credentials out of git error messages', async () => {
    const token = 'sekret-token';
    const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
    const result = await runGit(['fetch'], {
      timeoutMs: 10_000,
      env: { token, ...fakeGit(FAKE_GIT_ERROR) }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).not.toContain(token);
      expect(result.failure.message).not.toContain(encoded);
    }
  });
});
