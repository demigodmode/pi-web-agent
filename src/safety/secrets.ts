export type SecretKind =
  | 'github'
  | 'openai'
  | 'anthropic'
  | 'aws'
  | 'slack'
  | 'stripe'
  | 'google'
  | 'npm'
  | 'private-key'
  | 'assignment'
  | 'url-password';

export interface SecretMatch {
  kind: SecretKind;
}

interface SecretPattern {
  kind: SecretKind;
  pattern: RegExp;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const SENSITIVE_NAME = /(?:^|[_-])(?:token|key|apikey|secret|sig|signature|password|passwd|pwd|pass|auth|authorization|credential|credentials)$/i;
const SECRET_NAME = /(?:^|_)(?:token|secret|password|passwd|pwd|pass|api_key|apikey|authorization|credentials?)$/;
const GENERIC_NAME = /(?:^|_)(?:key|sig|signature|auth)$/;
const UUID_OR_HEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]+)$/i;

const secretPatterns: readonly SecretPattern[] = [
  // https://github.blog/changelog/2021-03-04-authentication-token-format-updates/
  { kind: 'github', pattern: /(?<![A-Za-z0-9_])gh[pous]_[A-Za-z0-9_]{36}(?![A-Za-z0-9_])/ },
  { kind: 'github', pattern: /(?<![A-Za-z0-9_])ghr_(?:[A-Za-z0-9_]{36}|[A-Za-z0-9_]{76})(?![A-Za-z0-9_])/ },
  { kind: 'github', pattern: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{82}(?![A-Za-z0-9_])/ },

  // https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
  { kind: 'openai', pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}(?![A-Za-z0-9_-])/ },
  { kind: 'openai', pattern: /(?<![A-Za-z0-9_-])sk-proj-[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/ },
  { kind: 'anthropic', pattern: /(?<![A-Za-z0-9_-])sk-ant-api03-[A-Za-z0-9_-]{93}AA(?![A-Za-z0-9_-])/ },
  { kind: 'anthropic', pattern: /(?<![A-Za-z0-9_-])sk-ant-admin01-[A-Za-z0-9_-]{93}AA(?![A-Za-z0-9_-])/ },
  { kind: 'aws', pattern: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/ },

  // https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml#L2800-L2854
  { kind: 'slack', pattern: /(?<![A-Za-z0-9-])xoxb-[0-9]{12}-[0-9]{12}-[A-Za-z0-9]{24}(?![A-Za-z0-9-])/ },
  { kind: 'slack', pattern: /(?<![A-Za-z0-9-])xoxp-[0-9]{12}-[0-9]{12}-[0-9]{12}-[A-Za-z0-9]{32}(?![A-Za-z0-9-])/ },
  { kind: 'slack', pattern: /(?<![A-Za-z0-9-])xox[ar]-(?:[0-9]-)?[A-Za-z0-9]{8,48}(?![A-Za-z0-9-])/ },
  { kind: 'slack', pattern: /(?<![A-Za-z0-9-])xoxs-[0-9]{12}-[0-9]{12}-[0-9]{12}-[A-Fa-f0-9]{32}(?![A-Za-z0-9-])/ },

  // Gitleaks supports Stripe live keys through 99 characters; retain known 24-char legacy keys.
  { kind: 'stripe', pattern: /(?<![A-Za-z0-9_])(?:sk|rk)_live_(?:[A-Za-z0-9]{24}|[A-Za-z0-9]{99})(?![A-Za-z0-9_])/ },
  { kind: 'google', pattern: /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/ },
  { kind: 'npm', pattern: /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/ },

  // https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns
  { kind: 'private-key', pattern: /-----BEGIN (?:(?:RSA|EC|OPENSSH|DSA|ENCRYPTED) )?PRIVATE KEY-----/ },
];

function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedName(value: string): string {
  return decodeOnce(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase();
}

function isSensitiveName(value: string): boolean {
  return SENSITIVE_NAME.test(normalizedName(value));
}

// Names like key or sig often hold IDs and digests; names that say secret outright do not.
function isGenericSensitiveName(value: string): boolean {
  const name = normalizedName(value);
  return GENERIC_NAME.test(name) && !SECRET_NAME.test(name);
}

function isUuidOrHex(value: string): boolean {
  return UUID_OR_HEX.test(value.trim());
}

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return /^x+$/i.test(trimmed) || /^<[^>]*>$/.test(trimmed) || /^(?:your|replace|example|test)[_-]/i.test(trimmed) ||
    /(?:^|[_/-])example(?:key|token|secret)?$/i.test(trimmed) || /^[*•#-]+$/.test(trimmed);
}

function isDocumentedPlaceholder(value: string): boolean {
  return value.trim() === 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
}

function isRealLookingValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 12 || isPlaceholder(trimmed)) return false;
  let categories = 0;
  if (/[A-Za-z]/.test(trimmed)) categories++;
  if (/[0-9]/.test(trimmed)) categories++;
  if (/[^A-Za-z0-9]/.test(trimmed)) categories++;
  return categories >= 2;
}

function providerSecretBody(kind: SecretKind, match: string): string {
  if (kind === 'aws') return match.slice(4);
  if (kind === 'github') return match.startsWith('github_pat_') ? match.slice('github_pat_'.length) : match.slice(4);
  if (kind === 'npm') return match.slice('npm_'.length);
  if (kind === 'stripe') return match.slice('sk_live_'.length);
  if (kind === 'google') return match.slice(4);
  if (kind === 'openai') return match.slice(match.startsWith('sk-proj-') ? 'sk-proj-'.length : 'sk-'.length);
  if (kind === 'anthropic') return match.slice(match.startsWith('sk-ant-admin01-') ? 'sk-ant-admin01-'.length : 'sk-ant-api03-'.length);
  // Slack IDs are public routing identifiers; only the actual secret segment is relevant.
  if (kind === 'slack') return match.slice(match.lastIndexOf('-') + 1);
  return match;
}

function hasShortRepeatedRun(value: string): boolean {
  for (let unitLength = 1; unitLength <= 4; unitLength++) {
    if (value.length % unitLength !== 0 || value.length === unitLength) continue;
    const unit = value.slice(0, unitLength);
    if (unit.repeat(value.length / unitLength) === value) return true;
  }
  return false;
}

function isProviderPlaceholder(kind: SecretKind, match: string): boolean {
  if (kind === 'private-key') return false;
  const body = providerSecretBody(kind, match);
  return isPlaceholder(match) || isPlaceholder(body) || /example/i.test(match) || hasShortRepeatedRun(body) || /^(?:all[-_]?zero|zero|dummy|sample)$/i.test(body);
}

function findProviderSecret(value: string, skipAws = false): SecretMatch | undefined {
  for (const { kind, pattern } of secretPatterns) {
    if (skipAws && kind === 'aws') continue;
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matches = value.matchAll(new RegExp(pattern.source, flags));
    for (const match of matches) {
      if (!isProviderPlaceholder(kind, match[0])) return { kind };
    }
  }

  return undefined;
}

function splitParam(part: string): [string, string] {
  const index = part.indexOf('=');
  return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
}

function isValidatedS3Credential(name: string, value: string, params: Array<[string, string]>): boolean {
  if (normalizedName(name) !== 'x_amz_credential') return false;
  if (params.filter(([paramName]) => normalizedName(paramName) === 'x_amz_credential').length !== 1) return false;
  const hasAlgorithm = params.some(([paramName, paramValue]) =>
    normalizedName(paramName) === 'x_amz_algorithm' && decodeOnce(paramValue) === 'AWS4-HMAC-SHA256');
  const hasSignature = params.some(([paramName, paramValue]) =>
    normalizedName(paramName) === 'x_amz_signature' && decodeOnce(paramValue).length > 0);
  return hasAlgorithm && hasSignature && /^(?:AKIA|ASIA)[A-Z0-9]{16}\/\d{8}\/[A-Za-z0-9-]+\/s3\/aws4_request$/.test(decodeOnce(value));
}

function hasSignedParams(params: Array<[string, string]>, algorithmName: string, algorithms: readonly string[]): boolean {
  return params.some(([paramName, paramValue]) => normalizedName(paramName) === algorithmName && algorithms.includes(decodeOnce(paramValue))) &&
    params.some(([paramName, paramValue]) => normalizedName(paramName) === 'x_goog_signature' && decodeOnce(paramValue).length > 0);
}

function isValidatedGcsCredential(name: string, value: string, params: Array<[string, string]>): boolean {
  if (normalizedName(name) !== 'x_goog_credential') return false;
  if (params.filter(([paramName]) => normalizedName(paramName) === 'x_goog_credential').length !== 1) return false;
  return hasSignedParams(params, 'x_goog_algorithm', ['GOOG4-RSA-SHA256', 'GOOG4-HMAC-SHA256']) &&
    /^.+\/\d{8}\/[A-Za-z0-9-]+\/storage\/goog4_request$/u.test(decodeOnce(value));
}

function isValidatedV2Credential(name: string, params: Array<[string, string]>): boolean {
  const normalized = normalizedName(name);
  const compact = normalized.replaceAll('_', '');
  if (compact !== 'googleaccessid' && compact !== 'awsaccesskeyid') return false;
  if (params.filter(([paramName]) => normalizedName(paramName).replaceAll('_', '') === compact).length !== 1) return false;
  return params.some(([paramName, paramValue]) => normalizedName(paramName) === 'expires' && decodeOnce(paramValue).length > 0) &&
    params.some(([paramName, paramValue]) => normalizedName(paramName) === 'signature' && decodeOnce(paramValue).length > 0);
}

function isValidatedV2Signature(name: string, params: Array<[string, string]>): boolean {
  return normalizedName(name) === 'signature' && params.some(([paramName]) => isValidatedV2Credential(paramName, params));
}

function hasCompanion(params: Array<[string, string]>, name: string, accepts: (value: string) => boolean): boolean {
  return params.some(([paramName, paramValue]) => normalizedName(paramName) === name && accepts(decodeOnce(paramValue)));
}

function isExemptSignature(name: string, params: Array<[string, string]>): boolean {
  const normalized = normalizedName(name);
  if (normalized === 'sig') return hasCompanion(params, 'sv', (value) => /^\d{4}-\d{2}-\d{2}$/u.test(value));
  if (normalized === 'x_amz_signature') {
    return hasCompanion(params, 'x_amz_algorithm', (value) => value.startsWith('AWS4-')) ||
      params.some(([paramName, paramValue]) => isValidatedS3Credential(paramName, paramValue, params));
  }
  if (normalized === 'x_goog_signature') {
    return hasCompanion(params, 'x_goog_algorithm', (value) => value.startsWith('GOOG4-')) ||
      params.some(([paramName, paramValue]) => isValidatedGcsCredential(paramName, paramValue, params));
  }
  return false;
}

function rawUrlAuthority(rawUrl: string): string | undefined {
  const match = rawUrl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/iu);
  if (!match) return undefined;
  // Preserve authority casing before WHATWG URL normalizes hostnames.
  return match[1].slice(match[1].lastIndexOf('@') + 1);
}

function detectUrlSecret(rawUrl: string): SecretMatch | undefined {
  const authority = rawUrlAuthority(rawUrl);
  const authorityProvider = authority ? findProviderSecret(authority) ?? findProviderSecret(decodeOnce(authority)) : undefined;
  if (authorityProvider) return authorityProvider;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Treat an unparseable URL as text; decoded provider shapes still count.
    return findProviderSecret(rawUrl) ?? findProviderSecret(decodeOnce(rawUrl));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.password) return { kind: 'url-password' };

  const params = url.search.length > 1 ? url.search.slice(1).split('&').map(splitParam) : [];
  const hashParams = url.hash.length > 1 ? url.hash.slice(1).split('&').map(splitParam) : [];
  const components = [url.username, url.hostname, url.pathname, url.hash.slice(1)];
  for (const component of components) {
    const provider = findProviderSecret(component) ?? findProviderSecret(decodeOnce(component));
    if (provider) return provider;
  }

  for (const [rawName, rawValue] of [...params, ...hashParams]) {
    const decodedValue = decodeOnce(rawValue);
    const validatedS3Credential = isValidatedS3Credential(rawName, rawValue, params);
    const validatedGcsCredential = isValidatedGcsCredential(rawName, rawValue, params);
    const validatedV2Credential = isValidatedV2Credential(rawName, params);
    const validatedCredential = validatedS3Credential || validatedGcsCredential || validatedV2Credential;
    const skipAws = validatedS3Credential || (validatedV2Credential && normalizedName(rawName).replaceAll('_', '') === 'awsaccesskeyid');
    const provider = findProviderSecret(rawName) ?? findProviderSecret(rawValue, skipAws) ??
      findProviderSecret(decodeOnce(rawName)) ?? findProviderSecret(decodedValue, skipAws);
    if (provider) return provider;
    const allowedSignature = isExemptSignature(rawName, [...params, ...hashParams]) || isValidatedV2Signature(rawName, params);
    const uuidOrHexValue = isGenericSensitiveName(rawName) && isUuidOrHex(decodedValue);
    if (isSensitiveName(rawName) && !allowedSignature && !validatedCredential && !uuidOrHexValue && isRealLookingValue(decodedValue)) return { kind: 'assignment' };
  }

  return undefined;
}

function detectAssignment(value: string): SecretMatch | undefined {
  const assignment = /(?:^|[\s,{&;?/])(?:["']?)([A-Za-z][A-Za-z0-9_-]*)(?:["']?)\s*[:=](?!\/\/)\s*(?:["'])([^"']*)(?:["'])|(?:^|[\s,{&;?/])(?:["']?)([A-Za-z][A-Za-z0-9_-]*)(?:["']?)\s*[:=](?!\/\/)\s*([^\s,}&;]+)/g;
  for (const match of value.matchAll(assignment)) {
    const name = match[1] ?? match[3];
    const assigned = match[2] ?? match[4] ?? '';
    const decoded = decodeOnce(assigned);
    if (isSensitiveName(name) && !isDocumentedPlaceholder(decoded) && !(isGenericSensitiveName(name) && isUuidOrHex(decoded)) && isRealLookingValue(decoded)) {
      return { kind: 'assignment' };
    }
  }

  return undefined;
}

function detectInputSecretProbe(query: string): SecretMatch | undefined {
  const urls: string[] = [];
  const outsideUrls = query.replace(URL_IN_TEXT, (match) => {
    urls.push(match);
    return ' ';
  });

  const outsideProvider = findProviderSecret(outsideUrls);
  if (outsideProvider) return outsideProvider;
  const assignment = detectAssignment(outsideUrls);
  if (assignment) return assignment;
  for (const url of urls) {
    const match = detectUrlSecret(url);
    if (match) return match;
  }

  // Unsupported fetch schemes can still be sent out as search text.
  if (/[a-z][a-z0-9+.-]*:\/\/[^/\s?#@]*:[^/\s?#@]+@[^/\s?#@]+/iu.test(query)) {
    return { kind: 'url-password' };
  }

  return undefined;
}

export function detectInputSecret(query: string): SecretMatch | undefined {
  // Decode only for inspection. The original query remains the caller's URL and workflow input.
  return detectInputSecretProbe(query) ?? (decodeOnce(query) === query ? undefined : detectInputSecretProbe(decodeOnce(query)));
}
