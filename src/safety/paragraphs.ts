import * as cheerio from 'cheerio';

export type SourceFormat = 'html' | 'markdown' | 'asciidoc' | 'text';

type Blocks = { paragraphs: string[]; headings: string[] };

const PROTECTED_HTML = 'pre, blockquote, q, h1, h2, h3, h4, h5, h6, script, style, noscript, svg, template';
const HTML_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, dt, dd, figcaption, caption, summary, address, td, th, div';

export function normalizeParagraph(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

type HtmlNode = { type?: string; name?: string; children?: HtmlNode[]; parent?: HtmlNode | null };

const PROTECTED_TAGS = new Set(PROTECTED_HTML.split(',').map((tag) => tag.trim()));
const BLOCK_TAGS = new Set(HTML_BLOCKS.split(',').map((tag) => tag.trim()));

/** Nodes with at least one protected ancestor, found in one walk instead of per-element lookups. */
function nodesUnderProtected(root: HtmlNode): Set<HtmlNode> {
  const under = new Set<HtmlNode>();
  const stack: Array<[HtmlNode, boolean]> = (root.children ?? []).map((child) => [child, false]);
  while (stack.length > 0) {
    const [node, inside] = stack.pop()!;
    if (inside) under.add(node);
    const childInside = inside || (node.name !== undefined && PROTECTED_TAGS.has(node.name));
    for (const child of node.children ?? []) stack.push([child, childInside]);
  }
  return under;
}

/** Nodes with a block-level descendant. Each node is marked once, so the walk stays linear. */
function nodesWithBlockDescendant(blocks: HtmlNode[]): Set<HtmlNode> {
  const marked = new Set<HtmlNode>();
  for (const block of blocks) {
    for (let node = block.parent; node && !marked.has(node); node = node.parent) marked.add(node);
  }
  return marked;
}

function htmlHeadings(source: string): string[] {
  const $ = cheerio.load(source);
  const headings: string[] = [];
  const root = $.root()[0] as unknown as HtmlNode;
  const under = nodesUnderProtected(root);
  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const heading = $(element);
    if (under.has(element as unknown as HtmlNode)) return;
    const text = normalizeParagraph(heading.text());
    if (text) headings.push(text);
  });
  return headings;
}

function htmlParagraphs(source: string): string[] {
  const $ = cheerio.load(source);
  const paragraphs: string[] = [];
  const root = $.root()[0] as unknown as HtmlNode;
  const under = nodesUnderProtected(root);
  const blocks = $(HTML_BLOCKS).toArray() as unknown as HtmlNode[];
  const withBlockChild = nodesWithBlockDescendant(blocks);

  $(HTML_BLOCKS).each((_, element) => {
    const block = $(element);
    const node = element as unknown as HtmlNode;
    if ((node.name !== undefined && PROTECTED_TAGS.has(node.name)) || under.has(node)) return;

    // Only leaf blocks are eligible. A parent may contain both a recipient
    // and action in separate children, so its combined text is not prose.
    if (withBlockChild.has(node)) return;

    // Protected descendants are dropped, the prose around them is still scanned.
    const copy = block.clone();
    copy.find(PROTECTED_HTML).remove();
    const paragraph = normalizeParagraph(copy.text());
    if (paragraph) paragraphs.push(paragraph);
  });

  return paragraphs;
}

type Fence = { marker: '`' | '~' | '-'; length: number };

// AsciiDoc listing blocks open and close with a bare run of dashes. They only count
// at a paragraph start, so a setext underline after text is never a fence.
function fenceStart(line: string, atParagraphStart: boolean, asciidoc: boolean): Fence | undefined {
  if (asciidoc && atParagraphStart && /^-{4,}\s*$/u.test(line)) return { marker: '-', length: line.trim().length };
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
  if (!match) return undefined;
  const marker = match[1][0] as '`' | '~';
  if (marker === '`' && match[2].includes('`')) return undefined;
  return { marker, length: match[1].length };
}

function isFenceEnd(line: string, fence: Fence): boolean {
  if (fence.marker === '-') return new RegExp(`^-{${fence.length},}\\s*$`, 'u').test(line);
  return new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`, 'u').test(line);
}

const CLOSER_RUN: Record<Fence['marker'], RegExp> = {
  '-': /^(-+)\s*$/u,
  '`': /^ {0,3}(`+)\s*$/u,
  '~': /^ {0,3}(~+)\s*$/u,
};

/**
 * suffix[marker][i] is the longest run of that marker that a line from i onward
 * could close with. A fence opened at line i has a closer when that is at least its length.
 */
function closerSuffixes(lines: string[]): Record<Fence['marker'], Int32Array> {
  const suffixes = { '`': new Int32Array(lines.length + 1), '~': new Int32Array(lines.length + 1), '-': new Int32Array(lines.length + 1) };
  for (const marker of ['`', '~', '-'] as const) {
    const suffix = suffixes[marker];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      suffix[index] = Math.max(suffix[index + 1]!, lines[index]!.match(CLOSER_RUN[marker])?.[1]?.length ?? 0);
    }
  }
  return suffixes;
}

function markdownBlocks(source: string, asciidoc: boolean): Blocks {
  const paragraphs: string[] = [];
  const headings: string[] = [];
  let lines: string[] = [];
  let quoteLines: string[] = [];
  let fenceLines: string[] = [];
  let fence: Fence | undefined;
  let quoted = false;
  let rejected = false;
  // A list item keeps indented text after it (even after a blank line) as part of the item.
  let listOpen = false;
  const protectedHtmlTags: string[] = [];

  // Markdown permits raw HTML blocks. Only the quoted/code tags are protected; their
  // contents are dropped and the prose around them is kept. Open tags carry across lines.
  const stripProtectedHtml = (line: string): string => {
    let kept = '';
    let cursor = 0;
    for (const match of line.matchAll(/<\/?(pre|blockquote|q)(?:\s[^>]*)?>/giu)) {
      const start = match.index ?? 0;
      if (protectedHtmlTags.length === 0) kept += line.slice(cursor, start);
      cursor = start + match[0].length;
      const closing = match[0].startsWith('</');
      const tag = match[1].toLowerCase();
      if (closing) {
        const index = protectedHtmlTags.lastIndexOf(tag);
        if (index >= 0) protectedHtmlTags.splice(index, 1);
      } else if (!/\/>$/u.test(match[0])) {
        protectedHtmlTags.push(tag);
      }
    }
    if (protectedHtmlTags.length === 0) kept += line.slice(cursor);
    return kept;
  };

  const finish = () => {
    if (!rejected && lines.length > 0) {
      const paragraph = normalizeParagraph(lines.join(' '));
      if (paragraph) paragraphs.push(paragraph);
    }
    lines = [];
    rejected = false;
  };

  const finishQuote = () => {
    quoteLines = [];
    quoted = false;
  };

  const finishFence = () => {
    fenceLines = [];
  };

  const sourceLines = source.split(/\r?\n/u);
  const closers = closerSuffixes(sourceLines);
  for (const [index, rawLine] of sourceLines.entries()) {
    if (fence) {
      if (isFenceEnd(rawLine, fence)) {
        finishFence();
        fence = undefined;
      } else {
        fenceLines.push(rawLine);
      }
      continue;
    }

    const openingFence = fenceStart(rawLine, lines.length === 0 && !quoted, asciidoc);
    if (openingFence && closers[openingFence.marker][index + 1]! < openingFence.length) {
      // A fence with no closing line is not a fence: what follows is prose.
      finishQuote();
      finish();
      continue;
    }
    if (openingFence) {
      finishQuote();
      finish();
      listOpen = false;
      fence = openingFence;
      fenceLines = [];
      continue;
    }

    const protectedLine = protectedHtmlTags.length > 0 || /<\/?(?:pre|blockquote|q)(?:\s[^>]*)?>/iu.test(rawLine);
    const line = stripProtectedHtml(rawLine);
    if (protectedLine && !line.trim()) {
      finishQuote();
      finish();
      listOpen = false;
      continue;
    }

    if (/^\s*$/u.test(line)) {
      finishQuote();
      finish();
      continue;
    }

    if (/^ {0,3}#{1,6}(?:\s|$)/u.test(line)) {
      finishQuote();
      finish();
      listOpen = false;
      const heading = normalizeParagraph(line.replace(/^ {0,3}#{1,6}(?:\s+|$)/u, '').replace(/(?:^|\s+)#+\s*$/u, ''));
      if (heading) headings.push(heading);
      continue;
    }

    if (lines.length > 0 && /^ {0,3}(?:=+|-+)\s*$/u.test(line)) {
      const heading = normalizeParagraph(lines.join(' '));
      if (heading) headings.push(heading);
      listOpen = false;
      lines = [];
      rejected = false;
      continue;
    }

    if (/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u.test(line)) {
      finishQuote();
      finish();
      listOpen = false;
      continue;
    }

    // An indented line is code only when nothing is open: no paragraph, no list.
    const indented = /^(?: {4}|\t)/u.test(line);
    if (indented && lines.length === 0 && !listOpen) {
      finishQuote();
      finish();
      continue;
    }
    const body = indented ? line.replace(/^(?: {4}|\t)+/u, '') : line;

    if (/^ {0,3}>/u.test(body)) {
      if (!quoted) finish();
      quoted = true;
      listOpen = false;
      quoteLines.push(body.replace(/^ {0,3}> ?/u, ''));
      continue;
    }

    // Only lines carrying a quote marker are quoted; a bare line after a quote is prose.
    if (quoted) finishQuote();

    const listItem = body.match(/^ {0,3}(?:[-+*]|\d+[.)])\s+(.+)$/u);
    if (listItem) {
      finish();
      lines.push(listItem[1]);
      finish();
      listOpen = true;
      continue;
    }

    if (!indented) listOpen = false;
    lines.push(body);
  }

  finishQuote();
  if (fence) finishFence();
  finish();
  return { paragraphs, headings };
}

// Plain text has no block syntax: blank lines separate paragraphs and nothing else does.
function textBlocks(source: string): Blocks {
  const paragraphs = source.split(/\r?\n[ \t]*\r?\n/u).map(normalizeParagraph).filter(Boolean);
  return { paragraphs, headings: [] };
}

function blocksFor(source: string, format: SourceFormat): Blocks {
  if (format === 'markdown' || format === 'asciidoc') return markdownBlocks(source, format === 'asciidoc');
  if (format === 'text') return textBlocks(source);
  return { paragraphs: htmlParagraphs(source), headings: htmlHeadings(source) };
}

export function sourceParagraphs(source: string, format: SourceFormat): string[] {
  return blocksFor(source, format).paragraphs;
}

/** Heading text, which only direct-address rules may scan. Plain text has no headings. */
export function sourceHeadings(source: string, format: SourceFormat): string[] {
  return blocksFor(source, format).headings;
}
