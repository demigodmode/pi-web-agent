import { describe, expect, it } from 'vitest';
import { formatResearchProgress } from '../../src/orchestration/progress.js';

describe('formatResearchProgress', () => {
  it('shows the safe query for a started search without budget fractions', () => {
    expect(formatResearchProgress({
      phase: 'search', state: 'started', target: '  lookup https://alice:secret@example.com/docs?token=secret#part  ',
      searches: 1, fetches: 0, headless: 0
    })).toBe('Searching: lookup example.com/docs');
  });

  it('shows a safe host and path for a fetch', () => {
    expect(formatResearchProgress({
      phase: 'fetch', state: 'started', target: 'https://alice:secret@example.com/path?q=secret#fragment',
      searches: 1, fetches: 2, headless: 0
    })).toBe('Reading: example.com/path · 2 reads started');
  });

  it('numbers direct query links when a position is given', () => {
    expect(formatResearchProgress({
      phase: 'fetch', state: 'started', target: 'https://example.com/?p=5&token=secret', position: { index: 3, total: 8 },
      searches: 1, fetches: 5, headless: 0
    })).toBe('Reading link 3 of 8: example.com/ · 5 reads started');
    expect(formatResearchProgress({
      phase: 'headless', state: 'started', target: 'https://example.com/app?token=secret', position: { index: 2, total: 2 },
      searches: 1, fetches: 2, headless: 1
    })).toBe('Rendering link 2 of 2: example.com/app');
  });

  it('keeps search and unnumbered fetch activity without a position', () => {
    expect(formatResearchProgress({ phase: 'fetch', state: 'started', target: 'https://example.com/?p=1', searches: 1, fetches: 1, headless: 0 }))
      .toBe('Reading: example.com/ · 1 read started');
    expect(formatResearchProgress({ phase: 'headless', state: 'started', target: 'https://example.com/?p=1', searches: 1, fetches: 1, headless: 1 }))
      .toBe('Rendering: example.com/');
  });

  it('clips numbered link activity to 120 visible characters', () => {
    const text = formatResearchProgress({
      phase: 'fetch', state: 'started', target: `https://example.com/${'x'.repeat(200)}`, position: { index: 10, total: 10 },
      searches: 1, fetches: 12, headless: 0
    });
    expect(Array.from(text)).toHaveLength(120);
    expect(text.startsWith('Reading link 10 of 10: example.com/')).toBe(true);
    expect(text.endsWith(' · 12 reads started')).toBe(true);
  });

  it('shows a rendering target and claimed read count', () => {
    expect(formatResearchProgress({ phase: 'headless', state: 'started', target: 'https://example.com/app', searches: 1, fetches: 2, headless: 1 })).toBe('Rendering: example.com/app');
    expect(formatResearchProgress({ phase: 'fetch', state: 'settled', searches: 1, fetches: 2, headless: 0 })).toBe('2 reads started');
  });

  it('replaces a settled fetch target with aggregate readable documents', () => {
    expect(formatResearchProgress({
      phase: 'fetch', state: 'settled', target: 'https://alice:secret@example.com/finished?token=secret',
      searches: 1, fetches: 3, headless: 0, pagesRead: 2
    })).toBe('2 pages read · 3 reads started');
    expect(formatResearchProgress({ phase: 'fetch', state: 'settled', target: 'https://example.com/one', searches: 1, fetches: 1, headless: 0, pagesRead: 1 })).toBe('1 page read · 1 read started');
  });

  it('clips activity labels to 120 visible characters', () => {
    const text = formatResearchProgress({ phase: 'search', state: 'started', target: 'x'.repeat(200), searches: 1, fetches: 0, headless: 0 });
    expect(Array.from(text)).toHaveLength(120);
    expect(text.endsWith('…')).toBe(true);
    const fetch = formatResearchProgress({ phase: 'fetch', state: 'started', target: `https://example.com/${'x'.repeat(200)}`, searches: 1, fetches: 2, headless: 0 });
    expect(Array.from(fetch)).toHaveLength(120);
    expect(fetch).toContain(' · 2 reads started');
  });

  it.each([
    ['BEL', '\u0007'],
    ['ST', '\x1b\\']
  ])('strips OSC hyperlinks from activity labels terminated by %s', (_terminator, terminator) => {
    const open = `\x1b]8;;https://alice:secret@example.com/docs?token=secret${terminator}`;
    const close = `\x1b]8;;${terminator}`;
    expect(formatResearchProgress({
      phase: 'search', state: 'started', target: `q ${open}link${close}`,
      searches: 1, fetches: 0, headless: 0
    })).toBe('Searching: q link');
  });

  it.each([
    ['BEL', '\u0007'],
    ['ST', '\x1b\\']
  ])('sanitizes OSC targets before parsing %s fetch and headless activity', (_terminator, terminator) => {
    const osc = `\x1b]8;;https://alice:secret@example.com/private?token=secret${terminator}`;
    const target = `https://example.com/${osc}x`;
    const outputs = [
      formatResearchProgress({ phase: 'fetch', state: 'started', target, searches: 1, fetches: 2, headless: 0 }),
      formatResearchProgress({ phase: 'headless', state: 'started', target, searches: 1, fetches: 2, headless: 1 })
    ];

    expect(outputs).toEqual([
      'Reading: example.com/x · 2 reads started',
      'Rendering: example.com/x'
    ]);
    for (const output of outputs) {
      expect(output).not.toMatch(/alice:secret|token=secret|\]8;;|\u001b/);
      expect(Array.from(output).length).toBeLessThanOrEqual(120);
    }
  });

  it('removes an unterminated OSC sequence from fetch activity', () => {
    const target = 'https://example.com/\x1b]8;;https://alice:secret@example.com/private?token=secret';
    const output = formatResearchProgress({ phase: 'fetch', state: 'started', target, searches: 1, fetches: 2, headless: 0 });

    expect(output).toBe('Reading: example.com/ · 2 reads started');
    expect(output).not.toMatch(/alice:secret|token=secret|\]8;;|\u001b/);
  });

  it('removes lone C1 controls from search activity without dropping surrounding text', () => {
    const output = formatResearchProgress({
      phase: 'search', state: 'started', target: 'He said â€œoneâ€\x9d and â€œtwoâ€\x9d then\x9c left.', searches: 1, fetches: 0, headless: 0
    });

    expect(output).toBe('Searching: He said â€œoneâ€ and â€œtwoâ€ then left.');
  });

  it.each([
    ['terminated', 'https://example.com/\x9d8;;https://alice:secret@example.com/private?token=secret\x9cx', 'Reading: example.com/x · 2 reads started'],
    ['unterminated', 'https://example.com/\x9d8;;https://alice:secret@example.com/private?token=secret', 'Reading: example.com/ · 2 reads started'],
    ['parameterized and terminated', 'https://example.com/\x9d8;id=foo;https://alice:secret@example.com/private?token=secret\x9cx', 'Reading: example.com/x · 2 reads started'],
    ['parameterized and unterminated', 'https://example.com/\x9d8;id=foo;https://alice:secret@example.com/private?token=secret', 'Reading: example.com/ · 2 reads started']
  ])('removes a %s C1 OSC 8 hyperlink from fetch activity', (_kind, target, expected) => {
    const output = formatResearchProgress({ phase: 'fetch', state: 'started', target, searches: 1, fetches: 2, headless: 0 });

    expect(output).toBe(expected);
    expect(output).not.toMatch(/alice:secret|token=secret|8;;|\u009d|\u009c/);
  });
});
