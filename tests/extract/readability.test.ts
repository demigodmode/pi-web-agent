import { describe, expect, it } from 'vitest';
import { extractReadableContent } from '../../src/extract/readability.js';

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
});
