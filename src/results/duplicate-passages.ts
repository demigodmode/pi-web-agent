export type PassageRelation = 'equal' | 'left-contained' | 'right-contained' | 'distinct';

type CodeProvenance = { leftCodeBlock?: boolean; rightCodeBlock?: boolean };

const FENCE = /`{3,}|~{3,}/;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;
const NUMBER_OR_VERSION = /(?<![\p{L}\p{N}\p{M}])\p{N}+(?:\.\p{N}+)*(?![\p{L}\p{N}\p{M}])/gu;
const NEGATIONS = new Set([
  'no', 'not', 'never', 'none', 'neither', 'nor', 'without', 'cannot', 'cant', 'unsupported', 'deprecated',
  "can't", 'wont', "won't", 'dont', "don't", 'doesnt', "doesn't", 'didnt', "didn't",
  'isnt', "isn't", 'arent', "aren't", 'wasnt', "wasn't", 'werent', "weren't",
  'shouldnt', "shouldn't", 'wouldnt', "wouldn't", 'couldnt', "couldn't", 'mustnt', "mustn't",
  'hasnt', "hasn't", 'havent', "haven't", 'hadnt', "hadn't"
]);

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function inlineCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const delimiter = /(`+)/g;
  let match: RegExpExecArray | null;
  while ((match = delimiter.exec(text))) {
    const opening = match[1]!;
    const closingAt = text.indexOf(opening, delimiter.lastIndex);
    if (closingAt === -1) continue;
    spans.push(text.slice(match.index, closingAt + opening.length));
    delimiter.lastIndex = closingAt + opening.length;
  }
  return spans;
}

function replaceInlineCode(text: string): string {
  return text.replace(/(`+)([\s\S]*?)\1/g, ' ');
}

function normalizedNumbers(text: string): Set<string> {
  return new Set(text.normalize('NFC').match(NUMBER_OR_VERSION) ?? []);
}

function normalizedNegations(text: string): Set<string> {
  const tokens = text.normalize('NFC').toLocaleLowerCase().match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) ?? [];
  return new Set(tokens
    .map((token) => token.replace('’', "'"))
    .filter((token) => NEGATIONS.has(token) || token.endsWith("n't")));
}

function normalizedTokens(text: string): string[] {
  return (replaceInlineCode(text).normalize('NFC').toLocaleLowerCase().match(WORD) ?? []);
}

function containsTokens(container: string[], contained: string[]): boolean {
  if (!contained.length || contained.length > container.length) return false;
  for (let start = 0; start <= container.length - contained.length; start++) {
    if (contained.every((token, offset) => container[start + offset] === token)) return true;
  }
  return false;
}

function coverageTokens(text: string): string[] {
  const tokens: string[] = [];
  const token = /(`+)([\s\S]*?)\1|(?<![\p{L}\p{N}\p{M}])\p{N}+(?:\.\p{N}+)*(?![\p{L}\p{N}\p{M}])|[\p{L}\p{N}][\p{L}\p{N}\p{M}_]*(?:['’][\p{L}\p{N}\p{M}_]+)?|[+*/%=<>!&|^~-]+/gu;
  for (const match of text.replace(/…$/u, '').normalize('NFC').matchAll(token)) {
    if (match[1] !== undefined) tokens.push(`code:${match[0]}`);
    else if (/^\p{L}/u.test(match[0]!)) tokens.push(match[0]!.toLocaleLowerCase());
    else tokens.push(match[0]!);
  }
  return tokens;
}

/** Whole-token containment for finding coverage, without the equality rules used for passage dedupe. */
export function containsPassageTokens(container: string, contained: string): boolean {
  if (container === contained) return true;
  return containsTokens(coverageTokens(container), coverageTokens(contained));
}

/**
 * Compares passages without deciding whether either candidate may be removed.
 * Code blocks require byte equality; ordinary prose is compared as whole tokens.
 */
export function comparePassages(left: string, right: string, code?: CodeProvenance): PassageRelation {
  if (left === right) return 'equal';
  if (code?.leftCodeBlock || code?.rightCodeBlock || FENCE.test(left) || FENCE.test(right)) return 'distinct';

  if (JSON.stringify(inlineCodeSpans(left)) !== JSON.stringify(inlineCodeSpans(right))) return 'distinct';
  if (!sameSet(normalizedNumbers(left), normalizedNumbers(right))) return 'distinct';
  if (!sameSet(normalizedNegations(left), normalizedNegations(right))) return 'distinct';

  const leftTokens = normalizedTokens(left);
  const rightTokens = normalizedTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 'distinct';
  if (leftTokens.length === rightTokens.length && leftTokens.every((token, index) => token === rightTokens[index])) return 'equal';
  if (containsTokens(rightTokens, leftTokens)) return 'left-contained';
  if (containsTokens(leftTokens, rightTokens)) return 'right-contained';
  return 'distinct';
}
