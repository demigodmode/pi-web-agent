import { createResearchWorkflow } from '../orchestration/index.js';
import { synthesizeAnswer } from '../orchestration/answer-synthesizer.js';
import type { ResearchEvidence } from '../orchestration/research-types.js';
import { buildExplorePresentation } from '../presentation/explore-presentation.js';
import type { WebExploreResponse } from '../types.js';

export function createWebExploreTool({
  explore = createResearchWorkflow()
}: {
  explore?:
    | {
        run: (input: { query: string }) => Promise<{
          decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
          evidence: ResearchEvidence[];
          workerPass: unknown;
          metadata?: WebExploreResponse['metadata'];
        }>;
      }
    | ((input: { query: string }) => Promise<{
        decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
        evidence: ResearchEvidence[];
        workerPass: unknown;
        metadata?: WebExploreResponse['metadata'];
      }>);
} = {}) {
  const runExplore = typeof explore === 'function' ? explore : explore.run.bind(explore);

  return async function webExplore({ query }: { query: string }) {
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

    const result = await runExplore({ query: normalizedQuery });
    const sources = result.evidence.slice(0, 4).map((item) => ({
      title: item.title,
      url: item.url,
      method: item.method
    }));
    const synthesized = synthesizeAnswer({
      evidence: result.evidence,
      partial: result.decision.action !== 'answer'
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
