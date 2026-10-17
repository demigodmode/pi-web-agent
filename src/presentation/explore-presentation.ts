import type { FetchMethod, WebExploreResponse } from '../types.js';
import type { PresentationEnvelope } from './types.js';
import { attemptLines } from './search-presentation.js';

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

export function buildExplorePresentation(result: WebExploreResponse): PresentationEnvelope {
  if (result.status === 'error') {
    return {
      mode: 'compact',
      views: {
        compact: `Research failed: ${sanitizeTerminalText(result.error?.message ?? 'Unknown research failure.')}`
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
    ...evidenceLines,
    internalSummary ? `\n${internalSummary}` : undefined
  ]
    .filter((line) => line !== undefined)
    .join('\n');
  const verbose = [
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

  const compact = hasEvidence
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
