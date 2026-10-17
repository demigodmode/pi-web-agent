import type { FailureInfo, WebFetchResponse } from '../types.js';
import type { SpecialContentReader } from './types.js';
import { READER_TEXT_CAP } from './limits.js';
import { abortError, PAGE_FETCH_TIMEOUT_MS, raceAbort, requestSignal } from '../abort.js';
import { parseRetryAfter } from '../backends/failure.js';
import { resolveGithubToken, type GithubToken } from '../repo/repo-auth.js';

const TOKEN_CACHE_MS = 60_000;
const MAX_COMMENT_PAGES = 3;

type GithubReaderDeps = {
  fetchImpl?: typeof fetch;
  resolveToken?: () => Promise<GithubToken>;
  now?: () => number;
  /** Test seam for the reader-wide request timeout. */
  timeoutMs?: number;
};

function parseGithub(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function safeRequestedUrl(url: string): string {
  const parsed = parseGithub(url);
  if (!parsed) return url;
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
}

type GithubShape = 'blob' | 'issue' | 'pull' | 'repo-root';

function classifyGithubShape(url: string): { shape: GithubShape; owner: string; repo: string; ref?: string; path?: string; num?: string } | undefined {
  const parsed = parseGithub(url);
  if (!parsed || parsed.hostname.toLowerCase() !== 'github.com') {
    return undefined;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const [owner, repo, type, ...rest] = segments;

  // blob: [owner, repo, 'blob', ref, ...path] with rest.length >= 2
  if (owner && repo && type === 'blob' && rest.length >= 2) {
    const [ref, ...pathParts] = rest;
    return { shape: 'blob', owner, repo, ref, path: pathParts.join('/') };
  }

  // issue: [owner, repo, 'issues', N]
  if (owner && repo && type === 'issues' && rest[0]) {
    return { shape: 'issue', owner, repo, num: rest[0] };
  }

  // pull: [owner, repo, 'pull', N]
  if (owner && repo && type === 'pull' && rest[0]) {
    return { shape: 'pull', owner, repo, num: rest[0] };
  }

  // repo-root: exactly [owner, repo]
  if (owner && repo && !type) {
    return { shape: 'repo-root', owner, repo };
  }

  return undefined;
}

function encodeSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return encodeURIComponent(decoded);
}

function fail(url: string, message: string, failure?: FailureInfo): WebFetchResponse {
  return {
    status: 'error',
    url,
    metadata: { method: 'github', cacheHit: false },
    error: { code: 'GITHUB_FETCH_FAILED', message, ...(failure ? { failure } : {}) }
  };
}

function okResponse(url: string, title: string, text: string, partialComments = false): WebFetchResponse {
  const capped = text.slice(0, READER_TEXT_CAP);
  return {
    status: 'ok',
    url,
    content: { title, text: capped },
    metadata: { method: 'github', cacheHit: false, truncated: text.length >= READER_TEXT_CAP, ...(partialComments ? { partialComments: true } : {}) }
  };
}

class GithubHttpError extends Error {
  constructor(readonly status: number, readonly retryAfterMs?: number, readonly rateLimited = false) { super(`GitHub returned ${status}`); }
}

function allowedAuthTarget(target: string): boolean {
  try {
    const parsed = new URL(target);
    return parsed.protocol === 'https:' && (parsed.hostname === 'api.github.com' || parsed.hostname === 'raw.githubusercontent.com');
  } catch { return false; }
}

function nextCommentPage(link: string | null, prefix: string): { next?: string; rejected: boolean } {
  const match = link?.split(',').map((part) => part.trim()).find((part) => /rel="?next"?/i.test(part))?.match(/<([^>]+)>/)?.[1];
  if (!match) return { rejected: false };
  try {
    const parsed = new URL(match);
    const expected = new URL(prefix);
    return parsed.protocol === 'https:' && parsed.hostname === 'api.github.com' && parsed.pathname === expected.pathname
      ? { next: parsed.href, rejected: false }
      : { rejected: true };
  } catch { return { rejected: true }; }
}

export function createGithubReader({ fetchImpl = fetch, resolveToken = () => resolveGithubToken(), now = Date.now, timeoutMs = PAGE_FETCH_TIMEOUT_MS }: GithubReaderDeps = {}): SpecialContentReader {
  let cachedToken: { value: GithubToken; expiresAt: number } | undefined;
  let tokenLookup: Promise<GithubToken> | undefined;

  async function token(): Promise<GithubToken> {
    if (cachedToken && cachedToken.expiresAt > now()) return cachedToken.value;
    if (!tokenLookup) tokenLookup = resolveToken().then((value) => {
      if (value.source !== 'none') cachedToken = { value, expiresAt: now() + TOKEN_CACHE_MS };
      return value;
    }).finally(() => { tokenLookup = undefined; });
    return tokenLookup;
  }

  function headers(json: boolean, credential: GithubToken, target: string): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'pi-web-agent' };
    if (json) h.Accept = 'application/vnd.github+json';
    if (credential.token && allowedAuthTarget(target)) h.Authorization = `Bearer ${credential.token}`;
    return h;
  }

  async function getText(target: string, signal: AbortSignal, credential: GithubToken): Promise<string> {
    const res = await fetchImpl(target, { headers: headers(false, credential, target), signal });
    if (!res.ok) throw new GithubHttpError(res.status, parseRetryAfter(res.headers.get('retry-after'), now()), res.headers.get('x-ratelimit-remaining') === '0');
    return res.text();
  }

  async function getJson<T>(target: string, signal: AbortSignal, credential: GithubToken): Promise<{ data: T; link: string | null }> {
    const res = await fetchImpl(target, { headers: headers(true, credential, target), signal });
    if (!res.ok) throw new GithubHttpError(res.status, parseRetryAfter(res.headers.get('retry-after'), now()), res.headers.get('x-ratelimit-remaining') === '0');
    return { data: await res.json() as T, link: res.headers.get('link') };
  }

  async function readBlob(url: string, owner: string, repo: string, ref: string, path: string, signal: AbortSignal, credential: GithubToken): Promise<WebFetchResponse> {
    const encodedPath = path.split('/').map(encodeSegment).join('/');
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeSegment(ref)}/${encodedPath}`;
    const text = await getText(raw, signal, credential);
    return okResponse(url, `${owner}/${repo}/${path}`, text);
  }

  async function readThread(url: string, owner: string, repo: string, kind: 'issues' | 'pulls', num: string, signal: AbortSignal, callerSignal: AbortSignal | undefined, credential: GithubToken): Promise<WebFetchResponse> {
    const base = `https://api.github.com/repos/${owner}/${repo}/${kind}/${num}`;
    const item = (await getJson<{ title?: string; body?: string }>(base, signal, credential)).data;
    const commentsPrefix = `${base}/comments`;
    let target = `${commentsPrefix}?per_page=100`;
    const comments: string[] = [];
    let partial = false;
    for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
      try {
        const response = await getJson<Array<{ body?: string }>>(target, signal, credential);
        comments.push(...response.data.map((comment) => comment.body ?? '').filter(Boolean));
        const { next, rejected } = nextCommentPage(response.link, commentsPrefix);
        if (rejected) { partial = true; break; }
        if (!next) break;
        if (page === MAX_COMMENT_PAGES - 1) { partial = true; break; }
        target = next;
      } catch (error) {
        if (callerSignal?.aborted) throw error;
        partial = true;
        break;
      }
    }
    const label = kind === 'pulls' && comments.length ? 'Review comments:\n' : '';
    const bodyParts = [item.body ?? '', label + comments.join('\n\n---\n\n')].filter(Boolean);
    const body = bodyParts.join('\n\n---\n\n');
    return okResponse(url, item.title ?? `${owner}/${repo} ${kind} #${num}`, body, partial || (comments.length > 0 && body.length >= READER_TEXT_CAP));
  }

  async function readRepoRoot(url: string, owner: string, repo: string, signal: AbortSignal, credential: GithubToken): Promise<WebFetchResponse> {
    const readmeMeta = (await getJson<{ download_url?: string }>(`https://api.github.com/repos/${owner}/${repo}/readme`, signal, credential)).data;
    const readme = readmeMeta.download_url ? await getText(readmeMeta.download_url, signal, credential) : '';
    const tree = (await getJson<Array<{ name: string; type: string }>>(`https://api.github.com/repos/${owner}/${repo}/contents`, signal, credential)).data;
    const listing = tree.map((entry) => `${entry.type === 'dir' ? '[dir] ' : ''}${entry.name}`).join('\n');
    return okResponse(url, `${owner}/${repo}`, `${readme}\n\nTop-level contents:\n${listing}`);
  }

  return {
    name: 'github',
    canHandle(url: string): boolean {
      return classifyGithubShape(url) !== undefined;
    },
    async read(url: string, signal?: AbortSignal): Promise<WebFetchResponse> {
      const requestedUrl = safeRequestedUrl(url);
      const shape = classifyGithubShape(url);
      if (!shape) return fail(requestedUrl, 'Unsupported GitHub URL shape for the reader.');
      // One budget for the whole read: a thread is two API calls.
      const readSignal = requestSignal(signal, timeoutMs);
      let credential: GithubToken = { source: 'none' };

      try {
        credential = signal ? await raceAbort(token(), signal) : await token();
        switch (shape.shape) {
          case 'blob':
            return await readBlob(requestedUrl, shape.owner, shape.repo, shape.ref!, shape.path!, readSignal, credential);
          case 'issue':
            return await readThread(requestedUrl, shape.owner, shape.repo, 'issues', shape.num!, readSignal, signal, credential);
          case 'pull':
            return await readThread(requestedUrl, shape.owner, shape.repo, 'pulls', shape.num!, readSignal, signal, credential);
          case 'repo-root':
            return await readRepoRoot(requestedUrl, shape.owner, shape.repo, readSignal, credential);
        }
      } catch (err) {
        if (signal?.aborted) throw abortError();
        if (err instanceof GithubHttpError) {
          const rateLimited = err.status === 429 || (err.status === 403 && (err.retryAfterMs !== undefined || err.rateLimited));
          const failure = { kind: rateLimited ? 'rate_limited' : err.status === 404 ? 'not_found_or_inaccessible' : (err.status === 401 || err.status === 403) ? 'auth_failed' : err.status === 503 ? 'transient' : 'bad_response', httpStatus: err.status, ...(err.retryAfterMs !== undefined ? { providerRetryAfterMs: err.retryAfterMs } : {}) } as const;
          const message = err.status === 404
            ? credential.source === 'none' ? `GitHub resource was not found or may require access; sign in to GitHub and retry: ${requestedUrl}` : `GitHub resource was not found or your credential lacks access: ${requestedUrl}`
            : `GitHub returned HTTP ${err.status} for ${requestedUrl}`;
          return fail(requestedUrl, message, failure);
        }
        const transient = err instanceof TypeError || (err instanceof Error && /timeout|timed out/i.test(err.message));
        return fail(requestedUrl, transient ? `GitHub request failed transiently for ${requestedUrl}` : 'GitHub read failed.', transient ? { kind: 'transient' } : undefined);
      }
    }
  };
}
