import { describe, expect, it } from 'vitest';
import { formatResearchContext } from '../../src/presentation/research-context.js';

describe('formatResearchContext', () => {
  it('omits empty lines and legacy metadata', () => {
    expect(formatResearchContext()).toEqual([]);
    expect(formatResearchContext({ executedQueries: [], openGaps: [], suggestedQueries: [] })).toEqual([]);
  });

  it('renders compact research facts and proposals', () => {
    expect(formatResearchContext({
      executedQueries: ['vite 6 ssr hmr'],
      openGaps: ['Need supported version details.'],
      suggestedQueries: ['vite 6 ssr hmr supported version release notes']
    })).toEqual([
      'Searched: "vite 6 ssr hmr"',
      'Still open: supported version details',
      'Try next: "vite 6 ssr hmr supported version release notes"'
    ]);
  });

  it('bounds all lines without breaking quoted queries or Unicode', () => {
    const lines = formatResearchContext({
      executedQueries: Array.from({ length: 9 }, (_, i) => `${i} ${'😀"'.repeat(200)}`),
      openGaps: Array.from({ length: 8 }, (_, i) => `Need ${i} ${'x'.repeat(250)}.`),
      suggestedQueries: Array.from({ length: 5 }, (_, i) => `${i} ${'y'.repeat(250)}`)
    });
    expect(lines).toHaveLength(3);
    expect(Array.from(lines.join('\n')).length).toBeLessThanOrEqual(1000);
    const searched = lines[0].slice('Searched: '.length);
    const queries: string[] = JSON.parse(`[${searched}]`);
    expect(queries).toHaveLength(6);
    for (const value of queries) expect(Array.from(JSON.stringify(value)).length).toBeLessThanOrEqual(120);
    expect(lines[1].slice('Still open: '.length).split('; ')).toHaveLength(4);
    expect(JSON.parse(`[${lines[2].slice('Try next: '.length)}]`)).toHaveLength(2);
    expect(lines.join('\n')).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  });

  it('redacts before clipping and retains benign URL parameters', () => {
    const query = 'Widget https://alice:pw@example.test/?token=secret&id=7';
    const text = formatResearchContext({
      executedQueries: [query], openGaps: [query], suggestedQueries: [query]
    }).join('\n');
    expect(text).not.toContain('alice');
    expect(text).not.toContain('pw@');
    expect(text).not.toContain('token=secret');
    expect(text).toContain('token=REDACTED');
    expect(text).toContain('id=7');
  });

  it('removes controls and deduplicates within each list', () => {
    const query = 'Widget\n\u001b[31mhttps://alice:pw@example.test/?token=secret&id=7\u001b]8;;https://bad.test\u0007link\u001b]8;;\u0007';
    const lines = formatResearchContext({
      executedQueries: [query, query],
      openGaps: [query, query],
      suggestedQueries: [query, query]
    });
    expect(lines).toHaveLength(3);
    expect(lines[0].split('\n')).toHaveLength(1);
    expect(lines[1].split('\n')).toHaveLength(1);
    expect(lines[2].split('\n')).toHaveLength(1);
    expect(lines.join('\n')).not.toMatch(/\u001b|\u0007/);
    expect(JSON.parse(`[${lines[0].slice('Searched: '.length)}]`)).toHaveLength(1);
    expect(lines[1].slice('Still open: '.length).split('; ')).toHaveLength(1);
    expect(JSON.parse(`[${lines[2].slice('Try next: '.length)}]`)).toHaveLength(1);
  });
});
