import { describe, expect, test } from 'vitest';
import { detectInputSecret, type SecretKind } from '../../src/safety/secrets.js';

const alphabet = distinct(240, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
const urlAlphabet = distinct(240, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-');
const openaiMarker = 'T3BlbkFJ';

function token(prefix: string, body: string, length: number): string {
  return prefix + body.slice(0, length);
}

function digits(length: number): string {
  return '1'.repeat(length);
}

function distinct(length: number, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'): string {
  let value = '';
  for (let index = 0; index < length; index++) {
    value += alphabet[(index * index + index * 11 + 17) % alphabet.length];
  }
  return value;
}

function isDetected(value: string): boolean {
  return detectInputSecret(value) !== undefined;
}

function openaiLegacy(): string {
  return 'sk-' + distinct(20, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') + openaiMarker + distinct(20, 'abcdefghijklmnopqrstuvwxyz0123456789');
}

function openaiProject(segmentLength: number): string {
  return 'sk-proj-' + distinct(segmentLength, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-') + openaiMarker + distinct(segmentLength, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-');
}

function anthropic(bodyLength = 93): string {
  return 'sk-ant-api03-' + token('', urlAlphabet, bodyLength) + 'AA';
}

function anthropicAdmin(bodyLength = 93): string {
  return 'sk-ant-admin01-' + token('', urlAlphabet, bodyLength) + 'AA';
}

function slackBot(): string {
  return `xoxb-${digits(12)}-${digits(12)}-${token('', alphabet, 24)}`;
}

function slackUser(): string {
  return `xoxp-${digits(12)}-${digits(12)}-${digits(12)}-${token('', alphabet, 32)}`;
}

function slackLegacy(kind: 'a' | 'r', bodyLength = 8): string {
  return `xox${kind}-1-${token('', alphabet, bodyLength)}`;
}

function slackService(bodyLength = 32): string {
  return `xoxs-${digits(12)}-${digits(12)}-${digits(12)}-${distinct(bodyLength, 'ABCDEF0123456789')}`;
}

describe('detectInputSecret', () => {
  test('detects supported provider token families', () => {
    const fixtures: Array<[SecretKind, string]> = [
      ['github', token('ghp_', alphabet, 36)],
      ['github', token('gho_', alphabet, 36)],
      ['github', token('ghu_', alphabet, 36)],
      ['github', token('ghs_', alphabet, 36)],
      ['github', token('ghr_', alphabet, 36)],
      ['github', token('ghr_', alphabet, 76)],
      ['github', token('github_pat_', distinct(82, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_'), 82)],
      ['openai', openaiLegacy()],
      ['openai', openaiProject(58)],
      ['openai', openaiProject(74)],
      ['anthropic', anthropic()],
      ['aws', token('AKIA', distinct(16), 16)],
      ['aws', token('ASIA', distinct(16), 16)],
      ['slack', slackBot()],
      ['slack', slackUser()],
      ['slack', slackLegacy('a')],
      ['slack', slackLegacy('r')],
      ['slack', slackService()],
      ['stripe', token('sk_live_', alphabet, 24)],
      ['stripe', token('rk_live_', alphabet, 24)],
      ['stripe', token('sk_live_', alphabet, 99)],
      ['stripe', token('rk_live_', alphabet, 99)],
      ['google', token('AIza', urlAlphabet, 35)],
      ['npm', token('npm_', alphabet, 36)],
    ];

    for (const [kind, value] of fixtures) {
      expect(detectInputSecret(value)).toEqual({ kind });
    }
  });

  test('detects private-key begin markers without requiring key contents', () => {
    for (const marker of [
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      '-----BEGIN DSA PRIVATE KEY-----',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----',
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      expect(detectInputSecret(marker)).toEqual({ kind: 'private-key' });
    }
  });

  test('does not expose matched credential text in its return value', () => {
    const value = token('ghp_', alphabet, 36);
    const serialized = JSON.stringify(detectInputSecret(value));

    expect(serialized.includes(value)).toBe(false);
  });

  test('rejects wrong length and alphabet for bounded token families', () => {
    const nearMisses = [
      'sk-...', 'ghp_xxxx', 'sk-proj-YOUR_KEY',
      token('ghp_', alphabet, 35), token('ghp_', alphabet, 37), token('ghp_', alphabet, 35) + '!',
      token('ghr_', alphabet, 35), token('ghr_', alphabet, 77), token('ghr_', alphabet, 35) + '!',
      token('github_pat_', 'A1_'.repeat(28), 81), token('github_pat_', 'A1_'.repeat(28), 83), token('github_pat_', 'A1_'.repeat(27), 81) + '!',
      openaiLegacy().slice(0, -1), openaiLegacy() + 'A', openaiLegacy().slice(0, -1) + '!',
      'sk-proj-' + distinct(39, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'), 'sk-proj-' + distinct(20, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-') + '!' + distinct(20, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'),
      anthropic(91), anthropic(92), anthropic(94), anthropic().slice(0, -1) + '!',
      token('AKIA', 'A1'.repeat(8), 15), token('AKIA', 'A1'.repeat(9), 17), token('AKIA', 'A1'.repeat(7), 14) + 'a1',
      slackBot().slice(0, -1), slackBot() + 'A', slackBot().slice(0, -1) + '!',
      slackUser().slice(0, -1), slackUser() + 'A', slackUser().slice(0, -1) + '!',
      slackLegacy('a', 7), slackLegacy('a', 49), slackLegacy('a', 7) + '!',
      slackLegacy('r', 7), slackLegacy('r', 49), slackLegacy('r', 7) + '!',
      slackService(31), slackService(33), slackService(31) + '!',
      token('sk_live_', alphabet, 23), token('sk_live_', alphabet, 25), token('sk_live_', alphabet, 23) + '!',
      token('sk_live_', alphabet, 98), token('sk_live_', alphabet, 100), token('sk_live_', alphabet, 98) + '!',
      token('AIza', urlAlphabet, 34), token('AIza', urlAlphabet, 36), token('AIza', urlAlphabet, 34) + '!',
      token('npm_', alphabet, 35), token('npm_', alphabet, 37), token('npm_', alphabet, 35) + '!',
      'GHP_' + token('', alphabet, 36), 'SK-' + token('', alphabet, 48), '-----BEGIN PUBLIC KEY-----',
    ];

    for (const value of nearMisses) {
      expect(isDetected(value), value).toBe(false);
    }
  });

  test('requires complete-token boundaries', () => {
    const value = token('ghp_', alphabet, 36);

    expect(isDetected(`x${value}`)).toBe(false);
    expect(isDetected(`${value}x`)).toBe(false);
  });

  test('detects real-looking plain, quoted, and JSON assignments without returning values', () => {
    const value = 'A1!'.repeat(5);
    for (const query of [`token=${value}`, `password=${value}`, `foo=bar&password=${value}`, `foo=bar;password=${value}`, `clientSecret = '${value}'`, `{"apiKey":"${value}"}`]) {
      const match = detectInputSecret(query);
      expect(match).toEqual({ kind: 'assignment' });
      expect(JSON.stringify(match).includes(value)).toBe(false);
    }
  });

  test('checks every URL component and every link in a whole call', () => {
    const credential = 'ghp_' + distinct(36, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_');
    const encodedCredential = encodeURIComponent(credential);
    const cases = [
      `https://safe.example/guide https://unsafe.example/?value=${encodedCredential}`,
      `https://example.test/?%74oken=${encodeURIComponent('A1$'.repeat(5))}`,
      `https://example.test/?clientSecret=${'A1!'.repeat(5)}`,
      `https://example.test/#password=${'A1!'.repeat(5)}`,
      'https://user:pass@example.test/',
      `https://example.test/?%74oken=${encodeURIComponent('A1$'.repeat(5))}%ZZ`,
      `https://example.test/?value=%67%68%70%5F${distinct(36, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_')}`,
      `https://${credential}.example.test/`,
    ];

    for (const query of cases) expect(detectInputSecret(query)).toBeDefined();
  });

  test('detects case-sensitive provider credentials in the raw authority of a second link', () => {
    const authorities: Array<[SecretKind, string]> = [
      ['aws', `AKIA${distinct(16)}.example.test`],
      ['google', `AIza${urlAlphabet.slice(0, 35)}.example.test`],
      ['openai', `${openaiLegacy()}.example.test`],
      ['anthropic', `${anthropic()}.example.test`]
    ];
    for (const [kind, authority] of authorities) {
      const result = detectInputSecret(`ordinary docs https://safe.example/guide https://${authority}/reference`);
      expect(result?.kind === kind).toBe(true);
      expect(JSON.stringify(result).includes(authority)).toBe(false);
    }
  });

  test('refuses passwords in non-web URI authorities before they can become search text', () => {
    for (const scheme of ['postgresql', 'ftp', 'ssh', 'custom+data']) {
      const match = detectInputSecret(`look up ${scheme}://user:pass@db.example/path`);
      expect(match?.kind === 'url-password').toBe(true);
    }
    expect(detectInputSecret('ssh://git@github.com/repo')).toBeUndefined();
    expect(detectInputSecret('https://example.test:8080/docs/person@work')).toBeUndefined();
  });

  test('allows placeholders, ordinary names, random IDs, and scoped signed-link signatures', () => {
    const s3 = 'https://bucket.s3.amazonaws.com/manual.pdf?' +
      'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=' + 'a'.repeat(64);
    const completeS3 = 'https://bucket.s3.amazonaws.com/manual.pdf?' +
      'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261113T120000Z&X-Amz-Signature=' + 'a'.repeat(64) +
      '&X-Amz-Credential=AKIA' + 'A1'.repeat(8) + '%2F20261113%2Fus-east-1%2Fs3%2Faws4_request';
    const gcs = `https://storage.googleapis.com/bucket/object?X-Goog-Signature=${'a'.repeat(64)}`;
    const azure = `https://blob.core.windows.net/c/o?sv=2026-01-01&sig=${'a'.repeat(64)}`;
    const allowed = [
      'token=xxx', 'api_key=<token>', 'password=YOUR_KEY', 'secret=REPLACE_ME',
      'author=someone&keyword=search&tokenizer=plain&id=7f5d3c1a9b8e6d4c2', s3, completeS3, gcs, azure,
    ];

    for (const query of allowed) expect(detectInputSecret(query)).toBeUndefined();
  });

  test('does not let signed links exempt unrelated credentials', () => {
    const provider = 'ghp_' + distinct(36, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_');
    const signed = `https://bucket.s3.amazonaws.com/manual.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${provider}`;
    expect(detectInputSecret(signed)).toEqual({ kind: 'github' });
    const allowedSignature = `https://bucket.s3.amazonaws.com/manual.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${'a'.repeat(64)}`;
    expect(detectInputSecret(`${allowedSignature} https://other.example/?value=${encodeURIComponent(provider)}`))
      .toEqual({ kind: 'github' });
    expect(detectInputSecret(`https://bucket.s3.amazonaws.com/a?X-Amz-Signature=${'a'.repeat(64)} https://u:p@example.test/`))
      .toEqual({ kind: 'url-password' });
  });

  test('only exempts the validated S3 credential occurrence', () => {
    const accessKey = 'AKIA' + distinct(16);
    const valid = `X-Amz-Credential=${accessKey}%2F20261113%2Fus-east-1%2Fs3%2Faws4_request`;
    const duplicate = 'X-Amz-Credential=syntheticMixedValue123!';
    const signed = `https://bucket.s3.amazonaws.com/manual.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${'a'.repeat(64)}&${valid}`;

    expect(detectInputSecret(signed)).toBeUndefined();
    expect(detectInputSecret(`${signed}&${duplicate}`)).toEqual({ kind: 'aws' });
  });

  test('allows documented and clearly framed provider placeholders without hiding a real match', () => {
    const exampleAws = 'AKIAIOSFODNN7EXAMPLE';
    const repeatedGithub = 'ghp_' + 'x'.repeat(36);
    const repeatedRunGithub = 'ghp_' + 'Ab1'.repeat(12);
    const realGithub = 'ghp_' + distinct(36, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_');
    const exampleSecret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

    for (const value of [exampleAws, repeatedGithub, repeatedRunGithub, exampleSecret, 'api_key=YOUR_KEY', 'token=test_token']) {
      expect(detectInputSecret(value)).toBeUndefined();
    }
    expect(detectInputSecret(`${repeatedGithub} ${realGithub}`)).toEqual({ kind: 'github' });
    expect(detectInputSecret(`${realGithub} ${repeatedGithub}`)).toEqual({ kind: 'github' });
    expect(detectInputSecret(`label=contest-${realGithub}`)).toEqual({ kind: 'github' });
  });

  test('does not treat session identifiers as input secrets but retains session tokens', () => {
    const secret = 'A1$'.repeat(5);
    for (const name of ['session', 'session_id', 'sessionId']) {
      expect(detectInputSecret(`https://example.test/?${name}=${secret}&page=2`)).toBeUndefined();
    }
    expect(detectInputSecret(`https://example.test/?session_token=${secret}`)).toEqual({ kind: 'assignment' });
  });

  test.each(['s3-v4', 'gcs-v4', 'gcs-v2', 's3-v2'] as const)('allows a complete scoped %s signed credential occurrence', (variant) => {
    const aws = 'AKIA' + distinct(16);
    const s3V4 = `https://bucket.s3.amazonaws.com/a?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${distinct(64, 'abcdef0123456789')}&X-Amz-Credential=${aws}%2F20261113%2Fus-east-1%2Fs3%2Faws4_request`;
    const gcsV4 = `https://storage.googleapis.com/bucket/a?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=${distinct(64, 'abcdef0123456789')}&X-Goog-Credential=service-account%40example.iam.gserviceaccount.com%2F20261113%2Fauto%2Fstorage%2Fgoog4_request`;
    const gcsV2 = `https://storage.googleapis.com/bucket/a?GoogleAccessId=service-account%40example.iam.gserviceaccount.com&Expires=1794571200&Signature=${distinct(40, 'abcdef0123456789')}`;
    const s3V2 = `https://bucket.s3.amazonaws.com/a?AWSAccessKeyId=${aws}&Expires=1794571200&Signature=${distinct(40, 'abcdef0123456789')}`;

    const urls = { 's3-v4': s3V4, 'gcs-v4': gcsV4, 'gcs-v2': gcsV2, 's3-v2': s3V2 };
    expect(detectInputSecret(urls[variant])).toBeUndefined();
  });

  test('refuses malformed and duplicate signed credential occurrences', () => {
    const aws = 'AKIA' + distinct(16);
    const s3V2 = `https://bucket.s3.amazonaws.com/a?AWSAccessKeyId=${aws}&Expires=1794571200&Signature=${distinct(40, 'abcdef0123456789')}`;
    const gcsV4 = `https://storage.googleapis.com/bucket/a?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=${distinct(64, 'abcdef0123456789')}&X-Goog-Credential=service-account%40example.iam.gserviceaccount.com%2F20261113%2Fauto%2Fstorage%2Fgoog4_request`;
    expect(detectInputSecret(s3V2.replace('&Signature=', '&other='))).toEqual({ kind: 'aws' });
    expect(detectInputSecret(`${s3V2}&AWSAccessKeyId=AKIA${distinct(16, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`)).toEqual({ kind: 'aws' });
    expect(detectInputSecret(`${gcsV4}&value=ghp_${distinct(36, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_')}`)).toEqual({ kind: 'github' });
  });

  test('does not exempt generic signatures, public GCS IDs, or AWS shapes in GCS credentials', () => {
    const mixed = distinct(40, 'abcdef0123456789');
    const aws = `AKIA${distinct(16)}`;
    const scopedGcs = `https://storage.googleapis.com/bucket/a?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=${mixed}&X-Goog-Credential=${aws}%40example.iam.gserviceaccount.com%2F20261113%2Fauto%2Fstorage%2Fgoog4_request`;

    expect(detectInputSecret('https://example.test/?Signature=AbC123xYz987QwErTy456')).toEqual({ kind: 'assignment' });
    expect(detectInputSecret('https://example.test/?GoogleAccessId=publicaccount%40example.com')).toBeUndefined();
    expect(detectInputSecret(scopedGcs)).toEqual({ kind: 'aws' });
  });

  test('detects sensitive values in bare, non-HTTP, path, and wholly encoded URL contexts', () => {
    const value = 'A1!'.repeat(5);
    const cases = [
      `example.com/page?token=${value}`,
      `api.example.com/v1?api_key=${value}`,
      `ftp://example/path?token=${value}`,
      `/token=${value}`,
      `https%3A%2F%2Fx.io%2F%3Ftoken%3D${encodeURIComponent(value)}`,
      `pass=${value}`,
    ];

    for (const query of cases) expect(detectInputSecret(query), query).toEqual({ kind: 'assignment' });
  });

  test('keeps raw URL component boundaries while probing a wholly encoded signed URL', () => {
    const aws = `AKIA${distinct(16)}`;
    const signed = 'https://bucket.s3.amazonaws.com/manual.pdf?' +
      'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=' + distinct(64, 'abcdef0123456789') +
      `&X-Amz-Credential=${aws}%2F20261113%2Fus-east-1%2Fs3%2Faws4_request`;
    const unrelated = `ghp_${distinct(36, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_')}`;

    expect(detectInputSecret('https://example.test/?password=Password%26safe2026')).toEqual({ kind: 'assignment' });
    expect(detectInputSecret(encodeURIComponent(signed))).toBeUndefined();
    expect(detectInputSecret(encodeURIComponent(`${signed}&value=${unrelated}`))).toEqual({ kind: 'github' });
  });

  test('recognizes bounded project and admin provider keys without treating placeholders as real', () => {
    const project = `sk-proj-${distinct(40, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-')}`;
    const admin = anthropicAdmin();

    expect(detectInputSecret(project)).toEqual({ kind: 'openai' });
    expect(detectInputSecret(`${project}!`)).toEqual({ kind: 'openai' });
    expect(detectInputSecret(admin)).toEqual({ kind: 'anthropic' });
    expect(detectInputSecret('sk-proj-' + 'A'.repeat(40))).toBeUndefined();
    expect(detectInputSecret('sk-proj-too-short')).toBeUndefined();
    expect(detectInputSecret(anthropicAdmin().slice(0, -1))).toBeUndefined();
  });

  test('allows documented AWS secret placeholders in assignments without allowing real mixed values', () => {
    expect(detectInputSecret('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBeUndefined();
    expect(detectInputSecret(`AWS_SECRET_ACCESS_KEY=${'A1!'.repeat(5)}`)).toEqual({ kind: 'assignment' });
    expect(detectInputSecret('password=correcthorsebattery')).toBeUndefined();
  });

  test('allows complete GCS V4 RSA regional and HMAC signed credential scopes', () => {
    const signature = distinct(64, 'abcdef0123456789');
    const rsaRegional = `https://storage.googleapis.com/bucket/a?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=${signature}&X-Goog-Credential=service-account%40example.iam.gserviceaccount.com%2F20261113%2Fus-central1%2Fstorage%2Fgoog4_request`;
    const hmac = `https://storage.googleapis.com/bucket/a?X-Goog-Algorithm=GOOG4-HMAC-SHA256&X-Goog-Signature=${signature}&X-Goog-Credential=GOOG${distinct(20, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')}%2F20261113%2Fus%2Fstorage%2Fgoog4_request`;

    expect(detectInputSecret(rsaRegional)).toBeUndefined();
    expect(detectInputSecret(hmac)).toBeUndefined();
  });

  test('allows UUID and hex values on generic key, sig, signature, and auth names', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const hex = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    for (const query of [
      `https://x.io/dl?key=${uuid}`,
      `https://releases.example.com/dl?key=${hex}`,
      'https://docs.example.com/api?signature=5f4dcc3b5aa765d61d8327deb882cf99',
      `https://example.test/?auth=${uuid}&x_auth=${hex}`,
      `https://example.test/?access-key=${hex}`,
      `https://example.test/?sig=${hex}`,
      `key=${uuid}`,
    ]) {
      expect(detectInputSecret(query), query).toBeUndefined();
    }
  });

  test('requires a real signing companion before exempting sig or signature values', () => {
    const hex = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    for (const query of [
      'https://example.test/?sv=1&sig=MyHunter2RealPassw0rd',
      'https://example.test/?X-Amz-Algorithm=x&X-Amz-Signature=MyHunter2RealPassw0rd',
      'https://example.test/?X-Goog-Algorithm=x&X-Goog-Signature=MyHunter2RealPassw0rd',
    ]) {
      expect(detectInputSecret(query), query).toBeDefined();
    }
    expect(detectInputSecret(`https://example.test/?sv=2026-01-01&sig=${hex}`)).toBeUndefined();
    expect(detectInputSecret(`https://example.test/?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${hex}`)).toBeUndefined();
    expect(detectInputSecret(`https://example.test/?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=${hex}`)).toBeUndefined();
  });

  test('still refuses UUID, hex, and mixed values on names that say secret outright', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const hex = '5f4dcc3b5aa765d61d8327deb882cf99';
    for (const query of [
      `https://x.io/dl?token=${uuid}`,
      `https://x.io/dl?api_key=${hex}`,
      `https://x.io/dl?password=${hex}`,
      'https://x.io/dl?key=AbC123xYz987QwErTy456',
    ]) {
      expect(detectInputSecret(query), query).toEqual({ kind: 'assignment' });
    }
  });

  test('exempts sig and X-Amz-Signature only with their companion parameters', () => {
    const secret = 'MyHunter2RealPassw0rd';
    const azureSas = 'https://acct.blob.core.windows.net/c/f?sv=2025-07-05&sr=b&sp=r&sig=kP3q8Zr2LmN5vXc7Yw1bTe0Ud9Hs6JfGiA4oRpQ%3D';

    expect(detectInputSecret(azureSas)).toBeUndefined();
    expect(detectInputSecret(`https://example.com/dl?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${secret}`)).toBeUndefined();
    expect(detectInputSecret(`https://acct.blob.core.windows.net/c/f?sig=${secret}`)).toEqual({ kind: 'assignment' });
    expect(detectInputSecret(`https://example.com/dl?X-Amz-Signature=${secret}`)).toEqual({ kind: 'assignment' });
    expect(detectInputSecret(`https://example.com/dl?X-Amz-Date=20261113T120000Z&X-Amz-Signature=${secret}`)).toEqual({ kind: 'assignment' });
    expect(detectInputSecret(`https://storage.googleapis.com/b/o?X-Goog-Signature=${secret}`)).toEqual({ kind: 'assignment' });
  });
});
