import type { FetchMethod, WebExploreResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';
import { attemptLines } from './search-presentation.js';
import { clipTerminalText } from './explore-call.js';

function internalReaderLabel(method?: FetchMethod) {
  if (method === 'headless') return 'web_fetch_headless';
  if (method === 'firecrawl') return 'firecrawl';
  if (method === 'http') return 'web_fetch';
  if (method === 'github') return 'github';
  if (method === 'pdf') return 'pdf';
  if (method === 'youtube') return 'youtube';
  return 'web_explore';
}

export function sanitizeTerminalText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}

function buildLegacyExplorePresentation(result: WebExploreResponse): PresentationEnvelope {
  const notices = (result.requiredSourceFailures ?? []).map((failure) =>
    sanitizeTerminalText(`Required source not read: ${failure.url}. ${failure.message} The requirements of this source were not checked.`)
  );
  if (result.status === 'error') {
    const successful = result.sources.length
      ? [`Reviewed ${result.sources.length} successful required source${result.sources.length === 1 ? '' : 's'}:`, ...result.sources.map((source) => `- [${internalReaderLabel(source.method)}] ${sanitizeTerminalText(source.title)}: ${sanitizeTerminalText(source.url)}`)]
      : [];
    return {
      mode: 'compact',
      views: {
        compact: [...successful, ...notices, `Research failed: ${sanitizeTerminalText(result.error?.message ?? 'Unknown research failure.')}`].join('\n')
      }
    };
  }

  const fanoutProviders = result.metadata?.fanoutProviders;
  const fanoutSkipped = result.metadata?.fanoutSkipped;
  const fanoutNote = fanoutProviders?.length
    ? ` (fanout: ${fanoutProviders.join(', ')}${fanoutSkipped?.length ? `; skipped: ${fanoutSkipped.join(', ')}` : ''})`
    : fanoutSkipped?.length
      ? ` (fanout; skipped: ${fanoutSkipped.join(', ')})`
      : '';
  const internalSummary = result.metadata
    ? `Internal research: web_search ×${result.metadata.searchPasses}${fanoutNote}, web_fetch ×${result.metadata.fetchedPages}, web_fetch_headless ×${result.metadata.headlessAttempts}`
    : undefined;
  const hasEvidence = result.findings.length > 0 || result.sources.length > 0;
  const evidenceLines = hasEvidence
    ? result.findings.map((finding, index) => `- [${internalReaderLabel(result.sources[index]?.method)}] ${sanitizeTerminalText(finding)}`)
    : ['No usable evidence found.'];
  const verboseFindings = result.findings.map((finding, index) => {
    const ids = result.findingSourceIds?.[index] ?? [];
    const sourceIds = ids.map(sanitizeTerminalText);
    return `- [${internalReaderLabel(result.sources[index]?.method)}] ${sourceIds.length ? `[${sourceIds.join(', ')}] ` : ''}${sanitizeTerminalText(finding)}`;
  });
  const preview = [
    ...notices,
    ...evidenceLines,
    internalSummary ? `\n${internalSummary}` : undefined
  ]
    .filter((line) => line !== undefined)
    .join('\n');
  const verbose = [
    ...notices,
    'Findings',
    ...(verboseFindings.length ? verboseFindings : evidenceLines),
    '',
    'Sources',
    ...result.sources.map((source) => `- [${internalReaderLabel(source.method)}] ${sanitizeTerminalText(source.title)}: ${sanitizeTerminalText(source.url)}`),
    ...(result.evidence?.length ? [
      '',
      'Evidence',
      ...result.evidence.flatMap((item) => [
        `- [${sanitizeTerminalText(item.id)}] ${sanitizeTerminalText(item.title)}: ${sanitizeTerminalText(item.url)}`,
        ...item.excerpts.map((excerpt) => `  ${excerpt.anchor ? `#${sanitizeTerminalText(excerpt.anchor)}: ` : ''}${sanitizeTerminalText(excerpt.text)}`)
      ])
    ] : []),
    internalSummary ? `\nInternal tools\n${internalSummary}` : undefined,
    result.caveat ? `\nCaveat\n${sanitizeTerminalText(result.caveat)}` : undefined,
    attemptLines(result.metadata?.attempts)
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const compact = notices.length
    ? notices.join('\n')
    : hasEvidence
    ? `Reviewed ${result.sources.length} sources · synthesized answer with ${result.findings.length} findings`
    : 'No usable evidence found';

  return {
    mode: 'compact',
    views: {
      compact,
      preview,
      verbose
    },
    metrics: {
      sourceCount: result.sources.length,
      resultCount: result.findings.length
    },
    sources: result.sources.map((source) => ({
      ...source,
      title: sanitizeTerminalText(source.title),
      url: sanitizeTerminalText(source.url)
    }))
  };
}

function summaryLine(result: WebExploreResponse) {
  const stats = result.metadata?.presentationStats;
  if (!stats || result.durationMs === undefined) return undefined;
  const elapsed = result.durationMs < 1_000 ? '<1s' : `${Math.floor(result.durationMs / 1_000)}s`;
  return `${stats.searches} searches · ${stats.pagesRead} pages read · ${elapsed}`;
}

function requiredNotices(result: WebExploreResponse, compact = false) {
  const failures = result.requiredSourceFailures ?? [];
  if (!compact) return failures.map((failure) => sanitizeTerminalText(
    `Required source not read: ${failure.url}. ${failure.message} The requirements of this source were not checked.`
  ));
  const grouped = new Map<string, { message: string; urls: string[] }>();
  for (const failure of failures) {
    const message = sanitizeTerminalText(failure.message);
    const key = `${failure.reason}\u0000${message}`;
    const group = grouped.get(key) ?? { message, urls: [] };
    group.urls.push(sanitizeTerminalText(failure.url));
    grouped.set(key, group);
  }
  return [...grouped.values()].map(({ message, urls }) =>
    `Required sources not read: ${urls.join(', ')}. ${message} The requirements were not checked for these sources.`
  );
}

const methodLabels = {
  http: 'HTTP',
  headless: 'Browser',
  firecrawl: 'Firecrawl',
  github: 'GitHub',
  pdf: 'PDF',
  youtube: 'YouTube',
  repo: 'Repository'
} as const;

/** Terminal-only views built from execution-time statistics; full evidence stays on the response. */
export function buildExplorePresentation(result: WebExploreResponse): PresentationEnvelope {
  const summary = summaryLine(result);
  const stats = result.metadata?.presentationStats;
  if (!summary || !stats) return buildLegacyExplorePresentation(result);

  const failureNotices = requiredNotices(result);
  const compactNotices = requiredNotices(result, true);
  const noEvidence = result.findings.length === 0 && result.sources.length === 0;
  const error = result.status === 'error'
    ? `Research failed: ${sanitizeTerminalText(result.error?.message ?? 'Unknown research failure.')}`
    : undefined;
  const limitation = !error && result.caveat ? sanitizeTerminalText(result.caveat) : undefined;
  const compact = [summary, ...compactNotices, error ?? (noEvidence ? 'No usable evidence found.' : limitation)].filter(Boolean).join('\n');
  const previewFindings = result.findings.slice(0, 3).map((finding) =>
    `- ${clipTerminalText(sanitizeTerminalText(finding), 240)}`
  );
  const preview = [
    summary,
    ...failureNotices,
    error ?? (noEvidence ? 'No usable evidence found.' : limitation),
    !error && previewFindings.length ? '\nFindings\n' + previewFindings.join('\n') : undefined
  ].filter(Boolean).join('\n');
  const verboseFindings = result.findings.map((finding, index) => {
    const ids = (result.findingSourceIds?.[index] ?? []).map(sanitizeTerminalText);
    return `- ${ids.length ? `[${ids.join(', ')}] ` : ''}${sanitizeTerminalText(finding)}`;
  });
  const retrieval = Object.entries(stats.methods)
    .filter((entry): entry is [keyof typeof methodLabels, number] => entry[1] !== undefined && entry[1] > 0)
    .map(([method, count]) => `${methodLabels[method]}: ${count}`);
  const verbose = [
    summary,
    ...failureNotices,
    error,
    noEvidence ? 'No usable evidence found.' : undefined,
    stats.executedQueries.length ? `Queries\n${stats.executedQueries.map(sanitizeTerminalText).join('\n')}` : undefined,
    verboseFindings.length ? `Findings\n${verboseFindings.join('\n')}` : undefined,
    result.sources.length ? `Sources\n${result.sources.map((source) => `- [${internalReaderLabel(source.method)}] ${sanitizeTerminalText(source.title)}: ${sanitizeTerminalText(source.url)}`).join('\n')}` : undefined,
    result.evidence?.length ? `Evidence\n${result.evidence.flatMap((item) => [
      `- [${sanitizeTerminalText(item.id)}] ${sanitizeTerminalText(item.title)}: ${sanitizeTerminalText(item.url)}`,
      ...item.excerpts.map((excerpt) => `  ${excerpt.anchor ? `#${sanitizeTerminalText(excerpt.anchor)}: ` : ''}${sanitizeTerminalText(excerpt.text)}`)
    ]).join('\n')}` : undefined,
    result.caveat ? `Caveat\n${sanitizeTerminalText(result.caveat)}` : undefined,
    ['Retrieval', ...retrieval, `Failed reads: ${stats.failedReads}`].join('\n'),
    attemptLines(result.metadata?.attempts)
  ].filter(Boolean).join('\n\n');

  return {
    mode: 'compact',
    views: { compact, preview, verbose },
    metrics: { durationMs: result.durationMs, sourceCount: result.sources.length, resultCount: result.findings.length },
    sources: result.sources.map((source) => ({ ...source, title: sanitizeTerminalText(source.title), url: sanitizeTerminalText(source.url) }))
  };
}
