import { extractDirectUrls } from './direct-url.js';
import type { ResearchEvidence } from './research-types.js';
import { parseRepoUrl } from '../repo/repo-url.js';

export type ResearchTarget = { kind: 'url' | 'name'; value: string };
export type ResearchIntent = { kind: 'read' | 'compare' | 'research'; targets: ResearchTarget[]; requiresAlternative: boolean };

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
  if (urls.length === 1 && parseRepoUrl(urls[0]) && !/\b(?:alternatives?|other sources?|research)\b/i.test(query)) {
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
        if (extractDirectUrls(item.url)[0] === target.value) return true;
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
    const urls = new Set(evidence.map((item) => extractDirectUrls(item.url)[0] ?? item.url));
    if (urls.size < 2) missing.push('alternatives');
  }
  return missing;
}
