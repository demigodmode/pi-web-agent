export type QueryPlanInput = {
  originalQuery: string;
  passIndex: number;
  previousQueries: string[];
  gaps: string[];
};

type SiteScope = {
  /** The user's positive site: operator, if they gave one. Follow-ups never use a different one. */
  positive?: string;
  /** The user's -site: exclusions, kept verbatim on every follow-up. */
  negatives: string[];
  excludedHosts: string[];
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

// One pattern for parsing and removal, so they can't drift. Groups: wrapper, minus, host, closing wrapper.
// The lookbehind rejects operators glued to a word (website:, mysite:) or a colon.
const SITE_OPERATOR = /(?<![\w.:-])(["([]?)(-?)site:([^\s()"',;[\]]+)(["')\]]?)/gi;

function cleanHost(raw: string) {
  return raw.replace(/[.!?:]+$/, '');
}

function removeSiteOperators(text: string) {
  let next = text.replace(SITE_OPERATOR, ' ');
  let previous: string;
  do {
    previous = next;
    next = next.replace(/\(\s*\)|\[\s*\]|""/g, ' ');
  } while (next !== previous);
  return next;
}

function extractImportantWords(query: string) {
  return removeSiteOperators(normalizeWhitespace(query).replace(/https?:\/\/\S+/gi, ' '))
    .replace(/\b(find|current|tell|me|how|to|the|and|with|for|in|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function siteScope(query: string): SiteScope {
  const operators = [...query.matchAll(SITE_OPERATOR)];
  const positive = operators.find((match) => !match[2]);
  const exclusions = operators.filter((match) => match[2]).map((match) => cleanHost(match[3]!));
  return {
    positive: positive ? `site:${cleanHost(positive[3]!)}` : undefined,
    negatives: exclusions.map((host) => `-site:${host}`),
    excludedHosts: exclusions.map((host) => host.toLowerCase())
  };
}

/**
 * A follow-up's words with the user's operators put back. Without user operators the
 * site added by the variant is used as-is. A user positive replaces it, and a site the
 * user excluded is never added.
 */
function scopedQuery(scope: SiteScope, words: string, site?: string): string {
  const added = site && !scope.excludedHosts.includes(site.toLowerCase()) ? `site:${site}` : undefined;
  return [scope.positive ?? added, words, ...scope.negatives].filter(Boolean).join(' ');
}

function gapQueries(input: QueryPlanInput): string[] {
  const scope = siteScope(input.originalQuery);
  const terms = extractImportantWords(input.originalQuery);
  const later = input.passIndex > 1;
  const queries: string[] = [];
  for (const gap of input.gaps) {
    const target = gap.match(/comparison evidence for target:\s*(.+)/i)?.[1]?.trim();
    if (target) queries.push(later ? scopedQuery(scope, `${target} ${terms}`, 'github.com') : scopedQuery(scope, `${target} comparison evidence ${terms}`));
    else if (/supported version|version-specific|compatibility|release notes/i.test(gap))
      queries.push(later ? scopedQuery(scope, `${terms} version compatibility changelog`) : scopedQuery(scope, `${terms} supported version release notes`));
    else if (/exact API|API behavior|API reference/i.test(gap))
      queries.push(later ? scopedQuery(scope, `${terms} API implementation`, 'github.com') : scopedQuery(scope, `${terms} API reference exact behavior`));
    else if (/disagree|conflict|contradict|disputed/i.test(gap))
      queries.push(later ? scopedQuery(scope, `${terms} disputed claim implementation`) : scopedQuery(scope, `${terms} disputed claim primary source`));
    else if (/user experience|opinions|practical experience/i.test(gap))
      queries.push(later ? scopedQuery(scope, `${terms} user experience`, 'reddit.com') : scopedQuery(scope, `${terms} user experience issue reports`));
    else if (/official docs/i.test(gap)) queries.push(later ? scopedQuery(scope, `${terms} official API reference`) : officialSiteQuery(input.originalQuery));
    else if (/implementation references/i.test(gap)) queries.push(later ? scopedQuery(scope, `${terms} source implementation`) : implementationQuery(input.originalQuery));
  }
  return queries;
}

// Edge product words only: "edge cases", "cutting edge", "edge runtime" and "edge network" must not route to Microsoft.
const MICROSOFT_EDGE_PATTERN = /\bmicrosoft edge\b|\bmsedge(?:driver)?\b|\bedge\s+(?:browsers?|extensions?|add-?ons?|(?:group\s+)?polic(?:y|ies)|devtools|webview2?|webdriver|driver|updates?|insider|for\s+business|enterprise|kiosk|sidebar|profiles?|sync)\b/i;

function officialSiteQuery(query: string) {
  const lower = query.toLowerCase();
  const scope = siteScope(query);
  const terms = extractImportantWords(query);
  if (lower.includes('vitest')) return scopedQuery(scope, terms, 'vitest.dev');
  if (lower.includes('playwright')) return scopedQuery(scope, terms, 'playwright.dev');
  if (MICROSOFT_EDGE_PATTERN.test(query)) return scopedQuery(scope, terms, 'learn.microsoft.com');
  return scopedQuery(scope, `${terms} official docs`);
}

function implementationQuery(query: string) {
  return scopedQuery(siteScope(query), extractImportantWords(query), 'github.com');
}

export function planSearchQueries(input: QueryPlanInput): string[] {
  if (input.passIndex === 0) return [normalizeWhitespace(input.originalQuery)];
  const scope = siteScope(input.originalQuery);
  const terms = extractImportantWords(input.originalQuery);
  const fallback = input.passIndex === 1
    ? [officialSiteQuery(input.originalQuery), implementationQuery(input.originalQuery)]
    : [scopedQuery(scope, `${terms} release notes`), scopedQuery(scope, `${terms} discussion`)];
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
