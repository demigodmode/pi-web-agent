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

type Quote = '"' | "'" | '“' | '‘' | undefined;

function nextQuote(quote: Quote, text: string, index: number): Quote {
  const char = text[index];
  if ((char === "'" || char === '’') && /[\p{L}\p{N}]/u.test(text[index - 1] ?? '') && /[\p{L}\p{N}]/u.test(text[index + 1] ?? '')) return quote;
  if (char === '”' && quote === '“') return undefined;
  if (char === '’' && quote === '‘') return undefined;
  if ((char === '"' || char === "'") && text[index - 1] !== '\\') return quote === char ? undefined : (quote ?? char);
  if (char === '“' || char === '‘') return quote ?? char;
  return quote;
}

function isQuotedAt(text: string, offset: number): boolean {
  let quote: Quote;
  for (let index = 0; index < offset; index += 1) quote = nextQuote(quote, text, index);
  return quote !== undefined;
}

/** One pass: blocked[offset] is 1 when an address starting there is inside quotes or inline code. */
function blockedOffsets(text: string): Uint8Array {
  const blocked = new Uint8Array(text.length + 1);
  let quote: Quote;
  let open = false;
  for (let index = 0; index < text.length; index += 1) {
    blocked[index] = quote !== undefined || open ? 1 : 0;
    quote = nextQuote(quote, text, index);
    if (text[index] === '`' && text[index - 1] !== '\\') open = !open;
  }
  blocked[text.length] = quote !== undefined || open ? 1 : 0;
  return blocked;
}

/** quoted[offset] is 1 when isQuotedAt(text, offset) would be true. */
function quotedOffsets(text: string): Uint8Array {
  const quoted = new Uint8Array(text.length + 1);
  let quote: Quote;
  for (let index = 0; index < text.length; index += 1) {
    quoted[index] = quote !== undefined ? 1 : 0;
    quote = nextQuote(quote, text, index);
  }
  quoted[text.length] = quote !== undefined ? 1 : 0;
  return quoted;
}

type Sentence = { text: string; start: number; end: number };

/**
 * Longest stretch scanned as one sentence. Longer runs (no sentence punctuation)
 * are cut at whitespace into pieces of about this size, so a flagged span and the
 * work done per address stay bounded.
 */
export const MAX_SENTENCE_CHARS = 2000;

// A sentence ends at a run of [.!?] that is followed by whitespace or the end of the text.
function sentences(text: string): Sentence[] {
  const parts: Sentence[] = [];
  const add = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const value = raw.trim();
    if (value) {
      const leading = raw.length - raw.trimStart().length;
      parts.push({ text: value, start: from + leading, end: from + leading + value.length });
    }
  };
  let start = 0;
  const close = (end: number) => {
    while (end - start > MAX_SENTENCE_CHARS) {
      let cut = start + MAX_SENTENCE_CHARS;
      while (cut > start + 1 && !/\s/u.test(text[cut - 1]!)) cut -= 1;
      if (cut === start + 1) cut = start + MAX_SENTENCE_CHARS;
      // Never cut between the halves of a surrogate pair.
      if (cut - start > 1 && text.charCodeAt(cut - 1) >= 0xd800 && text.charCodeAt(cut - 1) <= 0xdbff) cut -= 1;
      add(start, cut);
      start = cut;
    }
    add(start, end);
    start = end;
  };
  for (const run of text.matchAll(/[.!?]+/gu)) {
    const end = (run.index ?? 0) + run[0].length;
    if (end === text.length || /\s/u.test(text[end]!)) close(end);
  }
  close(text.length);
  return parts;
}

type Address = { start: number; end: number; modal: boolean };
type RiskyAsk = 'execution' | 'install' | 'egress' | 'secrets' | 'change-files' | 'hide' | 'override';

function unquotedAddresses(text: string): Address[] {
  const addresses: Address[] = [];
  let blocked: Uint8Array | undefined;
  for (const regexp of [EXPLICIT_LABEL, ADDRESS, MODAL_ADDRESS, CLAUDE_MENTION]) {
    for (const match of text.matchAll(new RegExp(regexp.source, regexp.flags))) {
      if (match.index === undefined) continue;
      blocked ??= blockedOffsets(text);
      if (blocked[match.index]) continue;
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

/** Index in text where the whitespace run ending just before offset begins. */
function whitespaceRunStart(text: string, offset: number): number {
  let index = offset;
  while (index > 0 && /\s/u.test(text[index - 1]!)) index -= 1;
  return index;
}

/** The "please" before a risky verb, measured from the verb's index. Zero when there is none. */
function politeLengthBefore(text: string, index: number): number {
  const start = whitespaceRunStart(text, index);
  if (start === index || start < 6) return 0;
  return /^please$/iu.test(text.slice(start - 6, start)) ? index - (start - 6) : 0;
}

// Each clause is a suffix of its piece, so the list is capped to keep marking bounded.
const MAX_CLAUSES = 100;

/** Extracts the concrete risky clauses from an already-qualified source span, at most MAX_CLAUSES. */
export function extractRiskyAgentAskClauses(text: string): string[] {
  const clauses: string[] = [];
  for (const sentence of sentences(text)) {
    const asks = riskyAgentAsks(sentence.text);
    if (asks.length === 0) continue;
    const quoted = quotedOffsets(sentence.text);
    for (const ask of asks) {
      if (quoted[ask.index]) continue;
      const polite = politeLengthBefore(sentence.text, ask.index);
      const start = ask.index - polite;
      const clause = sentence.text.slice(start).trim();
      if (clause && !clauses.includes(clause)) clauses.push(clause);
      if (clauses.length >= MAX_CLAUSES) return clauses;
    }
  }
  return clauses;
}

export function isRiskyAgentAsk(text: string, { allowModal = true }: { allowModal?: boolean } = {}): boolean {
  const kind = classifyRiskyAgentAsk(text);
  if (!kind) return false;
  return allowModal || ['egress', 'secrets', 'hide', 'override'].includes(kind);
}

const MODAL_KINDS: ReadonlySet<RiskyAsk> = new Set(['egress', 'secrets', 'hide', 'override']);
const RISKY_PATTERNS: Array<[string, RegExp]> = [
  ['execution', EXECUTION], ['install', INSTALL], ['egress', EGRESS], ['secrets', SECRETS],
  ['change-files', CHANGE_FILES], ['hide', HIDE], ['override', OVERRIDE], ['modal', MODAL],
];
// Each pattern tested at position 0 of a candidate, where lookbehind and ^ see nothing before.
const STICKY_AT_START = new Map(RISKY_PATTERNS.map(([key, regexp]) => [key, new RegExp(regexp.source, `${regexp.flags.replace('g', '')}y`)]));
// Every start position of each pattern, found with a lookahead so overlapping hits are not skipped.
const EVERY_START = RISKY_PATTERNS.map(([key, regexp]) => [key, new RegExp(`(?=(?:${regexp.source}))`, `${regexp.flags.replace('g', '')}g`)] as const);

function testAtStart(key: string, candidate: string): boolean {
  const regexp = STICKY_AT_START.get(key)!;
  regexp.lastIndex = 0;
  return regexp.test(candidate);
}

/**
 * Per sentence, the last position where each risky pattern can start. A candidate
 * that starts at `from` only has hits at positions after `from` if the sentence does.
 */
function lastStarts(sentence: string): Map<string, number> {
  const last = new Map<string, number>();
  for (const [key, regexp] of EVERY_START) {
    let index = -1;
    for (const match of sentence.matchAll(regexp)) index = match.index ?? index;
    last.set(key, index);
  }
  return last;
}

/** False only when the candidate provably has no risky hit of the given keys. */
function mayHit(sentence: string, last: Map<string, number>, from: number, keys: readonly string[]): boolean {
  const candidate = sentence.slice(from);
  return keys.some((key) => (last.get(key) ?? -1) >= from + 1 || testAtStart(key, candidate));
}

function articleVerbEnds(sentence: string): number[] {
  return [...sentence.matchAll(/\b(?:article|report|documentation)\s+(?:says|said|explains|describes)/giu)]
    .map((match) => (match.index ?? 0) + match[0].length);
}

/** True when the address follows "article says" with only whitespace between. */
function afterArticleSays(sentence: string, ends: number[], start: number): boolean {
  let low = 0;
  let high = ends.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (ends[middle]! <= start) {
      found = ends[middle]!;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found >= 0 && whitespaceRunStart(sentence, start) <= found;
}

type CandidateCache = {
  asks?: Array<{ kind: RiskyAsk; index: number }>;
  quoted?: Uint8Array;
  modal?: boolean;
  onlyWhen?: boolean;
  egressData?: boolean;
};

/** Whether any risky ask in the candidate survives the address and quoting rules. */
function candidateQualifies(candidate: string, addressModal: boolean, cache: CandidateCache): boolean {
  cache.asks ??= riskyAgentAsks(candidate);
  if (cache.asks.length === 0) return false;
  cache.quoted ??= quotedOffsets(candidate);
  for (const ask of cache.asks) {
    if (cache.quoted[ask.index]) continue;
    const modal = addressModal || (cache.modal ??= MODAL.test(candidate));
    if (modal && (cache.onlyWhen ??= /\bonly\s+when\s+the\s+user\s+(?:explicitly\s+)?(?:asks?|requests?|authori[sz]es)\b/iu.test(candidate))) continue;
    if (modal && !MODAL_KINDS.has(ask.kind)) continue;
    if (modal && ask.kind === 'egress' && !(cache.egressData ??= /(?:\.env\b|\b(?:secrets?|tokens?|keys?|credentials?|environment\s+variables?|data|files?)\b)/iu.test(candidate))) continue;
    return true;
  }
  return false;
}

const ALL_KINDS = RISKY_PATTERNS.map(([key]) => key).filter((key) => key !== 'modal');

/**
 * Marks each span that occurs inside a different span, in one Aho-Corasick pass.
 * Spans are distinct strings, so an occurrence in another span is a proper containment.
 */
function spansInsideOthers(spans: string[]): boolean[] {
  const next = new Map<number, number>();
  const parent = [0];
  const unit = [0];
  const depth = [0];
  const terminal = [-1];
  const key = (node: number, code: number) => node * 65536 + code;
  spans.forEach((span, index) => {
    let node = 0;
    for (let i = 0; i < span.length; i += 1) {
      const code = span.charCodeAt(i);
      let child = next.get(key(node, code));
      if (child === undefined) {
        child = parent.length;
        next.set(key(node, code), child);
        parent.push(node);
        unit.push(code);
        depth.push(depth[node]! + 1);
        terminal.push(-1);
      }
      node = child;
    }
    terminal[node] = index;
  });

  // Breadth-first order by counting sort on depth, so every fail link is set before it is read.
  const nodes = parent.length;
  let deepest = 0;
  for (const d of depth) if (d > deepest) deepest = d;
  const bucketStart = new Int32Array(deepest + 2);
  for (const d of depth) bucketStart[d + 1] = bucketStart[d + 1]! + 1;
  for (let d = 1; d < bucketStart.length; d += 1) bucketStart[d] = bucketStart[d]! + bucketStart[d - 1]!;
  const byDepth = new Int32Array(nodes);
  for (let node = 0; node < nodes; node += 1) byDepth[bucketStart[depth[node]!]!++] = node;
  const fail = new Int32Array(nodes);
  const dict = new Int32Array(nodes);
  for (const node of byDepth) {
    if (node === 0 || parent[node] === 0) continue;
    let state = fail[parent[node]!]!;
    while (state !== 0 && !next.has(key(state, unit[node]!))) state = fail[state]!;
    fail[node] = next.get(key(state, unit[node]!)) ?? 0;
    dict[node] = terminal[fail[node]!]! >= 0 ? fail[node]! : dict[fail[node]!]!;
  }

  const inside = spans.map(() => false);
  const visited = new Int32Array(nodes).fill(-1);
  spans.forEach((span, own) => {
    let state = 0;
    for (let i = 0; i < span.length; i += 1) {
      const code = span.charCodeAt(i);
      while (state !== 0 && !next.has(key(state, code))) state = fail[state]!;
      state = next.get(key(state, code)) ?? 0;
      let node = terminal[state]! >= 0 ? state : dict[state]!;
      while (node !== 0 && visited[node] !== own) {
        visited[node] = own;
        if (terminal[node]! !== own) inside[terminal[node]!] = true;
        node = dict[node]!;
      }
    }
  });
  return inside;
}

// Per text. Spans are collected in document order, so this only trims the tail.
const MAX_SPANS_PER_TEXT = 1000;
/** Flagged paragraphs kept per source; the first ones in document order win. */
export const MAX_FLAGGED_PARAGRAPHS = 200;

/** Finds eligible direct requests without modifying the original source bytes. */
export function extractAgentDirectedRequestSpans(text: string, { heading = false }: { heading?: boolean } = {}): string[] {
  // A bare override is a common article title, so headings only count with a direct address.
  if (!heading && hasLeadingOverride(text)) {
    const first = sentences(text)[0]?.text;
    return first ? [first] : [];
  }
  const parts = sentences(text);
  const spans: string[] = [];
  const seen = new Set<string>();
  const push = (span: string) => {
    if (seen.has(span)) return;
    seen.add(span);
    spans.push(span);
  };

  let previousAddresses: Address[] = [];
  for (let index = 0; index < parts.length && spans.length < MAX_SPANS_PER_TEXT; index += 1) {
    const current = parts[index]!;
    const addresses = unquotedAddresses(current.text);

    // Own spans are suffixes of this sentence, so the earliest qualifying address
    // covers every later one; scanning in start order and stopping there gives the
    // same surviving spans as checking all of them.
    const ownCandidates = [...addresses].sort((left, right) => left.start - right.start);
    if (ownCandidates.length > 0) {
      const last = lastStarts(current.text);
      const ends = articleVerbEnds(current.text);
      for (const address of ownCandidates) {
        if (address.modal && afterArticleSays(current.text, ends, address.start)) continue;
        const from = address.end;
        // A modal candidate can only carry the asks that modal text allows.
        const modal = address.modal || mayHit(current.text, last, from, ['modal']);
        if (!mayHit(current.text, last, from, modal ? [...MODAL_KINDS] : ALL_KINDS)) continue;
        if (candidateQualifies(current.text.slice(from), address.modal, {})) {
          push(current.text.slice(address.start));
          break;
        }
      }
    }

    if (index > 0 && previousAddresses.length > 0) {
      const cache: CandidateCache = {};
      if (previousAddresses.some((address) => candidateQualifies(current.text, address.modal, cache))) {
        push(`${parts[index - 1]!.text} ${current.text}`);
      }
    }
    previousAddresses = addresses;
  }
  const inside = spansInsideOthers(spans);
  return spans.filter((_, index) => !inside[index]);
}

/** Returns true only for a bounded direct request aimed at an AI-like recipient. */
export function isAgentDirectedParagraph(text: string): boolean {
  return extractAgentDirectedRequestSpans(text).length > 0;
}

/** Finds eligible direct requests without modifying the original source bytes. */
export function detectAgentDirectedParagraphs(source: string, format: SourceFormat): string[] {
  // Paragraphs first, then headings. Stopping at the cap keeps the first spans in that order.
  const found = new Set<string>();
  const collect = (spans: string[]) => {
    for (const span of spans) {
      if (found.size >= MAX_FLAGGED_PARAGRAPHS) return;
      found.add(span);
    }
  };
  for (const paragraph of sourceParagraphs(source, format)) {
    collect(extractAgentDirectedRequestSpans(paragraph));
    if (found.size >= MAX_FLAGGED_PARAGRAPHS) return [...found];
  }
  for (const heading of sourceHeadings(source, format)) {
    collect(extractAgentDirectedRequestSpans(heading, { heading: true }));
    if (found.size >= MAX_FLAGGED_PARAGRAPHS) break;
  }
  return [...found];
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
