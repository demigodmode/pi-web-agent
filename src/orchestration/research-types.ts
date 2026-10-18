import type { Attempt, FailureInfo, SearchProviderName, SearchUnavailable } from '../types.js';
import type { ResearchBudgetReason, ResearchBudgetSnapshot } from './run-budget.js';

export type ResearchSourceKind =
  | 'official-docs'
  | 'official-api'
  | 'official-discussion'
  | 'community'
  | 'issue-thread'
  | 'package-page'
  | 'unknown'
  | 'other';

export type ResearchMethod = 'search' | 'http' | 'headless' | 'firecrawl' | 'github' | 'pdf' | 'youtube';

export type ResearchEvidence = {
  title: string;
  url: string;
  /** The link the user typed, set on every direct or repo read (also when it redirected). */
  requestedUrl?: string;
  sourceKind: ResearchSourceKind;
  method: Exclude<ResearchMethod, 'search'>;
  summary: string;
  supports: string[];
  sectionAnchor?: string;
  retrievedAt?: string;
  truncated?: boolean;
  partialComments?: boolean;
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
  /** The search backends that failed with a user-fixable kind on this pass. */
  searchUnavailable?: SearchUnavailable[];
  /** True when every provider that failed on this pass failed with a user-fixable kind. */
  searchUnavailableOnly?: boolean;
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
  budgetReason?: ResearchBudgetReason;
  budget?: ResearchBudgetSnapshot;
  requiredSourceFailures?: RequiredSourceFailure[];
};

export type RequiredSourceFailure = {
  url: string;
  code: string;
  message: string;
  reason: 'read-failed' | 'limit' | 'deadline-in-flight' | 'deadline-unvisited';
  failure?: FailureInfo;
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
