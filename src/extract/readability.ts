import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { ExtractedContent } from '../types.js';
import { selectRelevantContent } from './section-selector.js';

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

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"'
};

function decodeHtmlEntities(text: string): string {
  // Single pass so each entity is decoded exactly once. A multi-pass decode
  // rescans its own output, which double-unescapes either &amp;lt; -> < or
  // &#38;amp; -> & depending on the pass order. One pass avoids both.
  return text.replace(
    /&(?:#(\d+)|#x([\da-f]+)|nbsp|amp|lt|gt|quot);/gi,
    (match, dec, hex) => {
      if (dec !== undefined) return String.fromCharCode(Number(dec));
      if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));
      return NAMED_ENTITIES[match.toLowerCase()] ?? match;
    }
  );
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

function extractPreferredDomSection(document: Document): string {
  const region = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  const cleanedRegion = region.cloneNode(true) as Element;
  cleanedRegion.querySelectorAll('script, style, noscript, svg, template').forEach((element) => element.remove());
  return cleanedRegion.outerHTML;
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

/** Research-only extraction: choose relevant content before the usual text cap. */
export function extractReadableContentForQuery(
  html: string,
  query: string,
  maxLength = 4000
): SafeReadableExtraction & { omitted: boolean } {
  let stylesheetError: Error | undefined;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (!stylesheetError && error.message.includes('Could not parse CSS stylesheet')) {
      stylesheetError = error;
    }
  });

  try {
    const dom = new JSDOM(html, { url: 'https://example.com', virtualConsole });
    if (stylesheetError) throw stylesheetError;
    const preferredRegion = extractPreferredDomSection(dom.window.document);
    const article = new Readability(dom.window.document).parse();
    const selected = selectRelevantContent({
      source: article?.content ?? dom.window.document.body.innerHTML,
      format: 'html', query, maxLength
    });
    const preferredSelection = selectRelevantContent({
      source: preferredRegion,
      format: 'html', query, maxLength
    });
    const querySelection = preferredSelection.matched ? preferredSelection : selected;
    return {
      mode: 'readability',
      omitted: querySelection.omitted,
      content: {
        title: article?.title ?? (dom.window.document.title || undefined),
        byline: article?.byline || undefined,
        text: querySelection.text,
        ...(querySelection.anchor ? { sectionAnchor: querySelection.anchor } : {})
      }
    };
  } catch {
    let region = extractPreferredSection(html);
    for (const tag of ['script', 'style', 'noscript', 'svg', 'template']) {
      region = stripTagContent(region, tag);
    }
    const selected = selectRelevantContent({ source: region, format: 'html', query, maxLength });
    return {
      mode: 'fallback',
      omitted: selected.omitted,
      content: {
        title: extractTitle(html),
        text: selected.text,
        ...(selected.anchor ? { sectionAnchor: selected.anchor } : {})
      }
    };
  }
}
