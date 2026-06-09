import { describe, expect, it } from 'vitest';
import { analyzeEvidenceQuality } from '../../src/orchestration/evidence-quality.js';
import type { ResearchEvidence, ResearchGap, ResearchLowValueOutcome } from '../../src/orchestration/research-types.js';

const evidence = (
  sourceKind: ResearchEvidence['sourceKind'],
  url: string,
  summary = `${sourceKind} summary`
): ResearchEvidence => ({
  title: url,
  url,
  sourceKind,
  method: 'http',
  summary,
  supports: [summary]
});

describe('analyzeEvidenceQuality', () => {
  it('counts source mix and distinct hosts', () => {
    const report = analyzeEvidenceQuality({
      evidence: [
        evidence('official-docs', 'https://vitest.dev/guide/coverage.html'),
        evidence('official-api', 'https://vitest.dev/config/coverage'),
        evidence('community', 'https://github.com/vitest-dev/vitest/discussions/1')
      ],
      gaps: [],
      lowValueOutcomes: []
    });

    expect(report.counts).toEqual({
      total: 3,
      official: 2,
      community: 1,
      thread: 0,
      packagePage: 0,
      distinctHosts: 2
    });
    expect(report.flags.hasOfficialEvidence).toBe(true);
    expect(report.flags.hasLowDiversity).toBe(false);
  });

  it('detects community-only and low-diversity evidence', () => {
    const report = analyzeEvidenceQuality({
      evidence: [
        evidence('community', 'https://example.com/a'),
        evidence('community', 'https://example.com/b')
      ],
      gaps: [],
      lowValueOutcomes: []
    });

    expect(report.flags.hasOnlyCommunityEvidence).toBe(true);
    expect(report.flags.hasLowDiversity).toBe(true);
    expect(report.caveatReasons).toContain('community-only');
    expect(report.caveatReasons).toContain('low-diversity');
  });

  it('detects unreadable direct and thread source gaps', () => {
    const gaps: ResearchGap[] = [
      { kind: 'fetch-failed', message: 'Direct URL could not be read reliably: https://example.com/a' },
      { kind: 'fetch-failed', message: 'Thread source could not be read reliably: https://reddit.com/r/x/comments/1' }
    ];

    const report = analyzeEvidenceQuality({ evidence: [], gaps, lowValueOutcomes: [] });

    expect(report.flags.hasUnreadableDirectSource).toBe(true);
    expect(report.flags.hasUnreadableThreadSource).toBe(true);
    expect(report.caveatReasons).toContain('unreadable-direct-source');
    expect(report.caveatReasons).toContain('unreadable-thread-source');
  });

  it('detects possible conflict markers conservatively', () => {
    const report = analyzeEvidenceQuality({
      evidence: [
        evidence('official-docs', 'https://example.com/docs', 'This API is recommended for new projects.'),
        evidence('issue-thread', 'https://github.com/org/repo/issues/1', 'Maintainers say this path is deprecated and not recommended.')
      ],
      gaps: [],
      lowValueOutcomes: []
    });

    expect(report.flags.hasPossibleConflict).toBe(true);
    expect(report.caveatReasons).toContain('possible-conflict');
  });

  it('records low-value bot-check outcomes as a caveat reason', () => {
    const lowValueOutcomes: ResearchLowValueOutcome[] = [
      { kind: 'bot-check', url: 'https://example.com', message: 'Headless hit a security verification page.' }
    ];

    const report = analyzeEvidenceQuality({ evidence: [], gaps: [], lowValueOutcomes });

    expect(report.caveatReasons).toContain('bot-check');
  });
});
