import { clipTerminalText, safeDisplayQuery, safeDisplayUrl } from '../presentation/explore-call.js';

export type ResearchProgress = {
  phase: 'search' | 'fetch' | 'headless' | 'complete';
  state?: 'started' | 'settled';
  target?: string;
  searches: number;
  fetches: number;
  headless: number;
  pagesRead?: number;
  failedReads?: number;
};

export function formatResearchProgress(progress: ResearchProgress): string {
  const activity = (label: string, target: string | undefined, formatTarget: (value: string) => string | undefined, suffix = '') => {
    const display = target === undefined ? undefined : formatTarget(target);
    const prefix = `${label}: `;
    return display ? `${prefix}${clipTerminalText(display, Math.max(0, 120 - Array.from(prefix).length - Array.from(suffix).length))}${suffix}` : label;
  };
  switch (progress.phase) {
    case 'search': return activity('Searching', progress.target, (target) => safeDisplayQuery(target, 120));
    case 'fetch': {
      const reads = `${progress.fetches} ${progress.fetches === 1 ? 'read' : 'reads'} started`;
      return progress.target
        ? activity('Reading', progress.target, (target) => safeDisplayUrl(String(target)), ` · ${reads}`)
        : reads;
    }
    case 'headless': return activity('Rendering', progress.target, (target) => safeDisplayUrl(String(target)));
    case 'complete': return 'Research complete.';
  }
}
