import { posix } from 'node:path';
import { sourceHeadings, sourceParagraphs, type SourceFormat } from './paragraphs.js';
import type { AgentNote } from './types.js';

const RECIPIENT = String.raw`(?:ai(?:\s+(?:assistants?|agents?|models?))?|(?:the\s+)?llms?|claude|chatgpt|(?:ai\s+)?assistant|you\s+are\s+an?\s+ai)`;
export const SEND_VERB = String.raw`(?:send|upload|post|forward|email)`;
const FILLER = String.raw`(?:(?:also|now|first|go\s+ahead\s+and)\s+)*`;
const ROLE_LABEL = String.raw`(?:<\s*(?:system|assistant|user|developer)[^>]*>|\[\s*(?:inst|system|assistant|user)\s*\])`;
const ADDRESS = new RegExp(String.raw`(?:\b(?:hi|dear|hey)\s+${RECIPIENT}(?:\s+reading\s+this)?\b|\bnote\s+to\s+(?:the\s+)?${RECIPIENT}\s*:|\b${RECIPIENT}\s*(?::|,)|${ROLE_LABEL})`, 'giu');
const EXPLICIT_LABEL = /\bAGENT\s+INSTRUCTION\s*:/gu;
const CLAUDE_MENTION = /(?<![\p{L}\p{N}_@])@claude\b/giu;
const MODAL_ADDRESS = new RegExp(String.raw`\b${RECIPIENT}\s+(?:should|must|needs?\s+to)\b`, 'giu');
const MODAL = /\b(?:should|must|needs?\s+to)\b/iu;
const EXECUTION = /\b(?:run|execute)\b\s+(?:[`]|<code>)?\s*(?:(?:this|the\s+following)\s+(?:command|script)|(?:curl|wget|sh|bash|shell|command|script)\b|[^\n]{0,60}\|)/iu;
const INSTALL = /\binstall\b(?:\s+(?:this|the|a|an))?\s+(?:package|dependency|module|plugin)\b/iu;
const EGRESS = new RegExp(String.raw`(?:^\s*|[,:;]\s*|\bthen\s+|\band\s+)(?:please\s+)?${FILLER}(?:\b${SEND_VERB}\b\s+\S|\binclude\b[\s\S]{1,100}?\s+\b(?:in|into)\b\s+(?:(?:a|the)\s+)?(?:(?:request\s+)?url|request)\b)|(?:^\s*|[,:;]\s*|\bthen\s+)please\s+${SEND_VERB}\b\s*$`, 'iu');
// A send verb with a lead-in ("now email", "and send") needs an object after it, so a plain sentence is not a request.
const SEND_OBJECT = new RegExp(String.raw`^${SEND_VERB}\b\s+(?:(?:the|a|an|this|that|these|those|my|your|its|their|our|all|any|some|each|every|it|them|everything|me|us|his|her)\b|[~./\\]|[^\s,.;:!?]+(?:\s+[^\s,.;:!?]+){0,3}\s+to\b)`, 'iu');
const SECRET_VERB = String.raw`(?:read|output|disclose|reveal|print)`;
const SECRETS = new RegExp(String.raw`\b${SECRET_VERB}\b[\s\S]{0,100}\b(?:secrets?|tokens?|keys?|credentials?|environment\s+variables?|env(?:ironment)?\s+files?)\b|\b${SECRET_VERB}\b[\s\S]{0,100}(?:\.env\b|~\/\.ssh\b)`, 'iu');
const CHANGE_FILES = /\b(?:change|delete|overwrite)\b[\s\S]{0,80}\b(?:files?|config(?:uration)?)\b/iu;
const HIDE = /\b(?:conceal|hide|withhold|keep)\b[\s\S]{0,100}\bfrom\s+(?:the\s+)?user\b|\b(?:don['’]?t|do\s+not)\s+(?:tell|mention)\b[\s\S]{0,100}\b(?:the\s+)?user\b/iu;
const OVERRIDE = /\b(?:ignore|disregard|forget|override)\b[\s\S]{0,100}\b(?:(?:previous|prior|above|system)\s+instructions?|system\s+prompt)\b/iu;
const STANDALONE_OVERRIDE = /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/iu;
// "Ignore previous instructions in the v1 config" scopes the phrase to a document or version, unless a risky ask follows.
const SCOPED_OVERRIDE = /^\s+(?:in|for|from|of|about)\b/iu;

/** Sharp asks that keep a heuristic-kept hidden panel from being revealed. Plain sources so the browser pruner can use them. */
export const SHARP_ASK_PATTERNS = [EGRESS, SECRETS, HIDE, OVERRIDE].map((regexp) => ({ source: regexp.source, flags: regexp.flags }));

const INTENTIONAL_FILES = new Set([
  'llms.txt',
  'llms-full.txt',
  'agents.md',
  'claude.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
]);

function normalizedPath(path: string): string {
  return posix.normalize(path.replace(/\\/gu, '/')).replace(/^\.\//u, '').replace(/^\/+|\/+$/gu, '');
}

function isIntentionalPath(path: string, allowSuffix: boolean): boolean {
  const normalized = normalizedPath(path).toLowerCase();
  if (INTENTIONAL_FILES.has(normalized)) return true;
  if (!allowSuffix) return false;
  return [...INTENTIONAL_FILES].some((file) => normalized.endsWith(`/${file}`));
}

function isQuotedAt(text: string, offset: number): boolean {
  let quote: '"' | "'" | '“' | '‘' | undefined;
  for (let index = 0; index < offset; index += 1) {
    const char = text[index];
    if ((char === "'" || char === '’') && /[\p{L}\p{N}]/u.test(text[index - 1] ?? '') && /[\p{L}\p{N}]/u.test(text[index + 1] ?? '')) continue;
    if (char === '”' && quote === '“') quote = undefined;
    else if (char === '’' && quote === '‘') quote = undefined;
    else if ((char === '"' || char === "'") && text[index - 1] !== '\\') quote = quote === char ? undefined : (quote ?? char);
    else if (char === '“' || char === '‘') quote ??= char;
  }
  return quote !== undefined;
}

function isInlineCodeAt(text: string, offset: number): boolean {
  let open = false;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '`' && text[index - 1] !== '\\') open = !open;
  }
  return open;
}

type Sentence = { text: string; start: number; end: number };

function sentences(text: string): Sentence[] {
  const parts: Sentence[] = [];
  const pattern = /[\s\S]*?[.!?]+(?=\s|$)|[\s\S]+$/gu;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const leading = match[0].match(/^\s*/u)?.[0].length ?? 0;
    const value = match[0].trim();
    if (value) parts.push({ text: value, start: match.index + leading, end: match.index + leading + value.length });
  }
  return parts;
}

type Address = { start: number; end: number; modal: boolean };
type RiskyAsk = 'execution' | 'install' | 'egress' | 'secrets' | 'change-files' | 'hide' | 'override';

function unquotedAddresses(text: string): Address[] {
  const addresses: Address[] = [];
  for (const regexp of [EXPLICIT_LABEL, ADDRESS, MODAL_ADDRESS, CLAUDE_MENTION]) {
    for (const match of text.matchAll(new RegExp(regexp.source, regexp.flags))) {
      if (match.index === undefined || isQuotedAt(text, match.index) || isInlineCodeAt(text, match.index)) continue;
      addresses.push({ start: match.index, end: match.index + match[0].length, modal: regexp === MODAL_ADDRESS });
    }
  }
  return addresses.sort((left, right) => left.end - right.end);
}

function hasLeadingOverride(text: string): boolean {
  const match = text.match(STANDALONE_OVERRIDE);
  if (!match || match.index === undefined || isQuotedAt(text, match.index)) return false;
  const rest = text.slice(match.index + match[0].length);
  if (SCOPED_OVERRIDE.test(rest) && riskyAgentAsks(rest).length === 0) return false;
  return /^\s*(?:(?:important|note)\s*:\s*)?$/iu.test(text.slice(0, match.index));
}

/** Shared risky-ask classification for source detection and future span extraction. */
export function classifyRiskyAgentAsk(text: string): RiskyAsk | undefined {
  return riskyAgentAsks(text)[0]?.kind;
}

function isLeadInWithoutObject(text: string, verbIndex: number, lead: string): boolean {
  const leadIn = lead.replace(/^[\s,:;]*/u, '').replace(/^please\s+/iu, '');
  if (!leadIn || !/^(?:also|now|first|and|then|go\s+ahead\s+and)\b/iu.test(leadIn)) return false;
  const verb = text.slice(verbIndex);
  return new RegExp(String.raw`^${SEND_VERB}\b`, 'iu').test(verb) && !SEND_OBJECT.test(verb);
}

function riskyAgentAsks(text: string): Array<{ kind: RiskyAsk; index: number }> {
  const patterns: Array<[RiskyAsk, RegExp]> = [
    ['execution', EXECUTION], ['install', INSTALL], ['egress', EGRESS], ['secrets', SECRETS],
    ['change-files', CHANGE_FILES], ['hide', HIDE], ['override', OVERRIDE],
  ];
  const matches = patterns.flatMap(([kind, regexp]) => {
    const flags = regexp.flags.includes('g') ? regexp.flags : `${regexp.flags}g`;
    return [...text.matchAll(new RegExp(regexp.source, flags))].flatMap((match) => {
      if (match.index === undefined) return [];
      const egressOffset = kind === 'egress' ? match[0].search(new RegExp(String.raw`\b(?:${SEND_VERB}|include)\b`, 'iu')) : 0;
      if (kind === 'egress' && isLeadInWithoutObject(text, match.index + egressOffset, match[0].slice(0, egressOffset))) return [];
      return [{ kind: kind as RiskyAsk, index: match.index + egressOffset }];
    });
  });
  return matches.sort((left, right) => left.index - right.index);
}

/** Extracts the concrete risky clause from an already-qualified source span. */
export function extractRiskyAgentAskClauses(text: string): string[] {
  const clauses: string[] = [];
  for (const sentence of sentences(text)) {
    for (const ask of riskyAgentAsks(sentence.text)) {
      if (isQuotedAt(sentence.text, ask.index)) continue;
      const before = sentence.text.slice(0, ask.index);
      const polite = before.match(/please\s+$/iu)?.[0];
      const start = polite ? ask.index - polite.length : ask.index;
      const clause = sentence.text.slice(start).trim();
      if (clause && !clauses.includes(clause)) clauses.push(clause);
    }
  }
  return clauses;
}

export function isRiskyAgentAsk(text: string, { allowModal = true }: { allowModal?: boolean } = {}): boolean {
  const kind = classifyRiskyAgentAsk(text);
  if (!kind) return false;
  return allowModal || ['egress', 'secrets', 'hide', 'override'].includes(kind);
}

/** Returns true only for a bounded direct request aimed at an AI-like recipient. */
export function isAgentDirectedParagraph(text: string): boolean {
  return extractAgentDirectedRequestSpans(text).length > 0;
}

/** Finds all direct requests that can later be matched without retaining source offsets. */
export function extractAgentDirectedRequestSpans(text: string, { heading = false }: { heading?: boolean } = {}): string[] {
  // A bare override is a common article title, so headings only count with a direct address.
  if (!heading && hasLeadingOverride(text)) {
    const first = sentences(text)[0]?.text;
    return first ? [first] : [];
  }
  const parts = sentences(text);
  const spans: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const current = parts[index]!;
    const addresses = unquotedAddresses(current.text).map((address) => ({ address, previous: false, prior: current }));
    if (index > 0) for (const address of unquotedAddresses(parts[index - 1]!.text)) addresses.push({ address, previous: true, prior: parts[index - 1]! });
    for (const { address, previous, prior } of addresses) {
      if (!previous && address.modal && /\b(?:article|report|documentation)\s+(?:says|said|explains|describes)\s*$/iu.test(current.text.slice(0, address.start))) continue;
      const candidate = previous ? current.text : current.text.slice(address.end);
      for (const ask of riskyAgentAsks(candidate)) {
        if (isQuotedAt(candidate, ask.index)) continue;
        const modal = address.modal || MODAL.test(candidate);
        if (modal && /\bonly\s+when\s+the\s+user\s+(?:explicitly\s+)?(?:asks?|requests?|authori[sz]es)\b/iu.test(candidate)) continue;
        if (modal && !['egress', 'secrets', 'hide', 'override'].includes(ask.kind)) continue;
        if (modal && ask.kind === 'egress' && !/(?:\.env\b|\b(?:secrets?|tokens?|keys?|credentials?|environment\s+variables?|data|files?)\b)/iu.test(candidate)) continue;
        const span = previous ? `${prior.text} ${current.text}` : current.text.slice(address.start);
        if (!spans.includes(span)) spans.push(span);
      }
    }
  }
  return spans.filter((span) => !spans.some((other) => other !== span && other.includes(span)));
}

/** Finds eligible direct requests without modifying the original source bytes. */
export function detectAgentDirectedParagraphs(source: string, format: SourceFormat): string[] {
  const paragraphs = sourceParagraphs(source, format).flatMap((paragraph) => extractAgentDirectedRequestSpans(paragraph));
  const headings = sourceHeadings(source, format).flatMap((heading) => extractAgentDirectedRequestSpans(heading, { heading: true }));
  return [...new Set([...paragraphs, ...headings])];
}

/** Identifies a small, fixed set of files written specifically for agents. */
export function agentFileNote(pathOrUrl: string, author: AgentNote): AgentNote | undefined {
  try {
    const url = new URL(pathOrUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return isIntentionalPath(decodeURIComponent(url.pathname), true) ? author : undefined;
  } catch {
    return isIntentionalPath(pathOrUrl, true) ? author : undefined;
  }
}

/** Final web URLs name site-authored files, except raw GitHub repository files. */
export function finalUrlAgentFileNote(url: string): AgentNote | undefined {
  try {
    const parsed = new URL(url);
    return agentFileNote(url, parsed.hostname.toLowerCase() === 'raw.githubusercontent.com' ? 'repo-author' : 'site-authors');
  } catch {
    return undefined;
  }
}
