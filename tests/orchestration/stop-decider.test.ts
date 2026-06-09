import { describe, expect, it } from 'vitest';
import { decideNextResearchStep } from '../../src/orchestration/stop-decider.js';
import type { ResearchEvidence } from '../../src/orchestration/research-types.js';
import type { EvidenceQualityReport } from '../../src/orchestration/evidence-quality.js';

const evidence = (sourceKind: ResearchEvidence['sourceKind'], url = `https://example.com/${sourceKind}`): ResearchEvidence => ({
  title: sourceKind,
  url,
  sourceKind,
  method: 'http',
  summary: 'summary',
  supports: ['support']
});

const officialDocsEvidence = evidence('official-docs', 'https://vitest.dev/guide/coverage.html');
const officialApiEvidence = evidence('official-api', 'https://vitest.dev/config/coverage');
const officialDiscussionEvidence = evidence('official-discussion', 'https://vitest.dev/discussions/coverage');

const quality = (overrides: {
  counts?: Partial<EvidenceQualityReport['counts']>;
  flags?: Partial<EvidenceQualityReport['flags']>;
  caveatReasons?: EvidenceQualityReport['caveatReasons'];
} = {}): EvidenceQualityReport => ({
  counts: {
    total: 2,
    official: 1,
    community: 1,
    thread: 0,
    packagePage: 0,
    distinctHosts: 2,
    ...overrides.counts
  },
  flags: {
    hasOfficialEvidence: true,
    hasOnlyCommunityEvidence: false,
    hasLowDiversity: false,
    hasUnreadableDirectSource: false,
    hasUnreadableThreadSource: false,
    hasPossibleConflict: false,
    ...overrides.flags
  },
  caveatReasons: overrides.caveatReasons ?? []
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

  it('continues searching when evidence is low-diversity and budget remains', () => {
    expect(
      decideNextResearchStep({
        evidence: [officialDocsEvidence, officialDiscussionEvidence],
        suggestedHeadlessUrls: [],
        passIndex: 0,
        maxPasses: 3,
        headlessAttempts: 0,
        maxHeadlessAttempts: 2,
        quality: quality({
          counts: { distinctHosts: 1 },
          flags: { hasLowDiversity: true },
          caveatReasons: ['low-diversity']
        })
      })
    ).toEqual({ action: 'search-again' });
  });

  it('answers with caveat when evidence is low-diversity and budget is exhausted', () => {
    expect(
      decideNextResearchStep({
        evidence: [officialDocsEvidence, officialDiscussionEvidence],
        suggestedHeadlessUrls: [],
        passIndex: 2,
        maxPasses: 3,
        headlessAttempts: 0,
        maxHeadlessAttempts: 2,
        quality: quality({
          counts: { distinctHosts: 1 },
          flags: { hasLowDiversity: true },
          caveatReasons: ['low-diversity']
        })
      })
    ).toEqual({ action: 'answer-with-caveat' });
  });

  it('answers with caveat when sources may conflict', () => {
    expect(
      decideNextResearchStep({
        evidence: [officialDocsEvidence, officialApiEvidence],
        suggestedHeadlessUrls: [],
        passIndex: 0,
        maxPasses: 3,
        headlessAttempts: 0,
        maxHeadlessAttempts: 2,
        quality: quality({
          flags: { hasPossibleConflict: true },
          caveatReasons: ['possible-conflict']
        })
      })
    ).toEqual({ action: 'answer-with-caveat' });
  });
});
