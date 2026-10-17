import { extractDirectUrls } from './direct-url.js';
import type { ResearchEvidence } from './research-types.js';
import { parseRepoUrl } from '../repo/repo-url.js';
import { canonicalizeUrl } from './url.js';

export type ResearchTarget = { kind: 'url' | 'name'; value: string };
export type ResearchIntent = { kind: 'read' | 'compare' | 'research'; targets: ResearchTarget[]; requiresAlternative: boolean };

const GENERIC_SUBJECT_WORDS = new Set([
  'about', 'api', 'article', 'docs', 'documentation', 'guide', 'guides', 'home', 'index',
  'introduction', 'learn', 'overview', 'reference', 'resources', 'tutorial', 'tutorials'
]);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function subjectTerms(title: string): Set<string> {
  const subject = title.split(/[|–—-]/, 1)[0] ?? title;
  return new Set(
    subject.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((word) => !GENERIC_SUBJECT_WORDS.has(word)) ?? []
  );
}

function coversUrl(item: ResearchEvidence, target: string): boolean {
  const requested = canonicalizeUrl(target);
  return requested !== undefined && [item.requestedUrl, item.url]
    .some((url) => url !== undefined && canonicalizeUrl(url) === requested);
}

function representsDistinctSubject(left: ResearchEvidence, right: ResearchEvidence): boolean {
  const leftRepo = parseRepoUrl(left.url);
  const rightRepo = parseRepoUrl(right.url);
  if (leftRepo || rightRepo) {
    return leftRepo !== undefined && rightRepo !== undefined &&
      `${leftRepo.owner}/${leftRepo.repo}`.toLowerCase() !== `${rightRepo.owner}/${rightRepo.repo}`.toLowerCase();
  }

  const leftHost = hostOf(left.url);
  const rightHost = hostOf(right.url);
  if (!leftHost || !rightHost) return left.url !== right.url;
  if (leftHost !== rightHost) return true;

  const leftTerms = subjectTerms(left.title);
  const rightTerms = subjectTerms(right.title);
  return leftTerms.size > 0 && rightTerms.size > 0 &&
    ![...leftTerms].some((term) => rightTerms.has(term));
}

function asksForExternalOpinions(query: string): boolean {
  return /\b(?:opinions?|experiences?|user (?:reviews?|feedback)|community (?:feedback|opinions?|experiences?|reviews?)|what do (?:users|people|developers) think|(?:users|people|developers) (?:think|feel|say))\b/i.test(query);
}

export function classifyResearchIntent(query: string): ResearchIntent {
  const urls = extractDirectUrls(query);
  const urlTargets: ResearchTarget[] = urls.map((value) => ({ kind: 'url', value }));
  const compare = /\b(?:compare|comparison|versus|vs\.?)\b/i.test(query);
  if (compare) {
    const targets = [...urlTargets];
    if (urls.length === 1) {
      const name = query.trim().match(/^compare\s+https?:\/\/\S+\s+(?:with|and|vs\.?|versus)\s+([\w.-]+(?:\s+[\w.-]+)?)\s*[?.!]?$/i)?.[1]
        ?? query.trim().match(/^compare\s+([\w.-]+(?:\s+[\w.-]+)?)\s+(?:with|and|vs\.?|versus)\s+https?:\/\/\S+\s*[?.!]?$/i)?.[1];
      if (name && !/^alternatives?$/i.test(name)) targets.push({ kind: 'name', value: name });
    } else if (urls.length === 0) {
      const match = query.trim().match(/^(?:compare\s+)?([\w.-]+(?:\s+[\w.-]+)?)\s+(?:and|vs\.?|versus)\s+([\w.-]+(?:\s+[\w.-]+)?)\s*[?.!]?$/i);
      if (match) targets.push({ kind: 'name', value: match[1] }, { kind: 'name', value: match[2] });
    }
    return { kind: 'compare', targets, requiresAlternative: targets.length < 2 };
  }
  if (urls.length === 1 && /\b(?:read|summari[sz]e)\b/i.test(query) &&
    !/\bhow\s+to\s+(?:read|summari[sz]e)\b/i.test(query) &&
    !/\b(?:alternatives?|other sources?|research|find|compare|versus|vs\.?)\b/i.test(query)) {
    return { kind: 'read', targets: urlTargets, requiresAlternative: false };
  }
  if (urls.length === 1 && parseRepoUrl(urls[0]) &&
    !/\b(?:alternatives?|other sources?|research)\b/i.test(query) &&
    !asksForExternalOpinions(query)) {
    return { kind: 'read', targets: urlTargets, requiresAlternative: false };
  }
  return { kind: 'research', targets: [], requiresAlternative: false };
}

export function missingComparisonTargets(intent: ResearchIntent, evidence: ResearchEvidence[]): string[] {
  if (intent.kind !== 'compare') return [];
  const missing = intent.targets.filter((target) => {
    if (target.kind === 'url') {
      const requestedRepo = parseRepoUrl(target.value);
      return !evidence.some((item) => {
        if (coversUrl(item, target.value)) return true;
        const foundRepo = parseRepoUrl(item.url);
        return requestedRepo && !requestedRepo.refAndPath && foundRepo && item.method === 'github' &&
          requestedRepo.owner.toLowerCase() === foundRepo.owner.toLowerCase() && requestedRepo.repo.toLowerCase() === foundRepo.repo.toLowerCase();
      });
    }
    const escaped = target.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    return !evidence.some((item) => pattern.test([item.url, item.title, item.summary, ...item.supports].join(' ')));
  }).map((target) => target.value);
  if (intent.requiresAlternative) {
    const requested = intent.targets.find((target): target is ResearchTarget & { kind: 'url' } => target.kind === 'url');
    const primary = requested ? evidence.filter((item) => coversUrl(item, requested.value)) : evidence;
    if (!primary.some((item) => evidence.some((alternative) => alternative !== item && representsDistinctSubject(item, alternative)))) {
      missing.push('alternatives');
    }
  }
  return missing;
}
