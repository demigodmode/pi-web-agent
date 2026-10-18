import { describe, expect, it } from 'vitest';
import { clipTerminalText, formatExploreCall, safeDisplayQuery, safeDisplayUrl } from '../../src/presentation/explore-call.js';

describe('web_explore call heading', () => {
  it('formats a complete whitespace-normalized query', () => {
    expect(formatExploreCall(' Vitest\ncoverage ', true)).toBe('web_explore ("Vitest coverage")');
  });

  it('uses a readable fallback for missing or incomplete arguments', () => {
    expect(formatExploreCall(undefined, true)).toBe('web_explore (…)');
    expect(formatExploreCall('partial query', false)).toBe('web_explore (…)');
  });

  it('removes terminal controls and preserves quoted terminal text safely', () => {
    expect(formatExploreCall('  say "hi"\u001b[31m\\now\t ', true)).toBe('web_explore ("say \\"hi\\"\\\\now")');
  });

  it('removes bidi formatting controls from the heading', () => {
    const heading = formatExploreCall('left\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069right', true);
    expect(heading).toBe('web_explore ("leftright")');
    expect(heading).not.toMatch(/[\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069]/);
  });

  it('redacts credentials and tracking from HTTP URLs', () => {
    const heading = formatExploreCall('https://alice:secret@example.com/docs?q=secret#secret', true);
    expect(heading).toBe('web_explore ("example.com/docs")');
    expect(heading).not.toContain('secret');
  });

  it('redacts credentials from HTTP URLs embedded in a query', () => {
    const heading = formatExploreCall('Review https://alice:secret@example.com/docs?token=secret#secret now', true);
    expect(heading).toBe('web_explore ("Review example.com/docs now")');
    expect(heading).not.toContain('secret');
  });

  it('clips long headings while allowing a longer activity label', () => {
    const query = 'a'.repeat(200);
    expect(safeDisplayQuery(query)).toHaveLength(96);
    expect(safeDisplayQuery(query)?.endsWith('…')).toBe(true);
    expect(clipTerminalText(query, 120)).toHaveLength(120);
    expect(clipTerminalText(query, 120).endsWith('…')).toBe(true);
  });

  it('clips after JSON escaping while retaining a closed quoted heading', () => {
    const heading = formatExploreCall('"\\'.repeat(100), true);
    const querySegment = heading.slice('web_explore ('.length, -1);
    expect(Array.from(querySegment).length).toBeLessThanOrEqual(96);
    expect(querySegment.startsWith('"')).toBe(true);
    expect(querySegment.endsWith('"')).toBe(true);
    expect(() => JSON.parse(querySegment)).not.toThrow();
  });

  it('uses a neutral link label for malformed URL-looking input', () => {
    expect(safeDisplayUrl('https://[bad')).toBe('[link]');
  });

  it.each([
    ['BEL', '\u0007'],
    ['ST', '\x1b\\']
  ])('strips OSC hyperlinks terminated by %s', (_terminator, terminator) => {
    const open = `\x1b]8;;https://alice:secret@example.com/docs?token=secret${terminator}`;
    const close = `\x1b]8;;${terminator}`;
    expect(formatExploreCall(`q ${open}link${close}`, true)).toBe('web_explore ("q link")');
  });
});
