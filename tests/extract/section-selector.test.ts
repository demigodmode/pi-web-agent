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

  it('searches across sibling articles when the page has no main region', () => {
    const result = selectRelevantContent({
      source: `<body><article><h2>Cancellation deadline</h2><p>Cancellation deadline is mentioned here only.</p></article>
        <article><h2 id="actual-deadline">Cancellation deadline</h2><p>The actual cancellation deadline is 14 days before departure.</p></article></body>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });

    expect(result.text).toContain('The actual cancellation deadline is 14 days before departure.');
  });

  it('excludes ARIA-labelled page chrome inside the readable region', () => {
    const result = selectRelevantContent({
      source: `<main><div role="navigation" aria-label="Breadcrumb"><h2>Cancellation deadline</h2><p>Menu link</p></div>
        <div role="complementary"><p>Related cancellation deadline</p></div>
        <div role="banner"><p>Banner cancellation deadline</p></div>
        <div role="contentinfo"><p>Footer cancellation deadline</p></div>
        <article><h2 id="real">Cancellation deadline</h2><p>The deadline is 14 days.</p></article></main>`,
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.text).toContain('The deadline is 14 days.');
    expect(result.text).not.toContain('Menu link');
    expect(result.text).not.toContain('Related cancellation deadline');
    expect(result.text).not.toContain('Banner cancellation deadline');
    expect(result.text).not.toContain('Footer cancellation deadline');
    expect(result.anchor).toBe('real');
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

  it('captures relevant text from an ordinary container after paragraph text', () => {
    const result = selectRelevantContent({
      source: '<article><p>General policy information.</p><div>The cancellation deadline is 14 days.</div></article>',
      format: 'html', query: 'cancellation deadline', maxLength: 4000
    });
    expect(result.matched).toBe(true);
    expect(result.text).toContain('The cancellation deadline is 14 days.');
    expect(result.omitted).toBe(false);
  });

  it('matches Han query text within continuous Han content', () => {
    const result = selectRelevantContent({
      source: '<article><p>这是取消政策详情和退款说明。</p></article>',
      format: 'html', query: '取消政策', maxLength: 4000
    });
    expect(result.matched).toBe(true);
    expect(result.text).toContain('这是取消政策详情和退款说明。');
  });

  it('bounds every part of an oversized unbroken token and finds a late match', () => {
    const token = `${'x'.repeat(80)}cancellationdeadline${'y'.repeat(80)}`;
    const result = selectRelevantContent({
      source: `<article><p>${token}</p></article>`,
      format: 'html', query: 'cancellationdeadline', maxLength: 40
    });
    expect(result.matched).toBe(true);
    expect(result.text).toContain('cancellationdeadline');
    expect(result.text.length).toBeLessThanOrEqual(40);
  });

  it('returns an empty unmatched result for a nonpositive output budget', () => {
    for (const maxLength of [-1, 0]) {
      const result = selectRelevantContent({
        source: '<article><p>The cancellation deadline is 14 days.</p></article>',
        format: 'html', query: 'cancellation deadline', maxLength
      });
      expect(result).toEqual({ text: '', omitted: true, matched: false });
    }
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
