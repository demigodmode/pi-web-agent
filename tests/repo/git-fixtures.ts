import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GitEnv } from '../../src/repo/git-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
export const FAKE_GIT_SLEEP = join(here, 'fixtures', 'fake-git-sleep.mjs');
export const FAKE_GIT_OLD = join(here, 'fixtures', 'fake-git-old.mjs');
export const FAKE_GIT_ERROR = join(here, 'fixtures', 'fake-git-error.mjs');

/** A GitEnv whose "git" is a Node script. */
export function fakeGit(script: string, extra: Partial<GitEnv> = {}): GitEnv {
  return { gitBinary: process.execPath, gitArgsPrefix: [script], ...extra };
}

// Fixture setup runs git with the same isolation production uses, so the dev's own config can't leak in.
const FIXTURE_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: devNull,
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com'
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    env: FIXTURE_ENV,
    encoding: 'utf8'
  }).trim();
}

export type FixtureFiles = Record<string, string | { symlink: string }>;

export type FixtureRepo = {
  root: string;
  work: string;
  bare: string;
  /** Latest commit made through this helper. */
  sha: string;
  commit(files: FixtureFiles, message?: string): string;
  newBranch(name: string): void;
  checkout(name: string): void;
  tag(name: string, options?: { annotated?: boolean }): void;
  /** GitEnv pointing owner/repo at this fixture over file://. */
  gitEnv(extra?: Partial<GitEnv>): GitEnv;
  cleanup(): void;
};

/** A work repo pushing to a bare repo that allows fetch-by-SHA, like GitHub does. */
export function createFixtureRepo(files: FixtureFiles): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), 'pwa-repo-fixture-'));
  const work = join(root, 'work');
  const bare = join(root, 'remote.git');
  mkdirSync(work);
  git(root, 'init', '-q', '--bare', bare);
  git(bare, 'config', 'uploadpack.allowReachableSHA1InWant', 'true');
  git(work, 'init', '-q');
  git(work, 'remote', 'add', 'origin', bare);

  const write = (next: FixtureFiles) => {
    for (const [path, content] of Object.entries(next)) {
      const target = join(work, path);
      mkdirSync(dirname(target), { recursive: true });
      if (typeof content === 'string') writeFileSync(target, content);
      else symlinkSync(content.symlink, target);
    }
  };
  const currentBranch = () => git(work, 'rev-parse', '--abbrev-ref', 'HEAD');

  const repo: FixtureRepo = {
    root,
    work,
    bare,
    sha: '',
    commit(next, message = 'update') {
      write(next);
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '--allow-empty', '-m', message);
      git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${currentBranch()}`);
      repo.sha = git(work, 'rev-parse', 'HEAD');
      return repo.sha;
    },
    newBranch(name) {
      git(work, 'checkout', '-q', '-b', name);
      git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${name}`);
    },
    checkout(name) {
      git(work, 'checkout', '-q', name);
    },
    tag(name, options = {}) {
      if (options.annotated) git(work, 'tag', '-a', '-m', `tag ${name}`, name);
      else git(work, 'tag', name);
      git(work, 'push', '-q', 'origin', `refs/tags/${name}`);
    },
    gitEnv(extra = {}) {
      return { remoteUrl: () => pathToFileURL(bare).href, extraAllowedProtocols: ['file'], ...extra };
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
  repo.commit(files, 'initial');
  return repo;
}

export function readPids(file: string): { pid: number; grandchild: number } | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { pid: number; grandchild: number }) : undefined;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
