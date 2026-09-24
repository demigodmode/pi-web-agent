import { describe, expect, it } from 'vitest';
import { selectRelevantContent, selectRelevantExcerpt } from '../../src/extract/section-selector.js';

describe('section selection', () => {
  it('selects a late HTML heading and keeps its anchor', () => {
    const result = selectRelevantContent({
      source: `<article><h2>Introduction</h2><p>${'Generic information. '.repeat(300)}</p>
        <h2 id="deadline">Cancellation deadline</h2><p>The cancellation deadline is 14 days.</p></article>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text).toContain('The cancellation deadline is 14 days.');
    expect(result.anchor).toBe('deadline');
    expect(result.omitted).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(4000);
  });

  it('finds a late body match under an unrelated heading', () => {
    const result = selectRelevantContent({
      source: `<article><h2>Overview</h2><p>${'General information. '.repeat(300)}</p>
        <p>The cancellation deadline is 14 days.</p></article>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text).toContain('The cancellation deadline is 14 days.');
  });

  it('selects a late Markdown heading', () => {
    const result = selectRelevantContent({
      source: `# Guide\n\n${'Generic information. '.repeat(300)}\n\n## Cancellation deadline\n\nThe deadline is 14 days.`,
      format: 'markdown', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text).toContain('The deadline is 14 days.');
    expect(result.text.length).toBeLessThanOrEqual(4000);
  });

  it('finds a late match in plain text without headings', () => {
    const result = selectRelevantContent({
      source: `${'Generic information. '.repeat(300)}\n\nThe cancellation deadline is 14 days.`,
      format: 'text', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text).toContain('The cancellation deadline is 14 days.');
  });

  it('returns the leading text when no terms match', () => {
    const result = selectRelevantContent({
      source: `<article><p>${'Generic information. '.repeat(300)}</p></article>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.matched).toBe(false);
    expect(result.text.startsWith('Generic information.')).toBe(true);
    expect(result.text.length).toBe(4000);
  });

  it('finds a late match inside one oversized section', () => {
    const result = selectRelevantContent({
      source: `<article><h2 id="policy">Policy</h2><p>${'Generic information. '.repeat(300)}</p>
        <p>The cancellation deadline is 14 days.</p></article>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text).toContain('The cancellation deadline is 14 days.');
    expect(result.anchor).toBe('policy');
  });

  it('preserves source order within selected sections', () => {
    const result = selectRelevantContent({
      source: `<article><h2>Cancellation deadline</h2><p>Submit a request first.</p>
        <p>The cancellation deadline is 14 days.</p></article>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text.indexOf('Submit a request first.')).toBeLessThan(result.text.indexOf('The cancellation deadline'));
  });

  it('chooses a relevant support excerpt after unrelated text', () => {
    const excerpt = selectRelevantExcerpt(
      `${'Unrelated introductory text. '.repeat(20)}\n\nThe cancellation deadline is 14 days.`,
      'cancellation deadline', 120
    );
    expect(excerpt).toContain('The cancellation deadline is 14 days.');
    expect(excerpt.length).toBeLessThanOrEqual(120);
  });
});
