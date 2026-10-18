import { describe, expect, it } from 'vitest';
import { formatResearchProgress } from '../../src/orchestration/progress.js';

describe('formatResearchProgress', () => {
  it('shows the safe query for a started search without budget fractions', () => {
    expect(formatResearchProgress({
      phase: 'search', state: 'started', target: '  lookup https://alice:secret@example.com/docs?token=secret#part  ',
      searches: 1, fetches: 0, headless: 0
    })).toBe('Searching: lookup https://example.com/docs');
  });

  it('shows a safe host and path for a fetch', () => {
    expect(formatResearchProgress({
      phase: 'fetch', state: 'started', target: 'https://alice:secret@example.com/path?q=secret#fragment',
      searches: 1, fetches: 2, headless: 0
    })).toBe('Reading: https://example.com/path · 2 reads started');
  });

  it('shows a rendering target and claimed read count', () => {
    expect(formatResearchProgress({ phase: 'headless', state: 'started', target: 'https://example.com/app', searches: 1, fetches: 2, headless: 1 })).toBe('Rendering: https://example.com/app');
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
});
