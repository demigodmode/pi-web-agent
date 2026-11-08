import { rankEvidencePassages, type PassageCandidate } from '../orchestration/evidence-passages.js';
import { formatPriorityContext, formatSearchedContext } from '../presentation/research-context.js';
import { comparePassages, containsPassageTokens } from './duplicate-passages.js';
import { resolveLengthLimit } from './length.js';
import { clipCodePoints, codePoints, countResultContent } from './content-length.js';
import type { AllocatedSource, ModelFinding, PreparedSource, ResultAllocation, ResultAllocationInput } from './types.js';

const MAX_EXCERPTS = 3;
const MAX_EXCERPT_CHARS = 900;
const STANDARD_POOL = 10_000;
type InternalExcerpt = { text: string; anchor?: string; codeBlock?: boolean };
type MutableSource = Omit<AllocatedSource, 'excerpts'> & { excerpts: InternalExcerpt[]; required: boolean; reader: boolean; candidates: PassageCandidate[]; anchor?: string };
type CandidateEntry = { source: MutableSource; candidate: PassageCandidate; sourceOrder: number; candidateOrder: number };

function findingText(text: string) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return codePoints(normalized) <= 180 ? normalized : `${clipCodePoints(normalized, 179).trimEnd()}…`;
}
function makeSources(sources: PreparedSource[]): MutableSource[] {
  return sources.map((source) => ({
    id: source.id, title: source.title, url: source.url, ...(source.requestedUrl ? { requestedUrl: source.requestedUrl } : {}), method: source.method,
    excerpts: [], retrievalCut: source.retrievalCut, selectionOmitted: source.selectionOmitted, spaceCut: false,
    ...(source.retrievedAt ? { retrievedAt: source.retrievedAt } : {}), required: source.required, reader: source.reader,
    ...(source.sectionAnchor ? { anchor: source.sectionAnchor } : {}),
    candidates: source.ranked.length ? source.ranked.map((candidate) => ({ ...candidate })) : rankEvidencePassages(source.readerDocument ?? '', '')
  }));
}
function excerptLimit(source: MutableSource) {
  return source.required && source.reader ? Infinity : MAX_EXCERPTS;
}
function candidatesFor(source: MutableSource) {
  return source.candidates.slice()
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, excerptLimit(source));
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
    return (source.samePassageAs ?? []).some((coverage) => {
      const target = sourceById(sources, coverage.sourceId)?.excerpts[coverage.excerptIndex];
      return target !== undefined && normalizedContains(target.text, finding.text);
    });
  });
}
function publicSources(sources: MutableSource[]): AllocatedSource[] { return sources.map(({ required: _required, reader: _reader, candidates: _candidates, anchor: _anchor, excerpts: local, ...source }) => ({ ...source, excerpts: local.map(({ codeBlock: _codeBlock, ...excerpt }) => excerpt) })); }
function append(source: MutableSource, candidate: PassageCandidate, text: string) { source.excerpts.push({ text, ...(source.anchor ? { anchor: source.anchor } : {}), codeBlock: candidate.codeBlock }); }
function replaceCoveredShorter(source: MutableSource, all: MutableSource[]) {
  const replacementIndex = source.excerpts.length - 1;
  const replacement = source.excerpts[replacementIndex]!;
  let refunded = 0;
  for (const other of all) {
    if (other === source || other.required) continue;
    for (let index = other.excerpts.length - 1; index >= 0; index--) {
      const excerpt = other.excerpts[index]!;
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
    if (source.excerpts.length >= MAX_EXCERPTS || emitCoverage(source, candidate, sources)) return;
    const original = clipCodePoints(candidate.text, MAX_EXCERPT_CHARS);
    if (!original) return;
    if (!requiredMinimum && pool <= 0) { source.spaceCut = true; return; }
    const text = requiredMinimum ? original : clipCodePoints(original, pool); if (!text) { source.spaceCut = true; return; }
    append(source, candidate, text); pool -= codePoints(text);
    if (!requiredMinimum && codePoints(text) < codePoints(original)) source.spaceCut = true;
  };
  // Every required ordinary source gets its first real excerpt before any source gets extras.
  for (const source of sources.filter((source) => source.required && !source.reader)) {
    const first = candidatesFor(source)[0]; if (first) add(source, first, true);
  }
  for (const { source, candidate } of dependencyOrder(sources.filter((source) => source.required && !source.reader))) {
    if (source.excerpts.some((excerpt) => excerpt.text === candidate.text)) continue;
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
    for (const candidate of candidatesFor(source)) {
      if (source.excerpts.length >= MAX_EXCERPTS) break;
      if (emitCoverage(source, candidate, sources)) continue;
      const original = clipCodePoints(candidate.text, MAX_EXCERPT_CHARS);
      const text = clipCodePoints(original, Math.min(pool, share - allotted));
      if (!text) { source.spaceCut = true; break; }
      append(source, candidate, text); pool += replaceCoveredShorter(source, sources);
      const used = codePoints(text); allotted += used; pool -= used;
      if (used < codePoints(original)) { source.spaceCut = true; break; }
    }
    if (source.candidates.length && !source.excerpts.length && !(source.samePassageAs?.length)) source.spaceCut = true;
  }
  const findings = selectedFindings(input).filter((finding) => !isFindingCovered(finding, sources));
  const priority = formatPriorityContext(input.context, 1000);
  const searched = formatSearchedContext(input.context, Math.max(0, 1000 - counted([], [], priority) - (priority.length ? 1 : 0)));
  const context = [...priority, ...searched];
  return { evidence: publicSources(sources), modelResult: { findings, contextLines: context, contentChars: counted(findings, sources, context) }, cutSourceIds: sources.filter((source) => source.spaceCut).map((source) => source.id), requiredOverflowChars: 0 };
}

function bounded(input: ResultAllocationInput, limit: number): ResultAllocation {
  const sources = makeSources(input.sources); const priority = formatPriorityContext(input.context, Math.floor(limit * .15));
  const reserved: ModelFinding[] = [];
  const candidates = selectedFindings(input);
  for (const finding of candidates) if (countResultContent([...reserved, finding].map((item) => item.text), [], []) <= Math.floor(limit * .20)) reserved.push(finding);
  const add = (source: MutableSource, candidate: PassageCandidate, requiredMinimum: boolean) => {
    if (source.excerpts.length >= excerptLimit(source) || emitCoverage(source, candidate, sources)) return;
    const original = clipCodePoints(candidate.text, MAX_EXCERPT_CHARS); if (!original) return;
    const existing = excerpts(sources); const base = countResultContent(reserved.map((finding) => finding.text), existing, priority);
    const next = countResultContent(reserved.map((finding) => finding.text), [...existing, original], priority);
    const room = limit - base - (next - base - codePoints(original));
    if (!requiredMinimum && !source.required && room < 300) { source.spaceCut = true; return; }
    const text = requiredMinimum ? original : clipCodePoints(original, room);
    if (!text) { source.spaceCut = true; return; }
    if (!requiredMinimum && codePoints(text) < codePoints(original)) source.spaceCut = true;
    append(source, candidate, text);
  };
  for (const source of sources.filter((source) => source.required)) { const first = candidatesFor(source)[0]; if (first) add(source, first, true); }
  for (const { source, candidate } of dependencyOrder(sources.filter((source) => source.required))) if (!source.excerpts.some((excerpt) => excerpt.text === candidate.text)) add(source, candidate, false);
  // The finite budget includes separators.  Allocate a source's share before
  // moving to the next ranked search result so clipping cannot hide later IDs.
  const discovered = sources.filter((source) => !source.required);
  for (let index = 0; index < discovered.length; index++) {
    const source = discovered[index]!;
    const base = counted(reserved, sources, priority);
    const share = Math.min(MAX_EXCERPTS * MAX_EXCERPT_CHARS, Math.floor(Math.max(0, limit - base) / (discovered.length - index)));
    const sourceSeparator = countResultContent(reserved.map((finding) => finding.text), [...excerpts(sources), 'X'], priority) - base - 1;
    if (share - sourceSeparator < 300) {
      for (const remaining of discovered.slice(index)) if (remaining.candidates.length) remaining.spaceCut = true;
      break;
    }
    let allotted = 0;
    for (const candidate of candidatesFor(source)) {
      if (source.excerpts.length >= MAX_EXCERPTS) break;
      if (emitCoverage(source, candidate, sources)) continue;
      const original = clipCodePoints(candidate.text, MAX_EXCERPT_CHARS);
      const before = counted(reserved, sources, priority);
      const separator = countResultContent(reserved.map((finding) => finding.text), [...excerpts(sources), 'X'], priority) - before - 1;
      const text = clipCodePoints(original, Math.max(0, Math.min(share - allotted - separator, limit - before - separator)));
      if (!text) { source.spaceCut = true; break; }
      append(source, candidate, text); replaceCoveredShorter(source, sources);
      // Charge this source's admission before replacement frees another
      // source's text; the refund belongs only to later ranked sources.
      allotted += codePoints(text) + separator;
      if (codePoints(text) < codePoints(original)) { source.spaceCut = true; break; }
    }
    if (source.candidates.length && !source.excerpts.length && !(source.samePassageAs?.length)) source.spaceCut = true;
  }
  for (const source of sources) if (!source.required && source.candidates.length && !source.excerpts.length && !(source.samePassageAs?.length)) source.spaceCut = true;
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
  return { evidence: publicSources(sources), modelResult: { findings, contextLines: context, contentChars }, cutSourceIds: sources.filter((source) => source.spaceCut).map((source) => source.id), effectiveChars: limit, requiredOverflowChars: Math.max(0, contentChars - limit) };
}
export function allocateResult(input: ResultAllocationInput): ResultAllocation {
  const resolved = resolveLengthLimit(input.setting, input.model?.contextWindow); const standardResult = standard(input);
  if (resolved.kind === 'standard') return standardResult;
  if (input.setting === 'auto' && standardResult.modelResult.contentChars <= resolved.chars) return { ...standardResult, effectiveChars: standardResult.modelResult.contentChars };
  return bounded(input, resolved.chars);
}
