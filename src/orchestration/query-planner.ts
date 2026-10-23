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

const SITE_OPERATOR_TOKEN = /^(-?)site:([a-z0-9.-]+(?:\/\S*)?)$/i;
const URL_TOKEN = /^["'(\[]*https?:\/\//i;
const SITE_HOST = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*(?:\\/[^\\s()]*)?';
const SITE_OR_CHAIN = `site:${SITE_HOST}(?:\\s+or\\s+site:${SITE_HOST})+`;
/** Two or more positive site: operators joined by OR, optionally wrapped in one pair of parens. */
const SITE_OR_GROUP = new RegExp(`(^|\\s)(?:\\(\\s*(${SITE_OR_CHAIN})\\s*\\)|(${SITE_OR_CHAIN}))(?=$|[\\s,;.!?])`, 'gi');

/** A whitespace token's core: wrapping quotes and brackets off, trailing punctuation off. */
function tokenCore(piece: string) {
  return piece.replace(/^["'(\[]+/, '').replace(/[)\]"',;.!?:]+$/, '');
}

/**
 * Splits the query into plain words and site: operators. A URL is always words. An operator
 * is removed with its surrounding punctuation, so no comma or bracket is left behind.
 * An OR'd group of positive operators is one positive, kept as "(site:a OR site:b)".
 */
function parseSiteOperators(query: string) {
  const words: string[] = [];
  const positives: string[] = [];
  const negatives: string[] = [];
  const parseText = (text: string) => {
    for (const raw of text.split(' ')) {
      if (!raw) continue;
      if (URL_TOKEN.test(raw)) {
        words.push(raw);
        continue;
      }
      const pieces = raw.split(',');
      const matches = pieces.map((piece) => tokenCore(piece).match(SITE_OPERATOR_TOKEN));
      if (!matches.some(Boolean)) {
        words.push(raw);
        continue;
      }
      pieces.forEach((piece, index) => {
        const match = matches[index];
        if (match) (match[1] ? negatives : positives).push(`${match[1]}site:${match[2]}`);
        else if (piece.trim()) words.push(piece.trim());
      });
    }
  };
  const normalized = normalizeWhitespace(query);
  let cursor = 0;
  for (const match of normalized.matchAll(SITE_OR_GROUP)) {
    const inner = match[2] ?? match[3];
    const start = match.index + match[1].length;
    parseText(normalized.slice(cursor, start));
    positives.push(`(${inner.split(/\s+or\s+/i).map((operator) => `site:${operator.slice('site:'.length)}`).join(' OR ')})`);
    cursor = match.index + match[0].length;
  }
  parseText(normalized.slice(cursor));
  return { words, positives, negatives };
}

function extractImportantWords(query: string) {
  return parseSiteOperators(query).words
    .filter((word) => !URL_TOKEN.test(word) && /[\p{L}\p{N}]/u.test(word))
    .join(' ')
    .replace(/\b(find|current|tell|me|how|to|the|and|with|for|in|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function siteScope(query: string): SiteScope {
  const { positives, negatives } = parseSiteOperators(query);
  return {
    positive: positives[0],
    negatives,
    excludedHosts: negatives.map((operator) => operator.slice('-site:'.length).toLowerCase())
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
