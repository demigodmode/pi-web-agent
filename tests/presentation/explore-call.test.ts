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

  it('redacts credentials and tracking from HTTP URLs', () => {
    const heading = formatExploreCall('https://alice:secret@example.com/docs?q=secret#secret', true);
    expect(heading).toBe('web_explore ("https://example.com/docs")');
    expect(heading).not.toContain('secret');
  });

  it('clips long headings while allowing a longer activity label', () => {
    const query = 'a'.repeat(200);
    expect(safeDisplayQuery(query)).toHaveLength(96);
    expect(safeDisplayQuery(query)?.endsWith('…')).toBe(true);
    expect(clipTerminalText(query, 120)).toHaveLength(120);
    expect(clipTerminalText(query, 120).endsWith('…')).toBe(true);
  });

  it('uses a neutral link label for malformed URL-looking input', () => {
    expect(safeDisplayUrl('https://[bad')).toBe('[link]');
  });
});
