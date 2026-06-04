const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_name',
  'fbclid',
  'gclid'
]);

function stripTrailingPunctuation(raw: string): string {
  let next = raw.trim();

  while (/[),.;!?\]]$/.test(next)) {
    const last = next.at(-1);
    if (last === ')' && next.includes('(') && next.lastIndexOf('(') > next.lastIndexOf(')')) break;
    next = next.slice(0, -1);
  }

  return next;
}

function normalizeDirectUrl(raw: string): string | undefined {
  try {
    const url = new URL(stripTrailingPunctuation(raw));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function extractDirectUrls(query: string): string[] {
  const matches = query.match(/https?:\/\/\S+/gi) ?? [];
  const urls = new Set<string>();

  for (const match of matches) {
    const normalized = normalizeDirectUrl(match);
    if (normalized) urls.add(normalized);
  }

  return [...urls];
}
