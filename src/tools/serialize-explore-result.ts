import type { WebExploreResponse } from '../types.js';
import { endWithPeriod } from '../presentation/explore-display-text.js';
import { searchUnavailableNotices } from '../presentation/explore-presentation.js';
import { formatResearchContext } from '../presentation/research-context.js';

const cutNotice = (ids: string[]) => ids.length
  ? `${ids.join(ids.length === 2 ? ' and ' : ', ')} had more relevant text that didn't fit. Re-read a link with a narrower question if you need it.`
  : undefined;

export function serializeExploreResult(result: WebExploreResponse): string {
  const searchNotices = searchUnavailableNotices(result);
  const requiredNotices = (result.requiredSourceFailures ?? []).map((failure) =>
    `Required source not read: ${failure.url}. ${endWithPeriod(failure.message)} The requirements of this source were not checked.`);
  const terminalError = result.status === 'error' ? `Research failed: ${result.error?.message ?? 'Unknown research failure.'}` : undefined;
  const selection = result.modelResult;
  const context = selection?.contextLines.join('\n') ?? formatResearchContext(result.metadata).join('\n');
  if (result.findings.length === 0 && result.sources.length === 0) {
    return (terminalError
      ? [...searchNotices, ...requiredNotices, terminalError, context]
      : [...searchNotices, ...requiredNotices, 'No usable evidence found.', context, result.caveat === 'No usable sources were found.' ? undefined : result.caveat])
      .filter(Boolean).join('\n\n');
  }
  const findings = selection ? selection.findings.map((finding) => finding.sourceIds.length ? `[${finding.sourceIds.join(', ')}] ${finding.text}` : finding.text)
    : result.findings.map((finding, index) => { const ids = result.findingSourceIds?.[index] ?? []; return ids.length ? `[${ids.join(', ')}] ${finding}` : finding; });
  const evidence = result.evidence?.map((item) => {
    const targets = new Set<string>();
    for (const coverage of item.samePassageAs ?? []) {
      const target = result.evidence?.find((candidate) => candidate.id === coverage.sourceId)?.excerpts[coverage.excerptIndex];
      if (target) targets.add(`${coverage.relation === 'same' ? 'same passage as' : 'covered by a passage from'} ${coverage.sourceId}`);
    }
    return [
      `[${item.id}] ${item.title}: ${item.url}`,
      item.retrievalCut ? '  (document longer than what was read)' : undefined,
      ...item.excerpts.map((excerpt) => `  - ${excerpt.anchor ? `#${excerpt.anchor}: ` : ''}${excerpt.text}`),
      ...[...targets].map((target) => `  ${target}`),
      !selection && item.truncated ? '  (source excerpt truncated)' : undefined
    ].filter(Boolean).join('\n');
  }).join('\n');
  const cut = selection ? cutNotice(result.metadata?.resultLength?.cutSourceIds ?? []) : undefined;
  return [...searchNotices, ...requiredNotices, findings.join('\n\n'), evidence ? `Evidence:\n${evidence}` : result.sources.length ? `Sources:\n${result.sources.map((source) => `- ${source.title}: ${source.url}`).join('\n')}` : undefined, cut, context, result.caveat, terminalError]
    .filter(Boolean).join('\n\n');
}
