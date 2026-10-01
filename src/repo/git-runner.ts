import { spawn, type ChildProcess } from 'node:child_process';
import { devNull } from 'node:os';
import { abortError } from '../abort.js';
import { stripProxyCredentials, type ProxyConfig } from '../backends/config.js';
import { resolveProxyCredentials } from '../fetch/proxy-fetch.js';
import { MIN_GIT_VERSION } from './limits.js';
import { repoFailure, type RepoFailure } from './types.js';

export type GitEnv = {
  /** Upstream proxy for git's HTTPS traffic, credentials included. Only ever passed through env. */
  proxyUrl?: string;
  /** GitHub token, sent as an HTTP header. Never in argv or a URL. */
  token?: string;
  /** Command to run. Defaults to `git`. */
  gitBinary?: string;
  /** Arguments placed before git's own, e.g. a script path when gitBinary is node (tests). */
  gitArgsPrefix?: string[];
  /** Tests only: extra transports to allow (fixtures use `file`). */
  extraAllowedProtocols?: string[];
  /** Tests only: where owner/repo lives instead of github.com. */
  remoteUrl?: (owner: string, repo: string) => string;
};

export type GitResult = { ok: true; stdout: string } | { ok: false; failure: RepoFailure };

export type RunGitOptions = { cwd?: string; signal?: AbortSignal; timeoutMs: number; env: GitEnv };

export function githubRemoteUrl(env: GitEnv, owner: string, repo: string): string {
  return env.remoteUrl ? env.remoteUrl(owner, repo) : `https://github.com/${owner}/${repo}.git`;
}

/** The only GitEnv production code builds: no test transports, no remote override. */
export function productionGitEnv({ proxyUrl }: { proxyUrl?: string } = {}): GitEnv {
  return proxyUrl ? { proxyUrl } : {};
}

/** The configured upstream proxy the way git wants it, credentials in the URL. */
export function proxyUrlForGit(proxy: ProxyConfig): string {
  const url = new URL(stripProxyCredentials(proxy.url));
  const credentials = resolveProxyCredentials(proxy);
  if (credentials.username !== undefined) url.username = credentials.username;
  if (credentials.password !== undefined) url.password = credentials.password;
  return url.toString();
}

const PROXY_ENV = /^(https?|all|no)_proxy$/i;

/**
 * Git's environment. Nothing git reads from the parent survives (GIT_DIR, GIT_CONFIG_PARAMETERS,
 * proxy variables), system and user config are switched off so no insteadOf rewrite or credential
 * helper applies, only HTTPS may be used, and the proxy and token travel as env config.
 */
export function gitProcessEnv(env: GitEnv, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!key.startsWith('GIT_') && !PROXY_ENV.test(key)) out[key] = value;
  }
  const config: Array<[string, string]> = [
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ...(env.extraAllowedProtocols ?? []).map((protocol): [string, string] => [`protocol.${protocol}.allow`, 'always']),
    ['core.symlinks', 'false']
  ];
  if (env.proxyUrl) config.push(['http.proxy', env.proxyUrl]);
  if (env.token) config.push(['http.https://github.com/.extraHeader', `Authorization: Bearer ${env.token}`]);

  out.GIT_CONFIG_NOSYSTEM = '1';
  out.GIT_CONFIG_GLOBAL = devNull;
  out.GIT_TERMINAL_PROMPT = '0';
  out.GIT_LFS_SKIP_SMUDGE = '1';
  out.GCM_INTERACTIVE = 'never';
  out.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([key, value], index) => {
    out[`GIT_CONFIG_KEY_${index}`] = key;
    out[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return out;
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function describeGitError(stderr: string, code: number | null, token: string | undefined): string {
  const line = stderr.split('\n').map((entry) => entry.trim()).filter(Boolean).at(-1)?.replace(/^fatal:\s*/, '');
  const message = line || `git exited with code ${code}`;
  return token ? message.split(token).join('***') : message;
}

function spawnGit(args: string[], { cwd, signal, timeoutMs, env }: RunGitOptions): Promise<GitResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawn(env.gitBinary ?? 'git', [...(env.gitArgsPrefix ?? []), ...args], {
      cwd,
      env: gitProcessEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so a timeout or cancel also takes down git's helpers.
      detached: process.platform !== 'win32',
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192);
    });

    let settled = false;
    let stopped: 'timeout' | 'abort' | undefined;
    let spawnError: NodeJS.ErrnoException | undefined;
    const stop = (reason: 'timeout' | 'abort') => {
      if (stopped) return;
      stopped = reason;
      killGroup(child);
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const onAbort = () => stop('abort');
    signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (result: GitResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      // No pid means git never started; 'close' may not follow.
      if (child.pid === undefined) {
        finish(
          error.code === 'ENOENT'
            ? { ok: false, failure: repoFailure('GIT_MISSING', "git isn't installed, so repo code can't be searched.", 'not_configured') }
            : { ok: false, failure: repoFailure('GIT_FAILED', `git couldn't start: ${error.message}`, 'transient') }
        );
        return;
      }
      spawnError = error;
    });
    // 'close' fires only after the process exited and its output closed, so a killed git is really gone.
    child.on('close', (code) => {
      if (stopped === 'abort') return finish(abortError());
      if (stopped === 'timeout') {
        return finish({
          ok: false,
          failure: repoFailure('GIT_TIMEOUT', `git ${args[0]} took longer than ${Math.round(timeoutMs / 1000)}s.`, 'transient')
        });
      }
      if (spawnError) return finish({ ok: false, failure: repoFailure('GIT_FAILED', spawnError.message, 'transient') });
      if (code === 0) return finish({ ok: true, stdout });
      finish({ ok: false, failure: repoFailure('GIT_FAILED', describeGitError(stderr, code, env.token), 'transient') });
    });
  });
}

type VersionCheck = {
  controller: AbortController;
  promise: Promise<GitResult>;
  waiters: Set<symbol>;
};

const versionChecks = new Map<string, VersionCheck>();
const GIT_VERSION_TIMEOUT_MS = 10_000;

function versionCheckKey(env: GitEnv): string {
  return [env.gitBinary ?? 'git', ...(env.gitArgsPrefix ?? [])].join('\0');
}

function startVersionCheck(key: string, env: GitEnv, timeoutMs: number): VersionCheck {
  const controller = new AbortController();
  const check: VersionCheck = {
    controller,
    promise: spawnGit(['--version'], {
      env: { gitBinary: env.gitBinary, gitArgsPrefix: env.gitArgsPrefix },
      signal: controller.signal,
      timeoutMs
    }).then((result): GitResult => {
      if (!result.ok) return result;
      const match = /git version (\d+)\.(\d+)/.exec(result.stdout);
      const major = Number(match?.[1]);
      const minor = Number(match?.[2]);
      if (!match || major < MIN_GIT_VERSION.major || (major === MIN_GIT_VERSION.major && minor < MIN_GIT_VERSION.minor)) {
        return { ok: false, failure: repoFailure('GIT_TOO_OLD', 'git 2.32 or newer is needed to search repo code.', 'not_configured') };
      }
      return result;
    }),
    waiters: new Set()
  };
  versionChecks.set(key, check);
  void check.promise.then(
    (result) => {
      if (!result.ok && result.failure.code === 'GIT_TIMEOUT' && versionChecks.get(key) === check) versionChecks.delete(key);
    },
    () => {
      if (versionChecks.get(key) === check) versionChecks.delete(key);
    }
  );
  return check;
}

function waitForVersion(key: string, check: VersionCheck, signal: AbortSignal | undefined, timeoutMs: number): Promise<GitResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  const waiter = Symbol();
  check.waiters.add(waiter);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let forcedResult: GitResult | Error | undefined;
    const finish = (result: GitResult | Error) => {
      if (settled) return;
      settled = true;
      check.waiters.delete(waiter);
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const timeoutFailure = (): GitResult => ({
      ok: false,
      failure: repoFailure('GIT_TIMEOUT', `git --version took longer than ${Math.round(timeoutMs / 1000)}s.`, 'transient')
    });
    const onAbort = () => {
      check.waiters.delete(waiter);
      if (check.waiters.size !== 0) return finish(abortError());
      if (versionChecks.get(key) === check) versionChecks.delete(key);
      forcedResult = abortError();
      check.controller.abort();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      check.waiters.delete(waiter);
      if (check.waiters.size !== 0) return finish(timeoutFailure());
      if (versionChecks.get(key) === check) versionChecks.delete(key);
      forcedResult = timeoutFailure();
      check.controller.abort();
    }, timeoutMs);
    void check.promise.then(
      (result) => finish(forcedResult ?? result),
      (error: unknown) => finish(forcedResult ?? (error instanceof Error ? error : new Error(String(error))) )
    );
  });
}

/** Checks once per git command that it exists and is 2.32+. A timeout isn't remembered. */
export function ensureGitVersion(env: GitEnv, signal?: AbortSignal, timeoutMs = 10_000): Promise<GitResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  const key = versionCheckKey(env);
  return waitForVersion(key, versionChecks.get(key) ?? startVersionCheck(key, env, GIT_VERSION_TIMEOUT_MS), signal, timeoutMs);
}

/** The one way repo research runs git (#72). Throws only abortError(); everything else is a result. */
export async function runGit(args: string[], options: RunGitOptions): Promise<GitResult> {
  const startedAt = Date.now();
  const remaining = () => options.timeoutMs - (Date.now() - startedAt);
  const version = await ensureGitVersion(options.env, options.signal, Math.max(0, remaining()));
  if (!version.ok) return version;
  const timeoutMs = remaining();
  if (timeoutMs <= 0) {
    return {
      ok: false,
      failure: repoFailure('GIT_TIMEOUT', `git ${args[0]} took longer than ${Math.round(options.timeoutMs / 1000)}s.`, 'transient')
    };
  }
  return spawnGit(args, { ...options, timeoutMs });
}
