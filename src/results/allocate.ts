import { rankEvidencePassages, type PassageCandidate } from '../orchestration/evidence-passages.js';
import { formatPriorityContext, formatSearchedContext } from '../presentation/research-context.js';
import { comparePassages, containsPassageTokens } from './duplicate-passages.js';
import { resolveLengthLimit } from './length.js';
import { clipCodePoints, codePoints, countResultContent } from './content-length.js';
import { matchFlaggedParagraphs } from '../safety/passage-matching.js';
import type { AllocatedSource, ModelFinding, PreparedSource, ResultAllocation, ResultAllocationInput } from './types.js';

const MAX_EXCERPTS = 3;
const MAX_EXCERPT_CHARS = 900;
const STANDARD_POOL = 10_000;
// Below this, discovered passages compete on score across sources instead of splitting the space evenly.
const BEST_FIRST_BELOW = 4000;
const MIN_CLIPPED_CHARS = 300;
// The least room worth spending on the opening of a neighbouring paragraph.
const MIN_TRIM_CHARS = 50;
type InternalExcerpt = { text: string; anchor?: string; codeBlock?: boolean; seed?: PassageCandidate };
type MutableSource = Omit<AllocatedSource, 'excerpts' | 'safety'> & { excerpts: InternalExcerpt[]; required: boolean; reader: boolean; candidates: PassageCandidate[]; anchor?: string; sourceSafety?: PreparedSource['sourceSafety']; absorbed: Set<number> };
type CandidateEntry = { source: MutableSource; candidate: PassageCandidate; sourceOrder: number; candidateOrder: number };

function findingText(text: string) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return codePoints(normalized) <= 180 ? normalized : `${clipCodePoints(normalized, 179).trimEnd()}…`;
}
function makeSources(sources: PreparedSource[]): MutableSource[] {
  return sources.map((source) => ({
    id: source.id, title: source.title, url: source.url, ...(source.requestedUrl ? { requestedUrl: source.requestedUrl } : {}), method: source.method,
    excerpts: [], absorbed: new Set<number>(), retrievalCut: source.retrievalCut, selectionOmitted: source.selectionOmitted, spaceCut: false,
    ...(source.retrievedAt ? { retrievedAt: source.retrievedAt } : {}), required: source.required, reader: source.reader,
    ...(source.sectionAnchor ? { anchor: source.sectionAnchor } : {}),
    ...(source.sourceSafety ? { sourceSafety: { flaggedParagraphs: [...source.sourceSafety.flaggedParagraphs], agentNotes: [...source.sourceSafety.agentNotes] } } : {}),
    candidates: source.ranked.length ? source.ranked.map((candidate) => ({ ...candidate })) : rankEvidencePassages(source.readerDocument ?? '', '')
  }));
}
function passageIsFlagged(source: MutableSource, text: string): boolean {
  return Boolean(source.sourceSafety?.flaggedParagraphs.length && matchFlaggedParagraphs(text, source.sourceSafety.flaggedParagraphs).length);
}
function passageMayBeFlagged(source: MutableSource, text: string): boolean {
  if (passageIsFlagged(source, text)) return true;
  const normalized = coverageText(text).replace(/\s+/gu, ' ').trim();
  return Boolean(normalized && source.sourceSafety?.flaggedParagraphs.some((paragraph) => {
    const flagged = coverageText(paragraph).replace(/\s+/gu, ' ').trim();
    return flagged.startsWith(normalized) || normalized.startsWith(flagged);
  }));
}
function excerptLimit(source: MutableSource) {
  return source.required && source.reader ? Infinity : MAX_EXCERPTS;
}
function rankedFor(source: MutableSource) {
  return source.candidates.slice().sort((a, b) => b.score - a.score || a.order - b.order);
}
function candidatesFor(source: MutableSource) {
  return rankedFor(source).slice(0, excerptLimit(source));
}
function isAbsorbed(source: MutableSource, candidate: PassageCandidate) {
  return source.absorbed.has(candidate.order);
}
/** Paragraphs below the top excerpts only fill a slot freed by growth when they are not flagged. */
function mayFillSlot(source: MutableSource, candidate: PassageCandidate, rank: number) {
  return rank < MAX_EXCERPTS || !passageMayBeFlagged(source, candidate.text);
}
/** Admits a ranked paragraph as its own excerpt, clipped to cap if needed. */
function admit(source: MutableSource, candidate: PassageCandidate, cap: number): { text: string; clipped: boolean } {
  if (cap <= 0) return { text: '', clipped: true };
  const text = clipPassage(candidate.text, cap, Boolean(candidate.codeBlock));
  if (!text) return { text, clipped: true };
  source.absorbed.add(candidate.order);
  append(source, candidate, text);
  return { text, clipped: codePoints(candidate.text) > cap };
}
const ASCII_SENTENCE_END = '.!?';
const CJK_SENTENCE_END = '。！？';
const ABBREVIATIONS = new Set(['etc', 'vs', 'cf', 'approx', 'dr', 'mr', 'mrs', 'ms', 'st', 'no', 'fig', 'vol']);

/** Whether the period at index ends an abbreviation such as "e.g." or "Dr." rather than a sentence. */
function abbreviatedAt(points: string[], index: number): boolean {
  let start = index;
  while (start > 0 && /[\p{L}.]/u.test(points[start - 1]!)) start--;
  const word = points.slice(start, index).join('');
  return word.includes('.') || ABBREVIATIONS.has(word.toLowerCase());
}

/** Whether cutting after the first `end` points leaves a complete sentence. */
function endsSentence(points: string[], end: number): boolean {
  const last = points[end - 1]!;
  if (CJK_SENTENCE_END.includes(last)) return true;
  if (!ASCII_SENTENCE_END.includes(last)) return false;
  if (end < points.length && !/\s/u.test(points[end]!)) return false;
  return !(last === '.' && abbreviatedAt(points, end - 1));
}

/**
 * The first `chars` code points of a neighbouring paragraph, up to its last
 * sentence end. The whole paragraph when it fits; empty if no sentence end fits.
 */
function sentencesWithin(text: string, chars: number): string {
  const points = Array.from(text);
  if (points.length <= chars) return text;
  for (let end = chars; end >= 1; end--) if (endsSentence(points, end)) return points.slice(0, end).join('');
  return '';
}

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Cutting before points[end] keeps whole words. Scripts without spaces break anywhere between their characters. */
function wordBoundary(points: string[], end: number): boolean {
  return /\s/u.test(points[end]!) || CJK_CHAR.test(points[end]!) || CJK_CHAR.test(points[end - 1]!);
}

/**
 * A selected passage cut to chars. Prose keeps its last sentence end when that
 * keeps at least half the room; otherwise, and for code, it ends on a word
 * boundary. Empty when no clean cut fits.
 */
function clipPassage(text: string, chars: number, code: boolean): string {
  const points = Array.from(text);
  if (points.length <= chars) return text;
  if (!code) {
    for (let end = chars; end >= 1 && end * 2 >= chars; end--) if (endsSentence(points, end)) return points.slice(0, end).join('');
  }
  for (let end = chars; end >= 1 && end * 2 >= chars; end--) if (wordBoundary(points, end)) return points.slice(0, end).join('').trimEnd();
  // One long unbroken run (a URL, minified code): a hard cut beats dropping it.
  return points.slice(0, chars).join('');
}
/**
 * Grows an admitted excerpt through the neighbouring paragraphs of its section,
 * then across a boundary, while they fit under cap. Returns the code points added
 * and whether the last paragraph was only partly taken.
 */
function grow(source: MutableSource, excerpt: InternalExcerpt, cap: number): { added: number } {
  const seed = excerpt.seed;
  if (!seed || excerpt.text !== seed.text) return { added: 0 };
  const ordered = source.candidates.slice().sort((a, b) => a.order - b.order);
  const at = ordered.indexOf(seed);
  if (at < 0) return { added: 0 };
  // Flagged paragraphs are never pulled in as neighbours; they are emitted only as selected seeds.
  const fits = (other: PassageCandidate | undefined, sameSection: boolean) => other !== undefined && !source.absorbed.has(other.order)
    && (!sameSection || other.section === seed.section) && !passageMayBeFlagged(source, other.text);
  let text = excerpt.text;
  const original = codePoints(text);
  let lo = at - 1;
  let hi = at + 1;
  // Stay in the section while it has room, then continue into neighbours across a boundary.
  for (const sameSection of [true, false]) {
    let up = true;
    let down = true;
    while (up || down) {
      if (up) {
        const next = ordered[hi];
        if (fits(next, sameSection) && codePoints(`${text}\n\n${next!.text}`) <= cap) { text = `${text}\n\n${next!.text}`; source.absorbed.add(next!.order); hi++; } else up = false;
      }
      if (down) {
        const prev = ordered[lo];
        if (fits(prev, sameSection) && codePoints(`${prev!.text}\n\n${text}`) <= cap) { text = `${prev!.text}\n\n${text}`; source.absorbed.add(prev!.order); lo--; } else down = false;
      }
    }
  }
  // Whatever room is left takes a neighbouring paragraph up to its last sentence
  // end, or nothing. Fenced code is never trimmed, and the trimmed piece is
  // context, so it never marks the source as cut.
  const room = cap - codePoints(text) - 2;
  if (room >= MIN_TRIM_CHARS) {
    const next = ordered.slice(hi).find((other) => !source.absorbed.has(other.order) && !passageMayBeFlagged(source, other.text));
    const previous = ordered.slice(0, Math.max(0, lo + 1)).reverse().find((other) => !source.absorbed.has(other.order) && !passageMayBeFlagged(source, other.text));
    const nextPiece = next && !next.codeBlock ? sentencesWithin(next.text, room) : '';
    const previousPiece = previous && !previous.codeBlock ? sentencesWithin(previous.text, room) : '';
    if (nextPiece) {
      text = `${text}\n\n${nextPiece}`; source.absorbed.add(next!.order);
    } else if (previousPiece) {
      text = `${previousPiece}\n\n${text}`; source.absorbed.add(previous!.order);
    }
  }
  excerpt.text = text;
  return { added: codePoints(text) - original };
}
/** Grows every admitted excerpt, best seeds first, while the budget allows. */
function growAll(sources: MutableSource[], remaining: () => number, onGrow: (source: MutableSource, added: number) => void) {
  const admitted = sources.flatMap((source) => source.excerpts.map((excerpt) => ({ source, excerpt })))
    .filter(({ excerpt }) => excerpt.seed)
    .sort((a, b) => (b.excerpt.seed!.score - a.excerpt.seed!.score) || (a.excerpt.seed!.order - b.excerpt.seed!.order));
  for (const { source, excerpt } of admitted) {
    const room = remaining();
    if (room <= 0) continue;
    const { added } = grow(source, excerpt, Math.min(MAX_EXCERPT_CHARS, codePoints(excerpt.text) + room));
    if (added > 0) onGrow(source, added);
  }
}
function excerpts(sources: MutableSource[]) { return sources.flatMap((source) => source.excerpts.map((excerpt) => excerpt.text)); }
function counted(findings: ModelFinding[], sources: MutableSource[], context: string[]) { return countResultContent(findings.map((finding) => finding.text), excerpts(sources), context); }
function selectedFindings(input: ResultAllocationInput): ModelFinding[] { return input.findings.slice(0, 5).map((text, index) => ({ index, text: findingText(text), sourceIds: [...(input.findingSourceIds[index] ?? [])] })).filter((finding) => finding.text); }
function sourceById(sources: MutableSource[], id: string) { return sources.find((source) => source.id === id); }

function emitCoverage(source: MutableSource, candidate: PassageCandidate, all: MutableSource[]) {
  if (source.required && source.excerpts.length === 0) return false;
  for (const target of all) for (let index = 0; index < target.excerpts.length; index++) {
    if (target === source) continue;
    const targetExcerpt = target.excerpts[index]!;
    if (passageMayBeFlagged(source, candidate.text) || passageMayBeFlagged(target, targetExcerpt.text)) continue;
    const compared = comparePassages(candidate.text, targetExcerpt.text, { leftCodeBlock: candidate.codeBlock, rightCodeBlock: targetExcerpt.codeBlock });
    if (compared === 'equal' || compared === 'left-contained') {
      source.samePassageAs = [...(source.samePassageAs ?? []), { sourceId: target.id, excerptIndex: index, relation: compared === 'equal' ? 'same' : 'covered' }];
      return true;
    }
  }
  return false;
}
function entriesFor(sources: MutableSource[]): CandidateEntry[] { return sources.flatMap((source, sourceOrder) => candidatesFor(source).map((candidate, candidateOrder) => ({ source, candidate, sourceOrder, candidateOrder }))); }
/** Walk strict containment dependencies instead of using a non-transitive comparator. */
function dependencyOrder(sources: MutableSource[]) {
  const entries = entriesFor(sources); const visited = new Set<CandidateEntry>(); const visiting = new Set<CandidateEntry>(); const ordered: CandidateEntry[] = [];
  const visit = (entry: CandidateEntry) => {
    if (visited.has(entry) || visiting.has(entry)) return;
    visiting.add(entry);
    for (const other of entries) {
      const compared = other === entry ? 'distinct' : comparePassages(entry.candidate.text, other.candidate.text, { leftCodeBlock: entry.candidate.codeBlock, rightCodeBlock: other.candidate.codeBlock });
      if (compared === 'left-contained') visit(other);
    }
    visiting.delete(entry); visited.add(entry); ordered.push(entry);
  };
  for (const entry of entries.slice().sort((a, b) => Number(b.source.required) - Number(a.source.required) || a.sourceOrder - b.sourceOrder || a.candidateOrder - b.candidateOrder)) visit(entry);
  return ordered;
}
const COMMUNITY_CONTEXT_PREFIX = 'Community/practical context: ';
function coverageText(text: string) { return text.startsWith(COMMUNITY_CONTEXT_PREFIX) ? text.slice(COMMUNITY_CONTEXT_PREFIX.length) : text; }
function normalizedContains(container: string, contained: string) { return containsPassageTokens(container, coverageText(contained)); }
function isFindingCovered(finding: ModelFinding, sources: MutableSource[]) {
  return finding.sourceIds.some((id) => {
    const source = sourceById(sources, id); if (!source) return false;
    if (source.excerpts.some((excerpt) => normalizedContains(excerpt.text, finding.text))) return true;
    if (passageIsFlagged(source, coverageText(finding.text))) return false;
    return (source.samePassageAs ?? []).some((coverage) => {
      const target = sourceById(sources, coverage.sourceId)?.excerpts[coverage.excerptIndex];
      return target !== undefined && normalizedContains(target.text, finding.text);
    });
  });
}
function publicSources(sources: MutableSource[], findings: ModelFinding[]): AllocatedSource[] {
  return sources.map(({ required: _required, reader: _reader, candidates: _candidates, absorbed: _absorbed, anchor: _anchor, sourceSafety, excerpts: local, ...source }) => {
    const texts = [...local.map((excerpt) => excerpt.text), ...findings.filter((finding) => finding.sourceIds.includes(source.id)).map((finding) => finding.text)];
    const markedParagraphs = sourceSafety ? [...new Set(texts.flatMap((text) => matchFlaggedParagraphs(coverageText(text), sourceSafety.flaggedParagraphs)))] : [];
    const safety = sourceSafety && (markedParagraphs.length || sourceSafety.agentNotes.length)
      ? { markedParagraphs, agentNotes: [...sourceSafety.agentNotes] }
      : undefined;
    return { ...source, excerpts: local.map(({ codeBlock: _codeBlock, seed: _seed, ...excerpt }) => excerpt), ...(safety ? { safety } : {}) };
  });
}
function append(source: MutableSource, candidate: PassageCandidate, text: string) { source.excerpts.push({ text, ...(source.anchor ? { anchor: source.anchor } : {}), codeBlock: candidate.codeBlock, seed: candidate }); }
function replaceCoveredShorter(source: MutableSource, all: MutableSource[]) {
  const replacementIndex = source.excerpts.length - 1;
  const replacement = source.excerpts[replacementIndex]!;
  let refunded = 0;
  for (const other of all) {
    if (other === source || other.required) continue;
    for (let index = other.excerpts.length - 1; index >= 0; index--) {
      const excerpt = other.excerpts[index]!;
      if (passageMayBeFlagged(other, excerpt.text) || passageMayBeFlagged(source, replacement.text)) continue;
      if (comparePassages(excerpt.text, replacement.text, { leftCodeBlock: excerpt.codeBlock, rightCodeBlock: replacement.codeBlock }) !== 'left-contained') continue;
      // Preserve every existing alias by redirecting it to text that actually
      // covers the removed excerpt, and repair indexes after the splice.
      for (const holder of all) holder.samePassageAs = holder.samePassageAs?.map((coverage) => {
        if (coverage.sourceId !== other.id) return coverage;
        if (coverage.excerptIndex === index) return { sourceId: source.id, excerptIndex: replacementIndex, relation: 'covered' as const };
        return coverage.excerptIndex > index ? { ...coverage, excerptIndex: coverage.excerptIndex - 1 } : coverage;
      }).filter((coverage) => coverage.sourceId !== holder.id);
      other.excerpts.splice(index, 1);
      refunded += codePoints(excerpt.text);
      other.samePassageAs = [...(other.samePassageAs ?? []), { sourceId: source.id, excerptIndex: replacementIndex, relation: 'covered' }];
    }
  }
  return refunded;
}

function standard(input: ResultAllocationInput): ResultAllocation {
  const sources = makeSources(input.sources); let pool = STANDARD_POOL;
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!; const document = input.sources[index]!.readerDocument;
    // Preserve reader bytes, including fence whitespace and paragraph order, in one lossless emitted text.
    if (source.required && source.reader && document !== undefined) source.excerpts.push({ text: document, ...(source.anchor ? { anchor: source.anchor } : {}) });
  }
  const add = (source: MutableSource, candidate: PassageCandidate, requiredMinimum: boolean) => {
    if (source.excerpts.length >= MAX_EXCERPTS || isAbsorbed(source, candidate) || emitCoverage(source, candidate, sources)) return;
    if (!candidate.text) return;
    if (!requiredMinimum && pool <= 0) { source.spaceCut = true; return; }
    const emitted = admit(source, candidate, requiredMinimum ? MAX_EXCERPT_CHARS : Math.min(MAX_EXCERPT_CHARS, pool));
    if (!emitted.text) { source.spaceCut = true; return; }
    pool -= codePoints(emitted.text);
    if (!requiredMinimum && emitted.clipped) source.spaceCut = true;
  };
  // Every required ordinary source gets its first real excerpt before any source gets extras.
  for (const source of sources.filter((source) => source.required && !source.reader)) {
    const first = candidatesFor(source)[0]; if (first) add(source, first, true);
  }
  for (const { source, candidate } of dependencyOrder(sources.filter((source) => source.required && !source.reader))) {
    if (isAbsorbed(source, candidate)) continue;
    add(source, candidate, false);
  }
  // Search results share what remains in source rank order.  Do not let the
  // first long result drain the ordinary pool before later results get a turn.
  const discovered = sources.filter((source) => !source.required);
  for (let index = 0; index < discovered.length; index++) {
    const source = discovered[index]!;
    const share = Math.min(MAX_EXCERPTS * MAX_EXCERPT_CHARS, Math.floor(pool / (discovered.length - index)));
    if (share < 300) {
      for (const remaining of discovered.slice(index)) if (remaining.candidates.length) remaining.spaceCut = true;
      break;
    }
    let allotted = 0;
    for (const [rank, candidate] of rankedFor(source).entries()) {
      if (source.excerpts.length >= MAX_EXCERPTS) break;
      if (isAbsorbed(source, candidate) || !mayFillSlot(source, candidate, rank) || emitCoverage(source, candidate, sources)) continue;
      const emitted = admit(source, candidate, Math.min(MAX_EXCERPT_CHARS, pool, share - allotted));
      if (!emitted.text) { source.spaceCut = true; break; }
      pool += replaceCoveredShorter(source, sources);
      const used = codePoints(emitted.text); allotted += used; pool -= used;
      if (emitted.clipped) { source.spaceCut = true; break; }
    }
    if (source.candidates.length && !source.excerpts.length && !(source.samePassageAs?.length)) source.spaceCut = true;
  }
  growAll(sources, () => pool, (_source, added) => { pool -= added; });
  const findings = selectedFindings(input).filter((finding) => !isFindingCovered(finding, sources));
  const priority = formatPriorityContext(input.context, 1000);
  const searched = formatSearchedContext(input.context, Math.max(0, 1000 - counted([], [], priority) - (priority.length ? 1 : 0)));
  const context = [...priority, ...searched];
  return { evidence: publicSources(sources, findings), modelResult: { findings, contextLines: context, contentChars: counted(findings, sources, context) }, cutSourceIds: sources.filter((source) => source.spaceCut).map((source) => source.id), requiredOverflowChars: 0 };
}

function bounded(input: ResultAllocationInput, limit: number): ResultAllocation {
  const sources = makeSources(input.sources); const priority = formatPriorityContext(input.context, Math.floor(limit * .15));
  const reserved: ModelFinding[] = [];
  const candidates = selectedFindings(input);
  for (const finding of candidates) if (countResultContent([...reserved, finding].map((item) => item.text), [], []) <= Math.floor(limit * .20)) reserved.push(finding);
  const add = (source: MutableSource, candidate: PassageCandidate, requiredMinimum: boolean) => {
    if (source.excerpts.length >= excerptLimit(source) || isAbsorbed(source, candidate) || emitCoverage(source, candidate, sources)) return;
    const original = clipCodePoints(candidate.text, MAX_EXCERPT_CHARS); if (!original) return;
    const existing = excerpts(sources); const base = countResultContent(reserved.map((finding) => finding.text), existing, priority);
    const next = countResultContent(reserved.map((finding) => finding.text), [...existing, original], priority);
    const room = limit - base - (next - base - codePoints(original));
    if (!requiredMinimum && !source.required && room < 300) { source.spaceCut = true; return; }
    const emitted = admit(source, candidate, requiredMinimum ? Math.max(codePoints(original), Math.min(MAX_EXCERPT_CHARS, room)) : Math.min(MAX_EXCERPT_CHARS, room));
    if (!emitted.text) { source.spaceCut = true; return; }
    if (!requiredMinimum && emitted.clipped) source.spaceCut = true;
  };
  for (const source of sources.filter((source) => source.required)) { const first = candidatesFor(source)[0]; if (first) add(source, first, true); }
  for (const { source, candidate } of dependencyOrder(sources.filter((source) => source.required))) if (!isAbsorbed(source, candidate)) add(source, candidate, false);
  // The finite budget includes separators.  Allocate a source's share before
  // moving to the next ranked search result so clipping cannot hide later IDs.
  const discovered = sources.filter((source) => !source.required);
  if (limit < BEST_FIRST_BELOW) {
    const queue = discovered.flatMap((source, sourceOrder) => rankedFor(source).map((candidate, candidateOrder) => ({ source, candidate, sourceOrder, candidateOrder })))
      .sort((a, b) => b.candidate.score - a.candidate.score || a.sourceOrder - b.sourceOrder || a.candidateOrder - b.candidateOrder);
    for (const { source, candidate, candidateOrder } of queue) {
      if (source.excerpts.length >= MAX_EXCERPTS || isAbsorbed(source, candidate) || !mayFillSlot(source, candidate, candidateOrder) || emitCoverage(source, candidate, sources)) continue;
      const before = counted(reserved, sources, priority);
      const separator = countResultContent(reserved.map((finding) => finding.text), [...excerpts(sources), 'X'], priority) - before - 1;
      const room = limit - before - separator;
      if (room <= 0 || (room < codePoints(candidate.text) && room < MIN_CLIPPED_CHARS)) { source.spaceCut = true; continue; }
      const emitted = admit(source, candidate, Math.min(MAX_EXCERPT_CHARS, room));
      replaceCoveredShorter(source, sources);
      if (emitted.clipped) source.spaceCut = true;
    }
  } else for (let index = 0; index < discovered.length; index++) {
    const source = discovered[index]!;
    const base = counted(reserved, sources, priority);
    const share = Math.min(MAX_EXCERPTS * MAX_EXCERPT_CHARS, Math.floor(Math.max(0, limit - base) / (discovered.length - index)));
    const sourceSeparator = countResultContent(reserved.map((finding) => finding.text), [...excerpts(sources), 'X'], priority) - base - 1;
    if (share - sourceSeparator < 300) {
      for (const remaining of discovered.slice(index)) if (remaining.candidates.length) remaining.spaceCut = true;
      break;
    }
    let allotted = 0;
    for (const [rank, candidate] of rankedFor(source).entries()) {
      if (source.excerpts.length >= MAX_EXCERPTS) break;
      if (isAbsorbed(source, candidate) || !mayFillSlot(source, candidate, rank) || emitCoverage(source, candidate, sources)) continue;
      const before = counted(reserved, sources, priority);
      const separator = countResultContent(reserved.map((finding) => finding.text), [...excerpts(sources), 'X'], priority) - before - 1;
      const emitted = admit(source, candidate, Math.min(MAX_EXCERPT_CHARS, Math.max(0, Math.min(share - allotted - separator, limit - before - separator))));
      if (!emitted.text) { source.spaceCut = true; break; }
      replaceCoveredShorter(source, sources);
      // Charge this source's admission before replacement frees another
      // source's text; the refund belongs only to later ranked sources.
      allotted += codePoints(emitted.text) + separator;
      if (emitted.clipped) { source.spaceCut = true; break; }
    }
    if (source.candidates.length && !source.excerpts.length && !(source.samePassageAs?.length)) source.spaceCut = true;
  }
  for (const source of sources) if (!source.required && source.candidates.length && !source.excerpts.length && !(source.samePassageAs?.length)) source.spaceCut = true;
  growAll(sources, () => limit - counted(reserved, sources, priority), () => undefined);
  const findings = reserved.filter((finding) => !isFindingCovered(finding, sources));
  for (const finding of candidates) {
    if (reserved.includes(finding) || isFindingCovered(finding, sources)) continue;
    for (const id of finding.sourceIds) {
      const source = sourceById(sources, id);
      if (source) source.spaceCut = true;
    }
  }
  const beforeSearch = counted(findings, sources, priority);
  let searched = formatSearchedContext(input.context, Math.max(0, limit - beforeSearch));
  let context = [...priority, ...searched];
  let contentChars = counted(findings, sources, context);
  // Searched joins a pre-existing context with one newline, or starts a new content
  // section with two. Refit the rendered line, rather than assuming its raw length.
  if (contentChars > limit && searched.length) {
    searched = formatSearchedContext(input.context, Math.max(0, limit - beforeSearch - (contentChars - limit)));
    context = [...priority, ...searched]; contentChars = counted(findings, sources, context);
  }
  return { evidence: publicSources(sources, findings), modelResult: { findings, contextLines: context, contentChars }, cutSourceIds: sources.filter((source) => source.spaceCut).map((source) => source.id), effectiveChars: limit, requiredOverflowChars: Math.max(0, contentChars - limit) };
}
export function allocateResult(input: ResultAllocationInput): ResultAllocation {
  const resolved = resolveLengthLimit(input.setting, input.model?.contextWindow); const standardResult = standard(input);
  if (resolved.kind === 'standard') return standardResult;
  if (input.setting === 'auto' && standardResult.modelResult.contentChars <= resolved.chars) return { ...standardResult, effectiveChars: standardResult.modelResult.contentChars };
  return bounded(input, resolved.chars);
}
