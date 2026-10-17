export type QueryPlanInput = {
  originalQuery: string;
  passIndex: number;
  previousQueries: string[];
  gaps: string[];
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractImportantWords(query: string) {
  return normalizeWhitespace(query)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(find|current|tell|me|how|to|the|and|with|for|in|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function gapQueries(input: QueryPlanInput): string[] {
  const terms = extractImportantWords(input.originalQuery);
  const later = input.passIndex > 1;
  const queries: string[] = [];
  for (const gap of input.gaps) {
    const target = gap.match(/comparison evidence for target:\s*(.+)/i)?.[1]?.trim();
    if (target) queries.push(later ? `site:github.com ${target} ${terms}` : `${target} comparison evidence ${terms}`);
    else if (/supported version|version-specific|compatibility|release notes/i.test(gap))
      queries.push(later ? `${terms} version compatibility changelog` : `${terms} supported version release notes`);
    else if (/exact API|API behavior|API reference/i.test(gap))
      queries.push(later ? `site:github.com ${terms} API implementation` : `${terms} API reference exact behavior`);
    else if (/disagree|conflict|contradict|disputed/i.test(gap))
      queries.push(later ? `${terms} disputed claim implementation` : `${terms} disputed claim primary source`);
    else if (/user experience|opinions|practical experience/i.test(gap))
      queries.push(later ? `site:reddit.com ${terms} user experience` : `${terms} user experience issue reports`);
    else if (/official docs/i.test(gap)) queries.push(later ? `${terms} official API reference` : officialSiteQuery(input.originalQuery));
    else if (/implementation references/i.test(gap)) queries.push(later ? `${terms} source implementation` : implementationQuery(input.originalQuery));
  }
  return queries;
}

function officialSiteQuery(query: string) {
  const lower = query.toLowerCase();
  const terms = extractImportantWords(query);
  if (lower.includes('vitest')) return `site:vitest.dev ${terms}`;
  if (lower.includes('playwright')) return `site:playwright.dev ${terms}`;
  if (lower.includes('microsoft edge') || lower.includes('edge')) return `site:learn.microsoft.com ${terms}`;
  return `${terms} official docs`;
}

function implementationQuery(query: string) {
  return `site:github.com ${extractImportantWords(query)}`;
}

export function planSearchQueries(input: QueryPlanInput): string[] {
  if (input.passIndex === 0) return [normalizeWhitespace(input.originalQuery)];
  const terms = extractImportantWords(input.originalQuery);
  const fallback = input.passIndex === 1
    ? [officialSiteQuery(input.originalQuery), implementationQuery(input.originalQuery)]
    : [`${terms} release notes`, `${terms} discussion`];
  const previous = new Set(input.previousQueries.map((query) => normalizeWhitespace(query).toLowerCase()));
  const candidates = [...gapQueries(input), ...fallback];
  const selected: string[] = [];
  for (const candidate of candidates) {
    const query = normalizeWhitespace(candidate);
    const key = query.toLowerCase();
    if (!query || previous.has(key)) continue;
    previous.add(key);
    selected.push(query);
    if (selected.length === 2) break;
  }
  return selected;
}
