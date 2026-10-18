import { Text } from '@earendil-works/pi-tui';

const HEADING_QUERY_LIMIT = 96;

function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Clips sanitized terminal text without splitting a Unicode code point. */
export function clipTerminalText(value: string, maxVisibleChars: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxVisibleChars) return value;
  if (maxVisibleChars <= 0) return '';
  if (maxVisibleChars === 1) return '…';
  return `${characters.slice(0, maxVisibleChars - 1).join('')}…`;
}

/** Removes credentials and volatile URL parts before showing a query in the terminal. */
export function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[link]';
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[link]';
  }
}

/** Produces the readable, terminal-safe query shown in a call heading. */
export function safeDisplayQuery(query: unknown, maxVisibleChars = HEADING_QUERY_LIMIT): string | undefined {
  if (typeof query !== 'string') return undefined;
  const sanitized = sanitizeTerminalText(query);
  if (!sanitized) return undefined;
  const display = /^https?:/iu.test(sanitized) ? safeDisplayUrl(sanitized) : sanitized;
  return clipTerminalText(display, maxVisibleChars);
}

export function formatExploreCall(query: unknown, argsComplete: boolean): string {
  const display = argsComplete ? safeDisplayQuery(query) : undefined;
  return display ? `web_explore (${JSON.stringify(display)})` : 'web_explore (…)';
}

type ExploreCallTheme = {
  fg(color: 'toolTitle' | 'muted', text: string): string;
};

/** Pi and HTML export use this renderer while the tool call is being streamed. */
export function renderExploreCall(query: unknown, argsComplete: boolean, theme: ExploreCallTheme): Text {
  const heading = formatExploreCall(query, argsComplete);
  const suffix = heading.slice('web_explore'.length);
  return new Text(theme.fg('toolTitle', 'web_explore') + theme.fg('muted', suffix), 0, 0);
}
