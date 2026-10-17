import { createResearchWorkflow } from '../orchestration/index.js';
import { synthesizeAnswer } from '../orchestration/answer-synthesizer.js';
import type { ResearchEvidence } from '../orchestration/research-types.js';
import { buildExplorePresentation } from '../presentation/explore-presentation.js';
import type { EvidenceCaveatReason } from '../orchestration/evidence-quality.js';
import type { WebExploreResponse } from '../types.js';
import { raceAbort, throwIfAborted } from '../abort.js';
import { buildEvidenceRecords } from './evidence-records.js';
import type { ResearchProgress } from '../orchestration/progress.js';

export function createWebExploreTool({
  explore = createResearchWorkflow()
}: {
  explore?:
    | {
        run: (input: { query: string; signal?: AbortSignal; onProgress?: (event: ResearchProgress) => void }) => Promise<{
          decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
          evidence: ResearchEvidence[];
          workerPass: unknown;
          metadata?: WebExploreResponse['metadata'];
          terminalFailure?: { code: string; message: string };
          requiredSourceEvidence?: ResearchEvidence[];
          requiredSourceFailures?: NonNullable<WebExploreResponse['requiredSourceFailures']>;
        }>;
      }
    | ((input: { query: string; signal?: AbortSignal; onProgress?: (event: ResearchProgress) => void }) => Promise<{
        decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
        evidence: ResearchEvidence[];
        workerPass: unknown;
        metadata?: WebExploreResponse['metadata'];
        terminalFailure?: { code: string; message: string };
        requiredSourceEvidence?: ResearchEvidence[];
        requiredSourceFailures?: NonNullable<WebExploreResponse['requiredSourceFailures']>;
      }>);
} = {}) {
  const runExplore = typeof explore === 'function' ? explore : explore.run.bind(explore);

  return async function webExplore({ query, signal, onProgress }: { query: string; signal?: AbortSignal; onProgress?: (event: ResearchProgress) => void }) {
    throwIfAborted(signal);
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      const result: WebExploreResponse = {
        status: 'error',
        findings: [],
        sources: [],
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      };

      return {
        ...result,
        presentation: buildExplorePresentation(result)
      };
    }

    const safeProgress = onProgress ? (event: ResearchProgress) => {
      try { onProgress(event); } catch { /* Display callbacks must not fail research. */ }
    } : undefined;
    const run = runExplore({ query: normalizedQuery, ...(signal ? { signal } : {}), ...(safeProgress ? { onProgress: safeProgress } : {}) });
    // Backstop: Pi waits for this promise, so answer the cancel right away even if
    // some layer underneath is slow to stop. The run itself keeps its lease in
    // extension.ts until it really settles.
    const result = signal ? await raceAbort(run, signal) : await run;
    if (!result.terminalFailure) {
      const counts = result.metadata?.budget ?? {
        searches: result.metadata?.searchPasses ?? 0,
        fetches: result.metadata?.fetchedPages ?? 0,
        headless: result.metadata?.headlessAttempts ?? 0
      };
      safeProgress?.({ phase: 'complete', searches: counts.searches, fetches: counts.fetches, headless: counts.headless });
    }
    if (result.terminalFailure) {
      const required = result.requiredSourceEvidence ?? [];
      const evidence = buildEvidenceRecords(required);
      const failed: WebExploreResponse = {
        status: 'error',
        findings: required.map((item) => item.summary),
        sources: required.map((item) => ({ title: item.title, url: item.url, ...(item.requestedUrl ? { requestedUrl: item.requestedUrl } : {}), method: item.method })),
        evidence,
        findingSourceIds: required.map((_, index) => [evidence[index]!.id]),
        error: result.terminalFailure,
        metadata: result.metadata,
        requiredSourceFailures: result.requiredSourceFailures ?? result.metadata?.requiredSourceFailures
      };
      return { ...failed, presentation: buildExplorePresentation(failed) };
    }

    const required = result.requiredSourceEvidence ?? [];
    const publicEvidence = [...required, ...result.evidence.filter((item) => !required.some((direct) => direct.requestedUrl === item.requestedUrl || direct.url === item.url))].slice(0, required.length + 5);
    const selectedEvidence = [...required, ...result.evidence.filter((item) => !required.some((direct) => direct.requestedUrl === item.requestedUrl || direct.url === item.url))].slice(0, 5);
    const evidence = buildEvidenceRecords(publicEvidence);
    const sources = publicEvidence.map((item) => ({
      title: item.title,
      url: item.url,
      ...(item.requestedUrl ? { requestedUrl: item.requestedUrl } : {}),
      method: item.method
    }));
    const reasons = (result.metadata?.caveatReasons ?? []) as EvidenceCaveatReason[];
    const decisionPartial = result.decision.action !== 'answer';
    const coveragePartial = reasons.includes('partial-search-coverage');
    const threadCommentsPartial = reasons.includes('partial-thread-comments');
    const synthesized = synthesizeAnswer({
      evidence: selectedEvidence,
      partial: decisionPartial || coveragePartial || threadCommentsPartial,
      // A confident answer with partial coverage mentions only the coverage, not unrelated quality notes.
      caveatReasons: decisionPartial ? reasons : reasons.filter((reason) => reason === 'partial-search-coverage' || reason === 'partial-thread-comments'),
      missingComparisonTargets: result.metadata?.missingComparisonTargets
    });

    const shaped: WebExploreResponse = {
      status: 'ok',
      findings: synthesized.findings,
      sources,
      evidence,
      findingSourceIds: selectedEvidence.map((item) => [evidence[publicEvidence.indexOf(item)]!.id]),
      caveat: synthesized.caveat,
      metadata: result.metadata,
      requiredSourceFailures: result.requiredSourceFailures ?? result.metadata?.requiredSourceFailures
    };

    return {
      ...shaped,
      presentation: buildExplorePresentation(shaped)
    };
  };
}
