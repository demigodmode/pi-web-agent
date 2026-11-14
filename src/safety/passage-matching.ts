import { normalizeParagraph } from './paragraphs.js';
import { SEND_VERB, extractRiskyAgentAskClauses, isRiskyAgentAsk } from './agent-directed.js';

const TOKEN_EDGE = /^[\p{L}\p{N}_]$/u;
const PARTIAL_ASK = new RegExp(String.raw`\b(?:run|execute|install|ignore|forget|override|conceal|hide|withhold|change|delete|overwrite)\b|\b${SEND_VERB}\b\s+\S|\bplease\s+${SEND_VERB}\b\s*$|\binclude\b[\s\S]{1,100}?\s+\b(?:in|into)\b\s+(?:(?:a|the)\s+)?(?:(?:request\s+)?url|request)\b|\b(?:read|output|disclose|reveal|print)\b[\s\S]{0,100}(?:\.env\b|~\/\.ssh|\b(?:secrets?|tokens?|keys?|credentials?|environment\s+variables?|env(?:ironment)?\s+files?)\b)`, 'iu');
// Mirrors the old regex prefix: optional line break, indentation, optional list marker.
const LINE_PREFIX = /^(?:\r?\n)?[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/u;
const LINE_START_PREFIX = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?$/u;

// A trailing ellipsis is the allocator's clip mark, so it is the end of the emitted text.
const CLIP_MARK = /…$/u;
const ELLIPSIS = '…';

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/u.test(char);
}

/** End of a whitespace run that starts at from. */
function skipSpace(text: string, from: number): number {
  let index = from;
  while (index < text.length && isSpace(text[index])) index += 1;
  return index;
}

function isToken(codePoint: number | undefined): boolean {
  return codePoint !== undefined && TOKEN_EDGE.test(String.fromCodePoint(codePoint));
}

function tokenBefore(text: string, index: number): boolean {
  if (index <= 0) return false;
  const low = text.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return isToken(text.codePointAt(start));
}

function tokenAt(text: string, index: number): boolean {
  return isToken(text.codePointAt(index));
}

/**
 * Matches a normalized literal at pos, where each single space in the literal
 * is one or more whitespace characters in the text. Returns the end, or -1.
 */
function matchAt(text: string, pos: number, literal: string): number {
  let index = pos;
  for (const char of literal) {
    if (char === ' ') {
      const next = skipSpace(text, index);
      if (next === index) return -1;
      index = next;
    } else {
      if (text[index] !== char) return -1;
      index += 1;
    }
  }
  return index;
}

type Span = { start: number; end: number };

/**
 * Next occurrence of a normalized passage at or after `from`, with token edges on
 * both sides. Works on the text as it is, so offsets are the source offsets.
 */
function findPassage(text: string, passage: string, from: number, allowEllipsis: boolean): Span | undefined {
  if (!passage) return undefined;
  const head = passage.split(' ', 1)[0]!;
  let index = text.indexOf(head, from);
  while (index >= 0) {
    const end = matchAt(text, index, passage);
    if (end >= 0 && !tokenBefore(text, index) && !tokenAt(text, end) && (allowEllipsis || text[end] !== ELLIPSIS)) {
      return { start: index, end };
    }
    index = text.indexOf(head, index + 1);
  }
  return undefined;
}

function actualMatches(text: string, normalized: string): string[] {
  const matches: string[] = [];
  let from = 0;
  for (let found = findPassage(text, normalized, from, false); found; found = findPassage(text, normalized, from, false)) {
    matches.push(normalized);
    from = found.end;
  }
  return matches;
}

function clippedMatches(text: string, normalized: string): string[] {
  const emitted = normalizeParagraph(text);
  const firstWord = normalized.match(/^\S+/u)?.[0];
  if (!firstWord) return [];
  const matches: string[] = [];
  let start = emitted.indexOf(firstWord);
  while (start >= 0) {
    const suffix = emitted.slice(start);
    if (normalized.startsWith(suffix) && isRiskyAgentAsk(suffix) && PARTIAL_ASK.test(suffix)) matches.push(suffix);
    start = emitted.indexOf(firstWord, start + firstWord.length);
  }
  return matches;
}

/** Finds source-owned flagged prose that actually survives allocation. */
export function matchFlaggedParagraphs(clipped: string, flagged: readonly string[]): string[] {
  const emitted = clipped.replace(CLIP_MARK, '');
  const matched: string[] = [];
  const emittedNormalized = normalizeParagraph(emitted);
  const emittedParagraphs = emitted.split(/\r?\n\s*\r?\n/gu).map(normalizeParagraph).filter(Boolean);
  for (const paragraph of flagged) {
    const normalized = normalizeParagraph(paragraph);
    if (!normalized) continue;
    const whole = normalized.length <= emittedNormalized.length ? actualMatches(emitted, normalized) : [];
    const clauses = extractRiskyAgentAskClauses(normalized);
    if (whole.length) {
      if (!matched.includes(normalized)) matched.push(normalized);
      continue;
    }
    const sourceLead = normalized.match(/^\S+/u)?.[0];
    if (sourceLead && emittedNormalized.toLocaleLowerCase().includes(sourceLead.toLocaleLowerCase()) && !emittedNormalized.includes(sourceLead)) continue;
    let contextMatched = false;
    for (const emittedParagraph of emittedParagraphs) {
      if (!sourceLead) continue;
      const start = emittedParagraph.indexOf(sourceLead);
      if (start < 0) continue;
      const context = emittedParagraph.slice(start);
      if (!normalized.startsWith(context)) continue;
      const hasSurvivingAsk = clauses.some((clause) => {
        const clauseStart = context.indexOf(clause.match(/^\S+/u)?.[0] ?? '');
        const candidate = clauseStart < 0 ? '' : context.slice(clauseStart);
        return Boolean(candidate && clause.startsWith(candidate) && isRiskyAgentAsk(candidate) && PARTIAL_ASK.test(candidate));
      });
      if (hasSurvivingAsk && !matched.includes(context)) {
        matched.push(context);
        contextMatched = true;
      }
    }
    if (contextMatched) continue;
    for (const clause of clauses) {
      const variants = [clause, clause.replace(/^please\s+/iu, '')].filter((variant, index, values) => variant && values.indexOf(variant) === index);
      for (const variant of variants) {
        const exact = actualMatches(emitted, normalizeParagraph(variant));
        if (exact.length) {
          for (const text of exact) if (!matched.includes(text)) matched.push(text);
          break;
        }
        for (const emittedParagraph of emittedParagraphs) for (const candidate of clippedMatches(emittedParagraph, variant)) {
          if (!matched.includes(candidate)) matched.push(candidate);
        }
      }
    }
  }
  return matched;
}

/** Whether the text continues with the mark, after optional whitespace. */
function markFollows(text: string, index: number, mark: string): boolean {
  const body = normalizeParagraph(mark) + (/\s$/u.test(mark) ? ' ' : '');
  if (/^\s/u.test(mark)) return matchAt(text, index, ` ${body}`) >= 0;
  return matchAt(text, skipSpace(text, index), body) >= 0;
}

/** Inserts the mark after each emitted clause occurrence of the risky clauses inside one passage. */
function markClauses(context: string, clauses: readonly string[], mark: string): string {
  const needles = clauses.map(normalizeParagraph);
  const cache: Array<Span | null | undefined> = needles.map(() => undefined);
  const ends: number[] = [];
  let from = 0;
  for (;;) {
    let best: { span: Span } | undefined;
    needles.forEach((needle, order) => {
      let span = cache[order];
      if (span === undefined || (span !== null && span.start < from)) {
        span = findPassage(context, needle, from, true) ?? null;
        cache[order] = span;
      }
      if (span && (!best || span.start < best.span.start)) best = { span };
    });
    if (!best) break;
    ends.push(best.span.end);
    from = best.span.end;
  }
  let rendered = '';
  let cursor = 0;
  for (const end of ends) {
    rendered += `${context.slice(cursor, end)}${mark}`;
    cursor = end;
  }
  return rendered + context.slice(cursor);
}

function renderPassage(actual: string, bare: boolean, clauses: readonly string[], mark: string): string {
  const prefix = bare ? actual.match(LINE_PREFIX)?.[0] ?? '' : '';
  const context = actual.slice(prefix.length);
  if (!clauses.length || CLIP_MARK.test(context)) return `${actual}${mark}`;
  return `${prefix}${markClauses(context, clauses, mark)}`;
}

/** Inserts a marker after whole emitted matches without reformatting source text. */
export function markMatchedParagraphs(text: string, matched: readonly string[], mark: string): string {
  const paragraphs = [...new Set(matched.map(normalizeParagraph).filter(Boolean))].sort((left, right) => right.length - left.length);
  let rendered = text;
  for (const paragraph of paragraphs) {
    const clauses = extractRiskyAgentAskClauses(paragraph).sort((left, right) => right.length - left.length);
    const bare = clauses.includes(paragraph);
    const edits: Array<{ start: number; end: number; text: string }> = [];
    let from = 0;
    for (let found = findPassage(rendered, paragraph, from, true); found; found = findPassage(rendered, paragraph, from, true)) {
      const { start, end } = found;
      let matchStart = start;
      if (bare && start > 0) {
        const lineStart = rendered.lastIndexOf('\n', start - 1) + 1;
        if (!LINE_START_PREFIX.test(rendered.slice(lineStart, start))) {
          from = start + 1;
          continue;
        }
        matchStart = lineStart === 0 ? 0 : rendered[lineStart - 2] === '\r' ? lineStart - 2 : lineStart - 1;
      }
      // Optional ellipsis, then the passage must not be followed by the mark. A
      // trailing ellipsis that is followed by the mark is left out of the match.
      const ellipsis = rendered[end] === ELLIPSIS;
      let stop: number;
      if (ellipsis && !markFollows(rendered, end + 1, mark)) stop = end + 1;
      else if (!ellipsis && !markFollows(rendered, end, mark)) stop = end;
      else if (ellipsis) stop = end;
      else {
        from = start + 1;
        continue;
      }
      edits.push({ start: matchStart, end: stop, text: renderPassage(rendered.slice(matchStart, stop), bare, clauses, mark) });
      from = stop;
    }
    if (edits.length === 0) continue;
    let next = '';
    let cursor = 0;
    for (const edit of edits) {
      next += `${rendered.slice(cursor, edit.start)}${edit.text}`;
      cursor = edit.end;
    }
    rendered = next + rendered.slice(cursor);
  }
  return rendered;
}
