import { describe, expect, it, vi } from 'vitest';
import * as researchTypes from '../../src/orchestration/research-types.js';
import { createResearchOrchestrator } from '../../src/orchestration/research-orchestrator.js';
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

  it('answers when one bounded pass returns enough official evidence', async () => {
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['playwright edge channel'],
          evidence: [
            {
              title: 'Browsers | Playwright',
              url: 'https://playwright.dev/docs/browsers',
              sourceKind: 'official-docs',
              method: 'http',
              summary: 'Use branded browsers with channel values like msedge.',
              supports: ['Use msedge for Edge']
            },
            {
              title: 'BrowserType | Playwright',
              url: 'https://playwright.dev/docs/api/class-browsertype',
              sourceKind: 'official-api',
              method: 'http',
              summary: 'executablePath exists but is use-at-your-own-risk.',
              supports: ['executablePath is risky']
            }
          ],
          gaps: [],
          suggestedHeadlessUrls: [],
          exhaustedBudget: false
        })
      },
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'playwright installed edge executablePath vs channel' });

    expect(result.decision.action).toBe('answer');
    expect(result.evidence).toHaveLength(2);
  });

  it('requests another pass when evidence is too thin', async () => {
    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['ambiguous query'],
          evidence: [
            {
              title: 'Some blog',
              url: 'https://example.com/post',
              sourceKind: 'community',
              method: 'http',
              summary: 'A single community source only.',
              supports: ['One weak source']
            }
          ],
          gaps: [{ kind: 'needs-more-evidence', message: 'Need at least one official source.' }],
          suggestedHeadlessUrls: [],
          exhaustedBudget: false
        })
      },
      headlessFetch: vi.fn()
    });

    const result = await orchestrator.run({ query: 'ambiguous query' });

    expect(result.decision.action).toBe('research-again');
  });

  it('escalates one specific page to headless only when approved by the orchestrator', async () => {
    const headlessFetch = vi.fn().mockResolvedValue({
      status: 'ok',
      url: 'https://example.com/app',
      content: { title: 'Dynamic App', text: 'Rendered content with enough detail.' },
      metadata: {
        method: 'headless',
        cacheHit: false,
        browser: 'edge',
        navigationMs: 1200,
        truncated: false
      }
    });

    const orchestrator = createResearchOrchestrator({
      worker: {
        run: vi.fn().mockResolvedValue({
          searchQueries: ['dynamic app'],
          evidence: [],
          gaps: [{ kind: 'fetch-failed', message: 'HTTP was weak.' }],
          suggestedHeadlessUrls: ['https://example.com/app'],
          exhaustedBudget: false
        })
      },
      headlessFetch
    });

    const result = await orchestrator.run({ query: 'dynamic app' });

    expect(result.decision.action).toBe('escalate-headless');
    expect(headlessFetch).toHaveBeenCalledWith({ url: 'https://example.com/app' });
  });
});
