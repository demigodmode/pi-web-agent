import { describe, expect, it } from 'vitest';
import { buildMetrics, evaluateVerdict } from '../scripts/live-web-eval.js';

describe('live web eval fallback detection', () => {
  it('flags shell network fallbacks after web_explore', () => {
    const metrics = buildMetrics([
      {
        toolName: 'web_explore',
        args: { query: 'DuckDuckGo HTML scraping pitfalls' },
        startedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        toolName: 'bash',
        args: { command: "powershell -Command \"Invoke-WebRequest https://html.duckduckgo.com/html/?q=nodejs\"" },
        startedAt: '2026-01-01T00:00:01.000Z'
      }
    ]);

    expect(metrics.networkShellFallbacksAfterExplore).toBe(1);
    expect(evaluateVerdict(metrics, 'answer text')).toEqual({
      verdict: 'mixed',
      notes: ['network-capable shell fallback after web_explore (1)']
    });
  });

  it('does not flag local shell checks', () => {
    const metrics = buildMetrics([
      {
        toolName: 'bash',
        args: { command: "powershell -Command \"Test-Path 'learning/_index.md'\"" },
        startedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        toolName: 'web_explore',
        args: { query: 'Vitest coverage docs' },
        startedAt: '2026-01-01T00:00:01.000Z'
      }
    ]);

    expect(metrics.networkShellFallbacksAfterExplore).toBe(0);
    expect(evaluateVerdict(metrics, 'answer text').verdict).toBe('pass');
  });
});
