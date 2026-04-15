import { describe, expect, it } from 'vitest';
import { extractReadableContent, extractReadableContentSafely } from '../../src/extract/readability.js';

describe('readability extraction', () => {
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
