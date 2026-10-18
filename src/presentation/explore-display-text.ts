const HEADING_QUERY_LIMIT = 96;

/** Removes terminal control sequences while preserving ordinary presentation newlines and tabs. */
export function sanitizeTerminalText(text: string): string {
  return text
    .replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c)/gu, '')
    .replace(/(?:\x1b\]|\x9d)[\s\S]*$/gu, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}

/** Clips sanitized terminal text without splitting a Unicode code point. */
export function clipTerminalText(value: string, maxVisibleChars: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxVisibleChars) return value;
  if (maxVisibleChars <= 0) return '';
  if (maxVisibleChars === 1) return '…';
  return `${characters.slice(0, maxVisibleChars - 1).join('')}…`;
}

/** Removes credentials, protocol, and volatile URL parts before terminal display. */
export function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(sanitizeTerminalText(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[link]';
    return `${url.host}${url.pathname}`;
  } catch {
    return '[link]';
  }
}

function redactUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s]+/giu, (url) => safeDisplayUrl(url));
}

export function displayExploreQuery(query: unknown): string | undefined {
  if (typeof query !== 'string') return undefined;
  const sanitized = sanitizeTerminalText(query).replace(/\s+/gu, ' ').trim();
  return sanitized ? redactUrls(sanitized) : undefined;
}

/** Produces the readable, terminal-safe query shown in a call heading. */
export function safeDisplayQuery(query: unknown, maxVisibleChars = HEADING_QUERY_LIMIT): string | undefined {
  const display = displayExploreQuery(query);
  return display ? clipTerminalText(display, maxVisibleChars) : undefined;
}
