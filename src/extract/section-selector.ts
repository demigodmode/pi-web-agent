import { JSDOM } from 'jsdom';

export type SelectionFormat = 'html' | 'markdown' | 'text';
export type SectionSelection = { text: string; anchor?: string; omitted: boolean; matched: boolean };

type Section = { heading?: string; anchor?: string; blocks: string[] };
type Window = { text: string; anchor?: string; score: number; index: number };
type Chunk = { text: string; allowPartialMatch: boolean };

const STOPWORDS = new Set([
  'about', 'after', 'from', 'have', 'into', 'that', 'their', 'there', 'these',
  'this', 'what', 'when', 'where', 'which', 'with', 'would', 'your', 'https', 'http'
]);

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function queryTerms(query: string): string[] {
  const withoutUrls = query.replace(/https?:\/\/\S+/gi, ' ');
  return [...new Set((withoutUrls.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((term) => !STOPWORDS.has(term)))];
}

function scoreText(text: string, terms: string[], allowPartialMatch = false): number {
  const normalized = text.toLowerCase();
  const words = new Set(normalized.match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  return terms.reduce((score, term) => score + Number(
    words.has(term) ||
    (/\p{Script=Han}/u.test(term) && normalized.includes(term)) ||
    (allowPartialMatch && normalized.includes(term))
  ), 0);
}

function splitLong(text: string, maxLength: number): string[] {
  const normalized = clean(text);
  if (normalized.length <= maxLength) return normalized ? [normalized] : [];
  const words = normalized.split(' ');
  const chunks: string[] = [];
  let chunk = '';
  for (let word of words) {
    if (word.length > maxLength) {
      if (chunk) chunks.push(chunk);
      while (word.length > maxLength) {
        chunks.push(word.slice(0, maxLength));
        word = word.slice(maxLength);
      }
      chunk = word;
      continue;
    }
    if (chunk && chunk.length + word.length + 1 > maxLength) {
      chunks.push(chunk);
      chunk = word;
    } else {
      chunk = chunk ? `${chunk} ${word}` : word;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function htmlSections(source: string): Section[] {
  const document = new JSDOM(source).window.document;
  const root = document.querySelector('main, article') ?? document.body;
  root.querySelectorAll('script, style, noscript, svg, template').forEach((element) => element.remove());
  const chromeTags = new Set(['nav', 'aside', 'header', 'footer']);
  const chromeRoles = new Set(['navigation', 'complementary', 'banner', 'contentinfo']);
  root.querySelectorAll('nav, aside, header, footer, [role], [aria-label]').forEach((element) => {
    const roles = (element.getAttribute('role') ?? '').toLowerCase().split(/\s+/);
    const label = element.getAttribute('aria-label') ?? '';
    if (chromeTags.has(element.tagName.toLowerCase()) || roles.some((role) => chromeRoles.has(role)) || /\bbreadcrumbs?\b/i.test(label)) {
      element.remove();
    }
  });
  const sections: Section[] = [{ blocks: [] }];
  let current = sections[0];
  let pendingAnchor: string | undefined;
  const contentSelector = 'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, dt, dd, div, a[name]';
  for (const element of root.querySelectorAll(contentSelector)) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') {
      pendingAnchor = element.getAttribute('name') ?? element.id ?? pendingAnchor;
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      const heading = clean(element.textContent ?? '');
      if (!heading) continue;
      const anchor = element.id || element.querySelector('[id], a[name]')?.getAttribute('id') ||
        element.querySelector('a[name]')?.getAttribute('name') || pendingAnchor || undefined;
      current = { heading, anchor, blocks: [] };
      sections.push(current);
      pendingAnchor = undefined;
      continue;
    }
    if (tag === 'div' && element.querySelector(contentSelector)) continue;
    if (element.closest('li, blockquote') !== element && element.parentElement?.closest('li, blockquote')) continue;
    const text = clean(element.textContent ?? '');
    if (text) {
      if (!current.anchor && pendingAnchor) current.anchor = pendingAnchor;
      current.blocks.push(text);
      pendingAnchor = undefined;
    }
  }
  if (sections.every((section) => section.blocks.length === 0)) {
    const text = clean(root.textContent ?? '');
    if (text) return [{ blocks: [text] }];
  }
  return sections.filter((section) => section.heading || section.blocks.length);
}

function markdownSections(source: string): Section[] {
  const sections: Section[] = [{ blocks: [] }];
  let current = sections[0];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) current.blocks.push(clean(paragraph.join(' ')));
    paragraph = [];
  };
  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      current = { heading: clean(heading[1]), blocks: [] };
      sections.push(current);
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return sections.filter((section) => section.heading || section.blocks.length);
}

function plainSections(source: string): Section[] {
  return source.split(/\n\s*\n/).map((text) => ({ blocks: [clean(text)] }))
    .filter((section) => section.blocks[0]);
}

function renderSections(sections: Section[]): string {
  return sections.flatMap((section) => [section.heading, ...section.blocks].filter(Boolean)).join('\n\n');
}

function makeWindows(sections: Section[], terms: string[], maxLength: number): Window[] {
  const windows: Window[] = [];
  const windowLimit = Math.max(1, Math.min(1200, maxLength));
  for (const section of sections) {
    const fullHeading = section.heading ?? '';
    if (fullHeading.length + 2 > windowLimit) {
      const heading = fullHeading.slice(0, windowLimit);
      windows.push({
        text: heading,
        anchor: section.anchor,
        score: scoreText(heading, terms) * 3,
        index: windows.length
      });
      for (const block of section.blocks) {
        const allowPartialMatch = /^\p{L}[\p{L}\p{N}]*$/u.test(block) && block.length > windowLimit;
        for (const chunk of splitLong(block, windowLimit)) {
          windows.push({
            text: chunk,
            anchor: section.anchor,
            score: scoreText(chunk, terms, allowPartialMatch),
            index: windows.length
          });
        }
      }
      continue;
    }
    const heading = fullHeading;
    const headingLength = heading ? heading.length + 2 : 0;
    const bodyLimit = Math.max(0, windowLimit - headingLength);
    const chunks: Chunk[] = bodyLimit > 0 ? section.blocks.flatMap((block) => {
      const allowPartialMatch = /^\p{L}[\p{L}\p{N}]*$/u.test(block) && block.length > bodyLimit;
      return splitLong(block, bodyLimit).map((text) => ({ text, allowPartialMatch }));
    }) : [];
    if (chunks.length === 0 && heading) chunks.push({ text: '', allowPartialMatch: false });
    let body = '';
    let bodyAllowsPartialMatch = false;
    const add = () => {
      const text = clean([heading, body].filter(Boolean).join('\n\n'));
      windows.push({ text, anchor: section.anchor, score: scoreText(heading, terms) * 3 + scoreText(body, terms, bodyAllowsPartialMatch), index: windows.length });
      body = '';
      bodyAllowsPartialMatch = false;
    };
    for (const chunk of chunks) {
      if (body && body.length + chunk.text.length + 2 > bodyLimit) add();
      body = body ? `${body}\n\n${chunk.text}` : chunk.text;
      bodyAllowsPartialMatch = !body.includes('\n\n') && chunk.allowPartialMatch;
    }
    if (body || heading) add();
  }
  return windows;
}

export function selectRelevantContent({
  source, format, query, maxLength = 4000
}: {
  source: string;
  format: SelectionFormat;
  query: string;
  maxLength?: number;
}): SectionSelection {
  const sections = format === 'html' ? htmlSections(source) : format === 'markdown'
    ? markdownSections(source) : plainSections(source);
  const fullText = renderSections(sections);
  if (maxLength <= 0) {
    return { text: '', omitted: fullText.length > 0, matched: false };
  }
  const terms = queryTerms(query);
  const windows = makeWindows(sections, terms, maxLength);
  const ranked = windows.filter((window) => window.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked.length === 0) {
    return { text: fullText.slice(0, maxLength), omitted: fullText.length > maxLength, matched: false };
  }

  const selected: Window[] = [];
  let remaining = maxLength;
  for (const window of ranked) {
    const separatorLength = selected.length ? 2 : 0;
    if (window.text.length + separatorLength > remaining) continue;
    selected.push(window);
    remaining -= window.text.length + separatorLength;
  }
  selected.sort((a, b) => a.index - b.index);
  const text = selected.map((window) => window.text).join('\n\n');
  return {
    text,
    anchor: ranked.find((window) => selected.includes(window))?.anchor,
    omitted: selected.length < windows.length,
    matched: true
  };
}

export function selectRelevantExcerpt(text: string, query: string, maxLength: number): string {
  const terms = queryTerms(query);
  const chunks = text.split(/\n\s*\n/).flatMap((paragraph) => splitLong(paragraph, maxLength));
  if (chunks.length === 0) return '';
  const best = chunks.map((chunk, index) => ({ chunk, index, score: scoreText(chunk, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  return best.chunk.slice(0, maxLength);
}
