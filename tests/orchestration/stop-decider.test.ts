import { describe, expect, it } from 'vitest';
import { decideNextResearchStep } from '../../src/orchestration/stop-decider.js';
import type { ResearchEvidence } from '../../src/orchestration/research-types.js';

const evidence = (sourceKind: ResearchEvidence['sourceKind']): ResearchEvidence => ({
  title: sourceKind,
  url: `https://example.com/${sourceKind}`,
  sourceKind,
  method: 'http',
  summary: 'summary',
  supports: ['support']
});

describe('decideNextResearchStep', () => {
  it('answers when enough strong official evidence exists', () => {
    expect(
      decideNextResearchStep({
        evidence: [evidence('official-docs'), evidence('official-api')],
        suggestedHeadlessUrls: [],
        passIndex: 0,
        maxPasses: 3,
        headlessAttempts: 0,
        maxHeadlessAttempts: 2
      }).action
    ).toBe('answer');
  });

  it('continues when evidence is thin and budget remains', () => {
    expect(
      decideNextResearchStep({
        evidence: [evidence('community')],
        suggestedHeadlessUrls: [],
        passIndex: 0,
        maxPasses: 3,
        headlessAttempts: 0,
        maxHeadlessAttempts: 2
      }).action
    ).toBe('search-again');
  });

  it('escalates a weak high-value page when headless budget remains', () => {
    expect(
      decideNextResearchStep({
        evidence: [],
        suggestedHeadlessUrls: ['https://vitest.dev/guide/coverage.html'],
        passIndex: 0,
        maxPasses: 3,
        headlessAttempts: 0,
        maxHeadlessAttempts: 2
      })
    ).toEqual({ action: 'headless', url: 'https://vitest.dev/guide/coverage.html' });
  });

  it('stops with caveat when budget is exhausted', () => {
    expect(
      decideNextResearchStep({
        evidence: [evidence('community')],
        suggestedHeadlessUrls: [],
        passIndex: 2,
        maxPasses: 3,
        headlessAttempts: 2,
        maxHeadlessAttempts: 2
      }).action
    ).toBe('answer-with-caveat');
  });
});
