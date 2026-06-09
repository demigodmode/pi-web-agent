import { describe, expect, it } from 'vitest';
import { synthesizeAnswer } from '../../src/orchestration/answer-synthesizer.js';
import type { ResearchEvidence } from '../../src/orchestration/research-types.js';

const evidence = (sourceKind: ResearchEvidence['sourceKind'], summary: string): ResearchEvidence => ({
  title: sourceKind,
  url: `https://example.com/${sourceKind}`,
  sourceKind,
  method: 'http',
  summary,
  supports: [summary]
});

describe('synthesizeAnswer', () => {
  it('uses official evidence as primary findings', () => {
    expect(
      synthesizeAnswer({
        evidence: [
          evidence('official-docs', 'Set coverage.provider to v8.'),
          evidence('official-api', 'Install @vitest/coverage-v8.')
        ],
        partial: false
      }).findings
    ).toEqual(['Set coverage.provider to v8.', 'Install @vitest/coverage-v8.']);
  });

  it('keeps community evidence as practical context', () => {
    expect(
      synthesizeAnswer({
        evidence: [
          evidence('official-docs', 'Use channel for branded browsers.'),
          evidence('community', 'Teams use executablePath for custom corporate builds.')
        ],
        partial: false
      }).findings
    ).toEqual([
      'Use channel for branded browsers.',
      'Community/practical context: Teams use executablePath for custom corporate builds.'
    ]);
  });

  it('adds caveat for partial evidence', () => {
    expect(
      synthesizeAnswer({ evidence: [evidence('community', 'One source only.')], partial: true }).caveat
    ).toBe('Evidence is partial, so this answer is based on the strongest source found within the bounded research budget.');
  });

  it('explains community-only and low-diversity caveats specifically', () => {
    const result = synthesizeAnswer({
      evidence: [evidence('community', 'One source only.')],
      partial: true,
      caveatReasons: ['community-only', 'low-diversity']
    });

    expect(result.caveat).toBe(
      'Evidence is partial: the strongest readable sources were mostly community/practical context, and the source set was narrow.'
    );
  });

  it('explains unreadable thread and possible conflict caveats specifically', () => {
    const result = synthesizeAnswer({
      evidence: [evidence('official-docs', 'Official source.')],
      partial: true,
      caveatReasons: ['unreadable-thread-source', 'possible-conflict']
    });

    expect(result.caveat).toBe(
      'Evidence is partial: one or more thread sources could not be read reliably, and readable sources include cautionary or possibly conflicting guidance.'
    );
  });
});
