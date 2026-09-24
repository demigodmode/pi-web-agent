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

  it('prefers article content to matching page chrome', () => {
    const result = selectRelevantContent({
      source: `<nav><h2>Cancellation deadline</h2><p>Navigation item</p></nav>
        <header>Site header</header><main><article><h2 id="refund-policy">Refund policy</h2>
        <p>The cancellation deadline is 14 days.</p></article></main>
        <aside>Sidebar</aside><footer>Site footer</footer>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text).toContain('The cancellation deadline is 14 days.');
    expect(result.text).not.toContain('Navigation item');
    expect(result.anchor).toBe('refund-policy');
  });

  it('bounds a matching heading that is longer than the output budget', () => {
    const heading = `Cancellation deadline ${'details '.repeat(30)}`;
    const result = selectRelevantContent({
      source: `<article><h2 id="deadline">${heading}</h2><p>Requests are accepted online.</p></article>`,
      format: 'html', query: 'cancellation deadline', maxLength: 80
    });
    expect(result.matched).toBe(true);
    expect(result.text).toBe(heading.slice(0, 80));
    expect(result.anchor).toBe('deadline');
    expect(result.text.length).toBeLessThanOrEqual(80);
  });

  it('finds a body match after an oversized unrelated heading', () => {
    const result = selectRelevantContent({
      source: `<article><h2 id="policy">${'General policy details. '.repeat(100)}</h2>
        <p>The cancellation deadline is 14 days.</p></article>`,
      format: 'html', query: 'cancellation deadline', maxLength: 120
    });
    expect(result.matched).toBe(true);
    expect(result.text).toContain('The cancellation deadline is 14 days.');
    expect(result.anchor).toBe('policy');
    expect(result.text.length).toBeLessThanOrEqual(120);
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
