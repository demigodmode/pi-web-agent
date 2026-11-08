import { redactUrlsInText } from '../orchestration/url.js';
import { clipTerminalText, sanitizeTerminalText } from './explore-display-text.js';

export type ContextMetadata = {
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
  if (limit < 4) return '';
  let prefix = '';
  for (const char of Array.from(value)) {
    if (Array.from(JSON.stringify(`${prefix}${char}…`)).length > limit) break;
    prefix += char;
  }
  return JSON.stringify(`${prefix}…`);
}

function codePoints(value: string) {
  return Array.from(value).length;
}

function contextValues(values: string[] | undefined, count: number, transform = (value: string) => value) {
  return [...new Set((values ?? []).map(clean).map(transform).filter(Boolean))].slice(0, count);
}

function clippedItem(value: string, limit: number, quote: boolean) {
  const itemLimit = Math.min(120, limit);
  if (itemLimit <= 0) return undefined;
  const item = quote ? quoted(value, itemLimit) : clipTerminalText(value, itemLimit);
  return item && item !== '""' ? item : undefined;
}

function boundedLine(label: string, values: string[], budget: number, quote: boolean) {
  const prefix = `${label}: `;
  const separator = quote ? ', ' : '; ';
  if (codePoints(prefix) >= budget || !values.length) return undefined;

  const items: string[] = [];
  let used = codePoints(prefix);
  for (const value of values) {
    const separatorChars = items.length ? codePoints(separator) : 0;
    const item = clippedItem(value, budget - used - separatorChars, quote);
    if (!item) break;
    items.push(item);
    used += separatorChars + codePoints(item);
  }
  return items.length ? `${prefix}${items.join(separator)}` : undefined;
}

function appendQuotedItem(line: string, value: string, budget: number) {
  const separator = ', ';
  const item = clippedItem(value, budget - codePoints(line) - codePoints(separator), true);
  return item ? `${line}${separator}${item}` : line;
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

/** Formats only gaps and suggested follow-up searches for length allocation. */
export function formatPriorityContext(metadata: ContextMetadata | undefined, chars: number): string[] {
  const budget = Number.isFinite(chars) ? Math.max(0, Math.floor(chars)) : 0;
  const gaps = contextValues(metadata?.openGaps, 4, gapPhrase);
  const suggestions = contextValues(metadata?.suggestedQueries, 2);
  const firstSuggestion = suggestions[0]
    ? boundedLine('Try next', [suggestions[0]], budget, true)
    : undefined;
  const gapBudget = budget - (firstSuggestion ? codePoints(firstSuggestion) + 1 : 0);
  const gapLine = boundedLine('Still open', gaps, gapBudget, false);
  const tryLine = firstSuggestion && suggestions[1]
    ? appendQuotedItem(firstSuggestion, suggestions[1], budget - (gapLine ? codePoints(gapLine) + 1 : 0))
    : firstSuggestion;
  if (gapLine && tryLine) return [gapLine, tryLine];
  return gapLine ? [gapLine] : tryLine ? [tryLine] : [];
}

/** Formats only search provenance for allocation after finding deduplication. */
export function formatSearchedContext(metadata: ContextMetadata | undefined, chars: number): string[] {
  const budget = Number.isFinite(chars) ? Math.max(0, Math.floor(chars)) : 0;
  const values = contextValues(metadata?.executedQueries, 6);
  const formatted = boundedLine('Searched', values, budget, true);
  return formatted ? [formatted] : [];
}
