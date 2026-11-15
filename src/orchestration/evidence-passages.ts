const MAX_PASSAGES = 3;
const MAX_PASSAGE_CHARS = 900;

export type PassageCandidate = {
  text: string;
  order: number;
  score: number;
  codeBlock: boolean;
  /** Nearest section heading, used as scoring context and to bound excerpt growth. */
  section?: string;
};

const MAX_HEADING_CHARS = 100;

export function splitEvidenceParagraphs(text: string): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;
  const flush = () => {
    const paragraph = lines.join('\n').trim();
    if (paragraph) paragraphs.push(paragraph);
    lines = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    const closesFence = fence && new RegExp(`^\\s*${fence.marker}{${fence.length},}\\s*$`).test(line);
    if (closesFence) {
      lines.push(line);
      fence = undefined;
      flush();
    } else if (!fence && opening) {
      flush();
      lines.push(line);
      fence = { marker: opening[1]![0] as '`' | '~', length: opening[1]!.length };
    } else if (!line.trim() && !fence) {
      flush();
    } else {
      lines.push(line);
    }
  }
  flush();
  return paragraphs;
}

function splitLongPart(part: string): string[] {
  const chunks: string[] = [];
  let rest = part;
  while (rest.length > MAX_PASSAGE_CHARS) {
    const boundary = Math.max(rest.lastIndexOf(' ', MAX_PASSAGE_CHARS), rest.lastIndexOf('\n', MAX_PASSAGE_CHARS));
    const cut = boundary > MAX_PASSAGE_CHARS / 2 ? boundary : MAX_PASSAGE_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function splitLongCandidate(part: string): string[] {
  const chunks: string[] = [];
  let rest = part;
  while (codePointLength(rest) > MAX_PASSAGE_CHARS) {
    const points = Array.from(rest);
    const head = points.slice(0, MAX_PASSAGE_CHARS).join('');
    const boundary = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
    const cut = boundary > MAX_PASSAGE_CHARS / 2 ? boundary : head.length;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function wordsOf(text: string): string[] {
  return (text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])
    .filter((term) => [...term].length >= 3);
}

function termsOf(text: string): Set<string> {
  return new Set(wordsOf(text));
}

function queryTokens(query: string): string[] {
  return query.replace(/https?:\/\/\S+/g, '').normalize('NFC').match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}.]*/gu) ?? [];
}

function numericTokens(text: string): Set<string> {
  return new Set(text.match(/(?<![\p{L}\p{N}])\d+(?:\.\d+)*(?![\p{L}\p{N}])/gu) ?? []);
}

function isCodeBlock(paragraph: string): boolean {
  return /^\s*(?:`{3,}|~{3,})/.test(paragraph);
}

function isBoilerplate(text: string): boolean {
  const words = termsOf(text);
  if (words.size > 0 && words.size <= 8 && [...words].every((word) => /^(?:home|docs?|blog|cookies?|privacy|sign|login|menu|navigation|terms?)$/.test(word))) return true;
  const markers = [
    /\bcookies?\b/i, /\bconsent\b/i, /\baccept all\b/i, /\bpreferences?\b/i,
    /\bsubscribe\b/i, /\bnewsletter\b/i, /\bsign[ -]?in\b/i, /\bprivacy\b/i
  ];
  return markers.filter((marker) => marker.test(text)).length >= 2;
}

function isHeadingLike(paragraph: string): boolean {
  return !paragraph.includes('\n') && paragraph.length <= MAX_HEADING_CHARS && !/[.!?:;,。！？：；，]$/.test(paragraph) && !isCodeBlock(paragraph);
}

function passageCandidates(text: string): PassageCandidate[] {
  const paragraphs = splitEvidenceParagraphs(text);
  const candidates: PassageCandidate[] = [];
  // The nearest heading-like line is the section; a heading directly above a
  // paragraph is also kept in that paragraph's first chunk, as it was before.
  let section: string | undefined;
  let prefix: string | undefined;
  paragraphs.forEach((paragraph, index) => {
    const next = paragraphs[index + 1];
    const headingLike = !isCodeBlock(paragraph) && isHeadingLike(paragraph);
    if (headingLike) section = paragraph;
    if (headingLike && next !== undefined && !isHeadingLike(next)) {
      prefix = paragraph;
      return;
    }
    const codeBlock = isCodeBlock(paragraph);
    const lead = prefix;
    prefix = undefined;
    const combined = lead ? `${lead}\n\n${paragraph}` : paragraph;
    for (const chunk of splitLongCandidate(combined)) {
      candidates.push({ text: chunk, order: candidates.length, score: 0, codeBlock, ...(section ? { section } : {}) });
    }
  });
  return candidates;
}

type ScoringQuery = { terms: Set<string>; numbers: Set<string>; properNames: Set<string> };

function scoringQuery(query: string): ScoringQuery {
  const tokens = queryTokens(query);
  return {
    terms: new Set(tokens.flatMap((token) => token.toLowerCase().split('.')).filter((term) => Array.from(term).length >= 3)),
    numbers: numericTokens(query),
    properNames: new Set(tokens.filter((token) => /^\p{Lu}/u.test(token) && Array.from(token).length >= 3))
  };
}

function scoreCandidate(candidate: PassageCandidate, query: ScoringQuery): PassageCandidate {
  const { terms, numbers, properNames } = query;
  const sectionWords = candidate.section && !candidate.text.startsWith(candidate.section) ? wordsOf(candidate.section) : [];
  const matched = new Set([...wordsOf(candidate.text), ...sectionWords].filter((word) => terms.has(word)));
  const chunkNumbers = numericTokens(candidate.text);
  const numericBonus = [...numbers].filter((number) => chunkNumbers.has(number)).length;
  const properNameBonus = [...properNames].filter((name) => new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(candidate.text)).length;
  return { ...candidate, score: matched.size + numericBonus + properNameBonus };
}

export function rankEvidencePassages(text: string, query: string): PassageCandidate[] {
  const candidates = passageCandidates(text);
  const substantive = candidates.filter((candidate) => candidate.codeBlock || !isBoilerplate(candidate.text));
  const kept = substantive.length ? substantive : candidates.filter((candidate) => candidate.text.trim());
  const scoring = scoringQuery(query);
  return kept.map((candidate) => scoreCandidate(candidate, scoring))
    .sort((a, b) => b.score - a.score || a.order - b.order);
}

export function selectEvidencePassages(text: string, query: string) {
  const paragraphs = splitEvidenceParagraphs(text);
  const parts = paragraphs.flatMap(splitLongPart);
  const terms = termsOf(query.replace(/https?:\/\/\S+/g, ''));
  const ranked = parts.map((part, index) => {
    const partTerms = termsOf(part);
    return { part, index, score: [...terms].filter((term) => partTerms.has(term)).length };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.slice(0, MAX_PASSAGES).sort((a, b) => a.index - b.index);
  const excerpts = selected.map(({ part }) => part.slice(0, MAX_PASSAGE_CHARS));
  return {
    excerpts,
    truncated: ranked.length > MAX_PASSAGES || paragraphs.some((part) => part.length > MAX_PASSAGE_CHARS)
  };
}
