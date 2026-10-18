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
  switch (progress.phase) {
    case 'search': return `Searching web (${progress.searches}/5)...`;
    case 'fetch': return `Reading pages (${progress.fetches}/20)...`;
    case 'headless': return `Rendering page (${progress.headless}/2)...`;
    case 'complete': return 'Research complete.';
  }
}
