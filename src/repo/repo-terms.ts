export type QueryTerm = { term: string; variants: string[] };

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'where', 'what', 'which', 'when', 'how', 'why', 'who', 'does', 'did', 'this', 'that', 'these', 'those',
  'project', 'repo', 'repository', 'code', 'codebase', 'file', 'files', 'find', 'show', 'there', 'here', 'into', 'from', 'about', 'have',
  'has', 'are', 'was', 'were', 'can', 'could', 'should', 'would', 'use', 'used', 'using', 'work', 'works', 'handle', 'handled', 'handles',
  'get', 'set', 'make', 'made', 'like', 'just', 'also', 'than', 'then', 'only', 'other', 'over', 'under', 'between', 'please', 'tell',
  'explain', 'look', 'see', 'you', 'your', 'our', 'they', 'them', 'their', 'some', 'any', 'all', 'its', 'one', 'implemented', 'implement',
  'happens', 'happen', 'done', 'doing', 'way', 'part', 'parts', 'thing', 'things'
]);

function addWord(words: string[], seen: Set<string>, word: string): void {
  const normalized = word.toLowerCase();
  if (normalized.length < 3 || /^\d+$/.test(normalized) || STOPWORDS.has(normalized) || seen.has(normalized)) return;
  seen.add(normalized);
  words.push(normalized);
}

function variants(word: string): string[] {
  const result = [word];
  if (word.length > 4 && word.endsWith('ies')) {
    result.push(`${word.slice(0, -3)}y`);
  } else if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) {
    result.push(word.slice(0, -1));
  }
  if (word.length > 5 && word.endsWith('es') && !word.endsWith('ies') && !word.endsWith('ss')) result.push(word.slice(0, -2));
  return result;
}

export function queryTerms(query: string): QueryTerm[] {
  const words: string[] = [];
  const seen = new Set<string>();
  const tokens = query.replace(/https?:\/\/\S+/gi, '').match(/[A-Za-z0-9_]+/g) ?? [];

  for (const token of tokens) {
    addWord(words, seen, token);
    const parts = token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_]+/);
    if (parts.length > 1) {
      for (const part of parts) addWord(words, seen, part);
    }
  }

  return words.map((term) => ({ term, variants: variants(term) }));
}
