import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ExtractedContent } from '../types.js';

export function extractReadableContent(html: string, maxLength = 4000): ExtractedContent {
  const dom = new JSDOM(html, { url: 'https://example.com' });
  const article = new Readability(dom.window.document).parse();
  const rawText = (article?.textContent ?? dom.window.document.body.textContent ?? '').trim();
  const text = rawText.slice(0, maxLength);

  const fallbackTitle = dom.window.document.title || undefined;

  return {
    title: article?.title ?? fallbackTitle,
    byline: article?.byline || undefined,
    text
  };
}
