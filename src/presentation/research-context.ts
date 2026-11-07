import { redactUrlsInText } from '../orchestration/url.js';
import { clipTerminalText, sanitizeTerminalText } from './explore-display-text.js';

type ContextMetadata = {
  executedQueries?: string[];
  openGaps?: string[];
  suggestedQueries?: string[];
};

function clean(value: string) {
  return sanitizeTerminalText(redactUrlsInText(value)).replace(/\s+/gu, ' ').trim();
}

function gapPhrase(value: string) {
  const text = value.replace(/^Need comparison evidence for target:\s*/i, 'comparison evidence for ')
    .replace(/^Need\s+/i, '').replace(/\.$/, '');
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function quoted(value: string, limit: number) {
  if (Array.from(JSON.stringify(value)).length <= limit) return JSON.stringify(value);
  let prefix = '';
  for (const char of Array.from(value)) {
    if (Array.from(JSON.stringify(`${prefix}${char}…`)).length > limit) break;
    prefix += char;
  }
  return JSON.stringify(`${prefix}…`);
}

function line(label: string, values: string[] | undefined, count: number, budget: number, quote: boolean) {
  const items = [...new Set((values ?? []).map(clean).filter(Boolean))].slice(0, count);
  if (!items.length) return undefined;
  const prefix = `${label}: `;
  const separator = quote ? ', ' : '; ';
  const itemBudget = Math.min(120, Math.floor(
    (budget - Array.from(prefix).length - separator.length * (items.length - 1)) / items.length
  ));
  return prefix + items.map(item => quote
    ? quoted(item, itemBudget)
    : clipTerminalText(gapPhrase(item), itemBudget)).join(separator);
}

/** Final context facts and rule-based proposals; no model or network calls. */
export function formatResearchContext(metadata?: ContextMetadata): string[] {
  return [
    line('Searched', metadata?.executedQueries, 6, 450, true),
    line('Still open', metadata?.openGaps, 4, 270, false),
    line('Try next', metadata?.suggestedQueries, 2, 278, true)
  ].filter((value): value is string => value !== undefined);
}
