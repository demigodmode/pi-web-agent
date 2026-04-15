import { describe, expect, it } from 'vitest';
import * as researchTypes from '../../src/orchestration/research-types.js';
import type {
  ResearchWorkerResult,
  ResearchEvidence,
  ResearchGap,
  ResearchOrchestratorDecision
} from '../../src/orchestration/research-types.js';

describe('research orchestrator types', () => {
  it('exports a runtime module for orchestration types', () => {
    expect(researchTypes).toBeTypeOf('object');
  });

  it('supports evidence, gaps, and decisions for one bounded pass', () => {
    const evidence: ResearchEvidence = {
      title: 'BrowserType | Playwright',
      url: 'https://playwright.dev/docs/api/class-browsertype',
      sourceKind: 'official-docs',
      method: 'http',
      summary: 'The API docs describe channel and executablePath.',
      supports: ['Use channel for branded browsers', 'executablePath exists but is risky']
    };

    const gap: ResearchGap = {
      kind: 'needs-more-evidence',
      message: 'Need one source showing the recommended Edge usage pattern.'
    };

    const result: ResearchWorkerResult = {
      searchQueries: ['playwright installed edge channel executablePath'],
      evidence: [evidence],
      gaps: [gap],
      suggestedHeadlessUrls: [],
      exhaustedBudget: false
    };

    const decision: ResearchOrchestratorDecision = {
      action: 'answer',
      rationale: 'One official source is enough for this smoke test.',
      approvedEvidence: result.evidence
    };

    expect(result.evidence[0].sourceKind).toBe('official-docs');
    expect(decision.action).toBe('answer');
  });
});
