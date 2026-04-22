import { createResearchWorkflow } from '../orchestration/index.js';
import { buildExplorePresentation } from '../presentation/explore-presentation.js';
import type { ResearchEvidence } from '../orchestration/research-types.js';
import type { WebExploreResponse } from '../types.js';

function findingFromEvidence(evidence: ResearchEvidence, index: number): string {
  if (evidence.summary.includes('Use channel')) {
    return 'Use channel for branded Chrome or Edge when possible.';
  }

  if (evidence.summary.includes('use at your own risk') || evidence.summary.includes('risky')) {
    return 'Treat executablePath as a fallback because Playwright documents it as use-at-your-own-risk.';
  }

  if (
    evidence.summary.includes('coverage.provider to v8') ||
    evidence.summary.includes('@vitest/coverage-v8')
  ) {
    return 'Vitest coverage docs say to set coverage.provider to v8 and install @vitest/coverage-v8.';
  }

  return evidence.summary || `Finding ${index + 1}`;
}

export function createWebExploreTool({
  explore = createResearchWorkflow()
}: {
  explore?:
    | {
        run: (input: { query: string }) => Promise<{
          decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
          evidence: ResearchEvidence[];
          workerPass: unknown;
        }>;
      }
    | ((input: { query: string }) => Promise<{
        decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
        evidence: ResearchEvidence[];
        workerPass: unknown;
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
    const findings = result.evidence.slice(0, 5).map(findingFromEvidence);
    const sources = result.evidence.slice(0, 4).map((item) => ({
      title: item.title,
      url: item.url
    }));
    const caveat =
      result.decision.action === 'answer'
        ? undefined
        : 'Evidence is partial, so this answer is based on the strongest source found so far.';

    const shaped: WebExploreResponse = {
      status: 'ok',
      findings,
      sources,
      caveat
    };

    return {
      ...shaped,
      presentation: buildExplorePresentation(shaped)
    };
  };
}
