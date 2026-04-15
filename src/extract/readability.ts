import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { ExtractedContent } from '../types.js';

export type ReadableExtractionMode = 'readability' | 'fallback';

export type SafeReadableExtraction = {
  mode: ReadableExtractionMode;
  content: ExtractedContent;
};

export function extractReadableContent(html: string, maxLength = 4000): ExtractedContent {
  let stylesheetError: Error | undefined;
  const virtualConsole = new VirtualConsole();

  virtualConsole.on('jsdomError', (error) => {
    if (!stylesheetError && error.message.includes('Could not parse CSS stylesheet')) {
      stylesheetError = error;
    }
  });

  const dom = new JSDOM(html, {
    url: 'https://example.com',
    virtualConsole
  });

  if (stylesheetError) {
    throw stylesheetError;
  }

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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return undefined;
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) || undefined;
}

function stripTagContent(html: string, tagName: string): string {
  return html.replace(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi'), ' ');
}

function extractPreferredSection(html: string): string {
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];

  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];

  return html;
}

function extractFallbackText(html: string, maxLength: number): ExtractedContent {
  const title = extractTitle(html);
  let section = extractPreferredSection(html);

  section = stripTagContent(section, 'script');
  section = stripTagContent(section, 'style');
  section = stripTagContent(section, 'noscript');
  section = stripTagContent(section, 'svg');
  section = stripTagContent(section, 'template');

  const text = decodeHtmlEntities(section)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  return {
    title,
    text
  };
}

export function extractReadableContentSafely(
  html: string,
  maxLength = 4000
): SafeReadableExtraction {
  try {
    return {
      mode: 'readability',
      content: extractReadableContent(html, maxLength)
    };
  } catch {
    return {
      mode: 'fallback',
      content: extractFallbackText(html, maxLength)
    };
  }
}
