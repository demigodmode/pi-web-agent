import { Text } from '@earendil-works/pi-tui';
import { displayExploreQuery } from './explore-display-text.js';
export { clipTerminalText, safeDisplayQuery, safeDisplayUrl } from './explore-display-text.js';

const HEADING_QUERY_LIMIT = 96;

function quoteAndClip(value: string, maxVisibleChars: number): string {
  const quoted = JSON.stringify(value);
  if (Array.from(quoted).length <= maxVisibleChars) return quoted;

  let prefix = '';
  for (const character of Array.from(value)) {
    const candidate = JSON.stringify(`${prefix}${character}…`);
    if (Array.from(candidate).length > maxVisibleChars) break;
    prefix += character;
  }
  return JSON.stringify(`${prefix}…`);
}

export function formatExploreCall(query: unknown, argsComplete: boolean): string {
  const display = argsComplete ? displayExploreQuery(query) : undefined;
  return display ? `web_explore (${quoteAndClip(display, HEADING_QUERY_LIMIT)})` : 'web_explore (…)';
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
