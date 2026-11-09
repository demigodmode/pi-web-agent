const MAX_PASSAGES = 3;
const MAX_PASSAGE_CHARS = 900;

export type PassageCandidate = {
  text: string;
  order: number;
  score: number;
  codeBlock: boolean;
};

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

function termsOf(text: string): Set<string> {
  return new Set(
    (text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])
      .filter((term) => [...term].length >= 3)
  );
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

export function rankEvidencePassages(text: string, query: string): PassageCandidate[] {
  const tokens = queryTokens(query);
  const terms = new Set(tokens.map((token) => token.toLowerCase()).filter((term) => Array.from(term).length >= 3));
  const numbers = numericTokens(query);
  const properNames = new Set(tokens.filter((token) => /^\p{Lu}/u.test(token) && Array.from(token).length >= 3));
  const candidates = splitEvidenceParagraphs(text).flatMap((paragraph) => {
    const codeBlock = isCodeBlock(paragraph);
    return splitLongCandidate(paragraph).map((chunk) => {
      const chunkTerms = termsOf(chunk);
      const overlap = [...terms].filter((term) => chunkTerms.has(term)).length;
      const numericBonus = [...numbers].filter((number) => numericTokens(chunk).has(number)).length;
      const properNameBonus = [...properNames].filter((name) => new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(chunk)).length;
      return { text: chunk, order: 0, score: overlap + numericBonus + properNameBonus, codeBlock };
    });
  }).map((candidate, order) => ({ ...candidate, order }));
  const substantive = candidates.filter((candidate) => candidate.codeBlock || !isBoilerplate(candidate.text));
  const kept = substantive.length ? substantive : candidates.filter((candidate) => candidate.text.trim());
  return kept.sort((a, b) => b.score - a.score || a.order - b.order);
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
