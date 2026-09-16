import type { Attempt, SearchProviderName } from '../types.js';

export type ResearchSourceKind =
  | 'primary-content'
  | 'official-docs'
  | 'official-api'
  | 'official-discussion'
  | 'community'
  | 'issue-thread'
  | 'package-page'
  | 'other';

export type ResearchMethod = 'search' | 'http' | 'headless' | 'firecrawl' | 'github' | 'pdf' | 'youtube';

export type ResearchEvidence = {
  title: string;
  url: string;
  sourceKind: ResearchSourceKind;
  method: Exclude<ResearchMethod, 'search'>;
  summary: string;
  supports: string[];
};

export type ResearchGap = {
  kind: 'needs-more-evidence' | 'conflict' | 'fetch-failed';
  message: string;
};

export type ResearchLowValueOutcome = {
  kind: 'empty-search' | 'bot-check' | 'low-value-page' | 'duplicate-evidence';
  url?: string;
  message: string;
};

export type ResearchWorkerResult = {
  searchQueries: string[];
  evidence: ResearchEvidence[];
  gaps: ResearchGap[];
  lowValueOutcomes: ResearchLowValueOutcome[];
  suggestedHeadlessUrl?: string;
  exhaustedBudget: boolean;
  fanoutProviders?: SearchProviderName[];
  fanoutSkipped?: SearchProviderName[];
  searchCoveragePartial?: boolean;
  searchAttempts?: Attempt[];
  fetchAttempts?: Attempt[];
  terminalFailure?: { code: string; message: string };
};

export type ResearchRunMetadata = {
  searchPasses: number;
  fetchedPages: number;
  headlessAttempts: number;
  exhaustedBudget: boolean;
  fanoutProviders?: SearchProviderName[];
  fanoutSkipped?: SearchProviderName[];
  searchCoveragePartial?: boolean;
  terminalFailure?: { code: string; message: string };
};

export type ResearchOrchestratorDecision =
  | {
      action: 'answer';
      rationale: string;
      approvedEvidence: ResearchEvidence[];
    }
  | {
      action: 'research-again';
      rationale: string;
      followupQuery: string;
    }
  | {
      action: 'escalate-headless';
      rationale: string;
      url: string;
      approvedEvidence: ResearchEvidence[];
    };
