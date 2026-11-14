import { normalizeParagraph } from './paragraphs.js';
import { SEND_VERB, extractRiskyAgentAskClauses, isRiskyAgentAsk } from './agent-directed.js';

const TOKEN_EDGE = String.raw`[\p{L}\p{N}_]`;
const PARTIAL_ASK = new RegExp(String.raw`\b(?:run|execute|install|ignore|forget|override|conceal|hide|withhold|change|delete|overwrite)\b|\b${SEND_VERB}\b\s+\S|\bplease\s+${SEND_VERB}\b\s*$|\binclude\b[\s\S]{1,100}?\s+\b(?:in|into)\b\s+(?:(?:a|the)\s+)?(?:(?:request\s+)?url|request)\b|\b(?:read|output|disclose|reveal|print)\b[\s\S]{0,100}(?:\.env\b|~\/\.ssh|\b(?:secrets?|tokens?|keys?|credentials?|environment\s+variables?|env(?:ironment)?\s+files?)\b)`, 'iu');

function escapePattern(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&').replace(/\s+/gu, String.raw`\s+`);
}

function passagePattern(text: string, allowEllipsis = false): RegExp {
  return new RegExp(String.raw`(?<!${TOKEN_EDGE})${escapePattern(text)}(?!${TOKEN_EDGE}${allowEllipsis ? '' : '|…'})`, 'gu');
}

// A trailing ellipsis is the allocator's clip mark, so it is the end of the emitted text.
const CLIP_MARK = /…$/u;

function actualMatches(text: string, normalized: string): string[] {
  return [...text.matchAll(passagePattern(normalized))].map((match) => normalizeParagraph(match[0]));
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
        const exact = actualMatches(emitted, variant);
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

/** Inserts a marker after whole emitted matches without reformatting source text. */
export function markMatchedParagraphs(text: string, matched: readonly string[], mark: string): string {
  const paragraphs = [...new Set(matched.map(normalizeParagraph).filter(Boolean))].sort((left, right) => right.length - left.length);
  let rendered = text;
  for (const paragraph of paragraphs) {
    const clauses = extractRiskyAgentAskClauses(paragraph).sort((left, right) => right.length - left.length);
    const bareClause = clauses.includes(paragraph);
    const contextPattern = bareClause
      ? new RegExp(String.raw`(^|\r?\n)[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(${passagePattern(paragraph, true).source}(?:…)?)(?!\s*${escapePattern(mark)})`, 'gu')
      : new RegExp(`${passagePattern(paragraph, true).source}(?:…)?(?!\\s*${escapePattern(mark)})`, 'gu');
    rendered = rendered.replace(contextPattern, (actual) => {
      const prefix = bareClause ? actual.match(/^(?:\r?\n)?[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/u)?.[0] ?? '' : '';
      const context = bareClause ? actual.slice(prefix.length) : actual;
      if (!clauses.length || CLIP_MARK.test(context)) return `${actual}${mark}`;
      const alternatives = clauses.map(escapePattern).join('|');
      const pattern = new RegExp(String.raw`(?<!${TOKEN_EDGE})(?:${alternatives})(?!${TOKEN_EDGE})`, 'gu');
      return `${prefix}${context.replace(pattern, (request) => `${request}${mark}`)}`;
    });
  }
  return rendered;
}
