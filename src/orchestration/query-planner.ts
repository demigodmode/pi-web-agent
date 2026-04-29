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
    .replace(/\b(find|current|tell|me|how|to|the|and|with|for|in|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const planned =
    input.passIndex === 0
      ? [input.originalQuery]
      : [
          officialSiteQuery(input.originalQuery),
          implementationQuery(input.originalQuery),
          `${extractImportantWords(input.originalQuery)} discussion`
        ];

  const previous = new Set(input.previousQueries.map(normalizeWhitespace));
  return planned
    .map(normalizeWhitespace)
    .filter((query) => query && !previous.has(query))
    .slice(0, 3);
}
