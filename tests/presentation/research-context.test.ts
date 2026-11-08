import { describe, expect, it } from 'vitest';
import {
  formatPriorityContext,
  formatResearchContext,
  formatSearchedContext
} from '../../src/presentation/research-context.js';

const codePoints = (text: string) => Array.from(text).length;

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

  it('keeps the first proposal before gaps or a second proposal in a tight priority budget', () => {
    const metadata = {
      openGaps: ['Need first gap details.', 'Need second gap details.'],
      suggestedQueries: ['first proposal', 'second proposal']
    };

    const lines = formatPriorityContext(metadata, 26);

    expect(lines).toEqual(['Try next: "first proposal"']);
    expect(codePoints(lines.join('\n'))).toBeLessThanOrEqual(26);
  });

  it('shows gaps before proposals after allocating the first proposal', () => {
    const metadata = {
      openGaps: ['Need first gap details.', 'Need second gap details.'],
      suggestedQueries: ['first proposal', 'second proposal']
    };

    const lines = formatPriorityContext(metadata, 56);

    expect(lines).toEqual([
      'Still open: first gap details',
      'Try next: "first proposal"'
    ]);
    expect(codePoints(lines.join('\n'))).toBeLessThanOrEqual(56);
  });

  it('shortens and drops still-open items from the end before dropping the first proposal', () => {
    const metadata = {
      openGaps: ['Need first gap with a long explanation.', 'Need second gap with a long explanation.'],
      suggestedQueries: ['first proposal', 'second proposal']
    };

    const lines = formatPriorityContext(metadata, 56);

    expect(lines).toEqual([
      'Still open: first gap with a…',
      'Try next: "first proposal"'
    ]);
    expect(lines.join('\n')).not.toContain('second gap');
    expect(codePoints(lines.join('\n'))).toBeLessThanOrEqual(56);
  });

  it('does not emit orphan labels, empty quotes, or over-budget context', () => {
    const metadata = {
      executedQueries: ['search'],
      openGaps: ['Need evidence.'],
      suggestedQueries: ['next step']
    };

    for (const chars of [0, 1, 2, 9, 11]) {
      expect(formatPriorityContext(metadata, chars)).toEqual([]);
      expect(formatSearchedContext(metadata, chars)).toEqual([]);
    }
  });

  it('formats searched context independently within its allocated budget', () => {
    const lines = formatSearchedContext({
      executedQueries: ['https://alice:pw@example.test/?token=secret&id=7', '😀"'.repeat(100)]
    }, 90);

    expect(lines).toHaveLength(1);
    expect(codePoints(lines.join('\n'))).toBeLessThanOrEqual(90);
    expect(lines[0]).toContain('token=REDACTED');
    expect(lines[0]).toContain('id=7');
    expect(() => JSON.parse(`[${lines[0].slice('Searched: '.length)}]`)).not.toThrow();
    expect(lines.join('\n')).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  });

  it('does not expand searched queries beyond the existing per-item cap', () => {
    const lines = formatSearchedContext({ executedQueries: ['x'.repeat(1000)] }, 1000);
    const items: string[] = JSON.parse(`[${lines[0].slice('Searched: '.length)}]`);

    expect(items).toHaveLength(1);
    expect(codePoints(JSON.stringify(items[0]))).toBeLessThanOrEqual(120);
  });

  it('does not expand priority proposals beyond the existing per-item cap', () => {
    const lines = formatPriorityContext({ suggestedQueries: ['y'.repeat(1000)] }, 500);
    const items: string[] = JSON.parse(`[${lines[0].slice('Try next: '.length)}]`);

    expect(items).toHaveLength(1);
    expect(codePoints(JSON.stringify(items[0]))).toBeLessThanOrEqual(120);
  });

  it('omits a quoted line when it cannot include an original character', () => {
    expect(formatSearchedContext({ executedQueries: ['long query'] }, 13)).toEqual([]);
  });

  it('adds the second proposal only after the first and still-open context fit', () => {
    const lines = formatPriorityContext({
      openGaps: ['Need evidence.'],
      suggestedQueries: ['first proposal', 'second proposal']
    }, 90);

    expect(lines).toEqual([
      'Still open: evidence',
      'Try next: "first proposal", "second proposal"'
    ]);
  });

  it('cleans, redacts, and deduplicates priority values before budgeting them', () => {
    const value = '\u001b[31mNeed Widget https://alice:pw@example.test/?token=secret&id=7.\u001b[0m';
    const lines = formatPriorityContext({
      openGaps: [value, value],
      suggestedQueries: [value, value]
    }, 200);

    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).not.toMatch(/\u001b|alice|pw@|token=secret/);
    expect(lines.join('\n')).toContain('token=REDACTED');
    expect(lines.join('\n')).toContain('id=7');
    expect(lines[0].split('; ')).toHaveLength(1);
    expect(JSON.parse(`[${lines[1].slice('Try next: '.length)}]`)).toHaveLength(1);
    expect(codePoints(lines.join('\n'))).toBeLessThanOrEqual(200);
  });
});
