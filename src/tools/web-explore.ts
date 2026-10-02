import { createResearchWorkflow } from '../orchestration/index.js';
import { synthesizeAnswer } from '../orchestration/answer-synthesizer.js';
import type { ResearchEvidence } from '../orchestration/research-types.js';
import { buildExplorePresentation } from '../presentation/explore-presentation.js';
import type { EvidenceCaveatReason } from '../orchestration/evidence-quality.js';
import type { WebExploreResponse } from '../types.js';
import { raceAbort, throwIfAborted } from '../abort.js';

export function createWebExploreTool({
  explore = createResearchWorkflow()
}: {
  explore?:
    | {
        run: (input: { query: string; signal?: AbortSignal }) => Promise<{
          decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
          evidence: ResearchEvidence[];
          workerPass: unknown;
          metadata?: WebExploreResponse['metadata'];
          terminalFailure?: { code: string; message: string };
        }>;
      }
    | ((input: { query: string; signal?: AbortSignal }) => Promise<{
        decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
        evidence: ResearchEvidence[];
        workerPass: unknown;
        metadata?: WebExploreResponse['metadata'];
        terminalFailure?: { code: string; message: string };
      }>);
} = {}) {
  const runExplore = typeof explore === 'function' ? explore : explore.run.bind(explore);

  return async function webExplore({ query, signal }: { query: string; signal?: AbortSignal }) {
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

    const run = runExplore({ query: normalizedQuery, ...(signal ? { signal } : {}) });
    // Backstop: Pi waits for this promise, so answer the cancel right away even if
    // some layer underneath is slow to stop. The run itself keeps its lease in
    // extension.ts until it really settles.
    const result = signal ? await raceAbort(run, signal) : await run;
    if (result.terminalFailure) {
      const failed: WebExploreResponse = {
        status: 'error',
        findings: [],
        sources: [],
        error: result.terminalFailure,
        metadata: result.metadata
      };
      return { ...failed, presentation: buildExplorePresentation(failed) };
    }

    const sources = result.evidence.slice(0, 4).map((item) => ({
      title: item.title,
      url: item.url,
      method: item.method
    }));
    const reasons = (result.metadata?.caveatReasons ?? []) as EvidenceCaveatReason[];
    const decisionPartial = result.decision.action !== 'answer';
    const coveragePartial = reasons.includes('partial-search-coverage');
    const synthesized = synthesizeAnswer({
      evidence: result.evidence,
      partial: decisionPartial || coveragePartial,
      // A confident answer with partial coverage mentions only the coverage, not unrelated quality notes.
      caveatReasons: decisionPartial ? reasons : ['partial-search-coverage']
    });

    const shaped: WebExploreResponse = {
      status: 'ok',
      findings: synthesized.findings,
      sources,
      caveat: synthesized.caveat,
      metadata: result.metadata
    };

    return {
      ...shaped,
      presentation: buildExplorePresentation(shaped)
    };
  };
}
