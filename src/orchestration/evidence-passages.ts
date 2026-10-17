const MAX_PASSAGES = 3;
const MAX_PASSAGE_CHARS = 900;

function paragraphsOf(text: string): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  let fenced = false;
  const flush = () => {
    const paragraph = lines.join('\n').trim();
    if (paragraph) paragraphs.push(paragraph);
    lines = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (!fenced) flush();
      lines.push(line);
      fenced = !fenced;
      if (!fenced) flush();
    } else if (!line.trim() && !fenced) {
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

function termsOf(text: string): Set<string> {
  return new Set(
    (text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])
      .filter((term) => [...term].length >= 3)
  );
}

export function selectEvidencePassages(text: string, query: string) {
  const paragraphs = paragraphsOf(text);
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
