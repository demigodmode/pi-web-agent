import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const handleCalls = vi.hoisted(() => ({
  closed: 0,
  lengths: [] as number[],
  blockOpen: false,
  openEntered: undefined as (() => void) | undefined,
  releaseOpen: undefined as (() => void) | undefined
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (handleCalls.blockOpen) {
        handleCalls.openEntered?.();
        await new Promise<void>((resolve) => {
          handleCalls.releaseOpen = resolve;
        });
      }
      return {
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          handleCalls.lengths.push(length);
          return handle.read(buffer, offset, length, position);
        },
        close: async () => {
          handleCalls.closed++;
          return handle.close();
        }
      };
    }
  };
});

import { MAX_SEARCH_FILE_BYTES, searchRepo } from '../../src/repo/repo-search.js';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  handleCalls.closed = 0;
  handleCalls.lengths.length = 0;
  handleCalls.blockOpen = false;
  handleCalls.openEntered = undefined;
  handleCalls.releaseOpen = undefined;
});

function tree(files: Record<string, string | Buffer | { symlink: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'pwa-search-'));
  temps.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    if (typeof content === 'object' && !Buffer.isBuffer(content)) symlinkSync(content.symlink, target);
    else writeFileSync(target, content);
  }
  return root;
}

const impl = `import { oauthClient } from './client';

export async function refreshToken(session) {
  // Swap the refresh token for a new OAuth access token before it expires.
  const response = await oauthClient.post('/token', { grant_type: 'refresh_token', refresh_token: session.refreshToken });
  session.accessToken = response.access_token;
  return session;
}
`;

describe('searchRepo walk and scoring', () => {
  it('ranks the nested implementation above a README that mentions the terms', async () => {
    const root = tree({
      'README.md': '# Widget\nWe refresh OAuth tokens for you.',
      'src/auth/token-refresh.ts': impl,
      'src/ui/button.ts': 'export const Button = 1;'
    });
    const result = await searchRepo(root, { query: 'where does this project refresh OAuth tokens?' });
    expect(result.scopeFound).toBe(true);
    expect(result.terms).toEqual(['refresh', 'oauth', 'tokens']);
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts', 'README.md']);
    expect(result.files[0].score).toBeGreaterThan(result.files[1].score);
  });

  it('skips vendored folders, lockfiles, binaries and huge files', async () => {
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      'node_modules/oauth-lib/refresh-token.js': impl,
      'vendor/refresh.go': impl,
      'dist/bundle.js': impl,
      'package-lock.json': '{"refresh":"oauth token"}',
      'assets/refresh-token.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x72, 0x65]),
      'data/blob.dat': Buffer.concat([Buffer.from('refresh oauth token'), Buffer.from([0]), Buffer.from('x')]),
      'big/refresh-token.ts': `// refresh oauth token\n${'x'.repeat(MAX_SEARCH_FILE_BYTES)}`
    });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
  });

  it('never reads through symlinks', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'pwa-outside-'));
    temps.push(outside);
    writeFileSync(join(outside, 'secret.ts'), 'refresh oauth token SECRET-VALUE');
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      'src/link.ts': { symlink: join(outside, 'secret.ts') },
      'src/linkdir': { symlink: outside }
    });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
  });

  it('skips .git aliases while walking', async () => {
    const root = tree({
      'src/auth/token-refresh.ts': impl,
      '.GiT./secret.ts': 'refresh oauth token SECRET-VALUE',
      'nested/.git /secret.ts': 'refresh oauth token SECRET-VALUE'
    });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE');
  });

  it('limits the search to the folder scope and keeps paths relative to the repo root', async () => {
    const root = tree({ 'src/auth/token-refresh.ts': impl, 'lib/refresh.ts': impl });
    const result = await searchRepo(root, { query: 'refresh OAuth tokens', pathScope: 'src/auth' });
    expect(result.files.map((file) => file.path)).toEqual(['src/auth/token-refresh.ts']);
  });

  it('reports a missing or escaping scope', async () => {
    const root = tree({ 'src/a.ts': impl });
    await expect(searchRepo(root, { query: 'refresh', pathScope: 'nope' })).resolves.toMatchObject({ scopeFound: false, files: [] });
    await expect(searchRepo(root, { query: 'refresh', pathScope: '../..' })).resolves.toMatchObject({ scopeFound: false, files: [] });
  });

  it('returns no files when the question has no terms', async () => {
    const root = tree({ 'src/a.ts': impl });
    await expect(searchRepo(root, { query: 'what is this?' })).resolves.toEqual({ scopeFound: true, terms: [], files: [] });
  });

  it('keeps only the best few files', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`src/f${i}.ts`] = `refresh ${i % 2 ? 'oauth' : ''} token`;
    const result = await searchRepo(tree(files), { query: 'refresh oauth tokens', maxFiles: 4 });
    expect(result.files).toHaveLength(4);
    for (const file of result.files) expect(Number(file.path.match(/f(\d)/)![1]) % 2).toBe(1);
  });

  it('reads at most the configured cap and closes each handle', async () => {
    const root = tree({ 'src/auth/token-refresh.ts': impl });
    await searchRepo(root, { query: 'refresh OAuth tokens' });
    expect(handleCalls.lengths).toEqual([MAX_SEARCH_FILE_BYTES + 1]);
    expect(handleCalls.closed).toBe(1);
  });

  it('closes a handle when cancellation arrives while it is opening', async () => {
    const root = tree({ 'src/auth/token-refresh.ts': impl });
    const controller = new AbortController();
    const opened = new Promise<void>((resolve) => {
      handleCalls.openEntered = resolve;
    });
    handleCalls.blockOpen = true;
    const search = searchRepo(root, { query: 'refresh OAuth tokens', signal: controller.signal });
    await opened;
    controller.abort();
    handleCalls.releaseOpen!();
    await expect(search).rejects.toThrow('Operation aborted');
    expect(handleCalls.closed).toBe(1);
  });

  it('stops when the signal fires', async () => {
    const root = tree({ 'src/a.ts': impl });
    const controller = new AbortController();
    controller.abort();
    await expect(searchRepo(root, { query: 'refresh', signal: controller.signal })).rejects.toThrow('Operation aborted');
  });
});
