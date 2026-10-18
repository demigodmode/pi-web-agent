const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_name',
  'fbclid',
  'gclid'
]);

/** Canonical form for dedupe/comparison. Returns undefined for non-http(s) or unparseable input. */
export function canonicalizeUrl(raw: string, options: { canonicalizeHost?: boolean } = {}): string | undefined {
  const { canonicalizeHost = true } = options;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  if (canonicalizeHost) {
    url.hostname = url.hostname.replace(/^www\./, '');
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export { TRACKING_PARAMS };

const SENSITIVE_NAME = /(?:^|[_-])(?:token|key|apikey|secret|sig|signature|password|passwd|pwd|auth|authorization|credential|credentials|session|session_?id)$/i;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const USERINFO_IN_TEXT = /((?:[a-z][a-z0-9+.-]*:\/\/)?)[^\s/?#@]+:[^\s/?#@]+@/gi;

function paramName(part: string) {
  const eq = part.indexOf('=');
  return eq === -1 ? part : part.slice(0, eq);
}

// Decodes percent-escapes and splits camelCase so accessToken and %74oken match the segment rule.
function isSensitiveName(name: string) {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    decoded = name;
  }
  return SENSITIVE_NAME.test(decoded.replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
}

/** Display-only: strips userinfo and secret-looking query values. Fetch with the raw URL. */
export function redactUrlForDisplay(raw: string): string {
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return raw.replace(USERINFO_IN_TEXT, '$1');
  const queryParts = url.search.length > 1 ? url.search.slice(1).split('&') : [];
  const hashParts = url.hash.length > 1 ? url.hash.slice(1).split('&') : [];
  const hasSensitiveQuery = queryParts.some((part) => isSensitiveName(paramName(part)));
  const hasSensitiveHash = hashParts.some((part) => part.includes('=') && isSensitiveName(paramName(part)));
  if (!url.username && !url.password && !hasSensitiveQuery && !hasSensitiveHash) return raw;

  url.username = '';
  url.password = '';
  if (hasSensitiveQuery) {
    url.search = queryParts.map((part) => (isSensitiveName(paramName(part)) ? `${paramName(part)}=REDACTED` : part)).join('&');
  }
  if (hasSensitiveHash) url.hash = '';
  return url.toString();
}

/** Applies redactUrlForDisplay to every http(s) URL inside free text. */
export function redactUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (match) => redactUrlForDisplay(match));
}
