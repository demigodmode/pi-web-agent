import { describe, expect, it } from 'vitest';
import { extractReadableContent, extractReadableContentForQuery, extractReadableContentSafely } from '../../src/extract/readability.js';

describe('readability extraction', () => {
  it('keeps a relevant answer after the leading 4,000 characters', () => {
    const html = `<html><body><article>
      <h1>Service guide</h1>
      <p>${'General information about this service. '.repeat(180)}</p>
      <h2 id="late-answer">Cancellation deadline</h2>
      <p>The cancellation deadline is 14 days.</p>
    </article></body></html>`;

    const result = extractReadableContentForQuery(html, 'cancellation deadline');

    expect(result.content.text).toContain('The cancellation deadline is 14 days.');
    expect(result.content.text.length).toBeLessThanOrEqual(4000);
    expect(result.content.sectionAnchor).toBe('late-answer');
    expect(result.omitted).toBe(true);
  });

  it('selects a late answer through the CSS parser fallback', () => {
    const html = `<html><head><style>.x { &:hover { color: red; } }</style></head><body><main>
      <h1>Service guide</h1><p>${'General information. '.repeat(300)}</p>
      <h2 id="deadline">Cancellation deadline</h2><p>The cancellation deadline is 14 days.</p>
      <script>const secret = 'script content';</script>
    </main></body></html>`;

    const result = extractReadableContentForQuery(html, 'cancellation deadline');

    expect(result.mode).toBe('fallback');
    expect(result.content.text).toContain('The cancellation deadline is 14 days.');
    expect(result.content.text).not.toContain('script content');
    expect(result.content.text).not.toContain('color: red');
    expect(result.content.sectionAnchor).toBe('deadline');
  });

  it('uses leading text when no query terms match', () => {
    const html = `<html><body><article><p>${'General information. '.repeat(300)}</p></article></body></html>`;
    const baseline = extractReadableContentSafely(html);
    const result = extractReadableContentForQuery(html, 'cancellation deadline');

    expect(result.content.text.slice(0, 100)).toBe(baseline.content.text.slice(0, 100));
    expect(result.content.text.length).toBeLessThanOrEqual(4000);
  });

  it('preserves Readability metadata with a query-selected section', () => {
    const html = `<html><head><title>Service guide</title><meta name="author" content="Ada Lovelace"></head>
      <body><article><h1>Service guide</h1><p>${'General information. '.repeat(300)}</p>
      <h2 id="deadline">Cancellation deadline</h2><p>The cancellation deadline is 14 days.</p>
      </article></body></html>`;

    const result = extractReadableContentForQuery(html, 'cancellation deadline');

    expect(result.content.title).toBe('Service guide');
    expect(result.content.byline).toBe('Ada Lovelace');
  });

  it('extracts readable text from article-like HTML', () => {
    const result = extractReadableContent(`
      <html>
        <head><title>Example Title</title></head>
        <body>
          <article>
            <h1>Example Title</h1>
            <p>First paragraph.</p>
            <p>Second paragraph.</p>
          </article>
        </body>
      </html>
    `);

    expect(result).toMatchObject({
      title: 'Example Title',
      text: expect.stringContaining('First paragraph.')
    });
  });

  it('truncates long extracted text', () => {
    const result = extractReadableContent(`
      <html><body><article><p>${'word '.repeat(200)}</p></article></body></html>
    `, 50);

    expect(result.text.length).toBeLessThanOrEqual(50);
  });

  it('falls back to lightweight extraction when stylesheet parsing breaks the primary path', () => {
    const result = extractReadableContentSafely(`
      <html>
        <head>
          <title>Broken CSS Page</title>
          <style>
            .btn {
              color: red;
              &:hover {
                color: blue;
              }
            }
          </style>
        </head>
        <body>
          <main>
            <h1>Broken CSS Page</h1>
            <p>This content should still be recoverable even if JSDOM rejects the stylesheet.</p>
            <p>The fallback path should keep this text readable.</p>
          </main>
        </body>
      </html>
    `);

    expect(result.mode).toBe('fallback');
    expect(result.content.title).toBe('Broken CSS Page');
    expect(result.content.text).toContain('This content should still be recoverable');
    expect(result.content.text).not.toContain('color: red');
  });

  it('decodes html entities in one pass without double-unescaping', () => {
    // Broken CSS forces the fallback path, which decodes entities in the title.
    const result = extractReadableContentSafely(`
      <html>
        <head>
          <title>Tom &amp;amp; Jerry &amp;lt;tag&amp;gt;</title>
          <style>.x { &:hover { color: red; } }</style>
        </head>
        <body>
          <div>Some readable body content that survives the fallback path.</div>
        </body>
      </html>
    `);

    // &amp;amp; -> &amp; (not &), and &amp;lt; -> &lt; (not <).
    expect(result.content.title).toBe('Tom &amp; Jerry &lt;tag&gt;');
  });

  it('returns fallback text from body content when main/article tags are missing', () => {
    const result = extractReadableContentSafely(`
      <html>
        <head>
          <title>Body Fallback</title>
          <style>
            .card {
              &:hover {
                opacity: 1;
              }
            }
          </style>
        </head>
        <body>
          <div>First useful paragraph with enough readable content to keep.</div>
          <div>Second useful paragraph that should also survive fallback extraction.</div>
        </body>
      </html>
    `);

    expect(result.mode).toBe('fallback');
    expect(result.content.title).toBe('Body Fallback');
    expect(result.content.text).toContain('First useful paragraph');
  });
});
