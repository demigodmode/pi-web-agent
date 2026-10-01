import { execFile } from 'node:child_process';
import { GH_TOKEN_TIMEOUT_MS } from './limits.js';

export type GithubToken = { token?: string; source: 'env' | 'gh' | 'none' };
export type RunGh = (args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>;

export const defaultRunGh: RunGh = (args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      args,
      { timeout: timeoutMs, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } },
      (error, stdout) => {
        if (error) {
          const code = (error as { code?: unknown }).code;
          resolve({ code: typeof code === 'number' ? code : 1, stdout: '' });
          return;
        }
        resolve({ code: 0, stdout: String(stdout) });
      }
    );
  });

/**
 * One GitHub credential for the API calls and git (#72): GITHUB_TOKEN, else the gh CLI's
 * token when gh is installed and signed in, else none (public repos only). gh is only ever
 * asked for its token; it never clones. The token is never logged.
 */
export async function resolveGithubToken({
  env = process.env,
  runGh = defaultRunGh
}: { env?: NodeJS.ProcessEnv; runGh?: RunGh } = {}): Promise<GithubToken> {
  const fromEnv = env.GITHUB_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: 'env' };
  try {
    const result = await runGh(['auth', 'token', '--hostname', 'github.com'], GH_TOKEN_TIMEOUT_MS);
    const token = result.stdout.trim();
    if (result.code === 0 && token) return { token, source: 'gh' };
  } catch {
    // gh missing or broken: public repos only.
  }
  return { source: 'none' };
}
