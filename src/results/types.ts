export type LengthLimit = 'auto' | 'short' | 'medium' | 'standard' | number;

export type ResultsConfig = {
  lengthLimit: LengthLimit;
};

export type ResultsOverride = {
  lengthLimit?: LengthLimit;
  cleared?: Array<'lengthLimit'>;
};

export type ResultsConfigFile = {
  results?: {
    lengthLimit?: unknown;
    cleared?: unknown;
  };
};

export type ModelContext = {
  id?: string;
  provider?: string;
  contextWindow?: number;
};

export type ResolvedLength =
  | { kind: 'standard' }
  | { kind: 'bounded'; chars: number };

import type { FetchMethod } from '../types.js';
import type { PassageCandidate } from '../orchestration/evidence-passages.js';
import type { ContextMetadata } from '../presentation/research-context.js';

export type PreparedSource = {
  id: string;
  required: boolean;
  reader: boolean;
  title: string;
  url: string;
  requestedUrl?: string;
  method: FetchMethod;
  findingIndex?: number;
  findingText?: string;
  sectionAnchor?: string;
  ranked: PassageCandidate[];
  readerDocument?: string;
  retrievalCut: boolean;
  selectionOmitted: boolean;
  retrievedAt?: string;
};

export type AllocatedExcerpt = { text: string; anchor?: string };
export type ExcerptCoverage = { sourceId: string; excerptIndex: number; relation: 'same' | 'covered' };
export type AllocatedSource = {
  id: string;
  title: string;
  url: string;
  requestedUrl?: string;
  method: FetchMethod;
  excerpts: AllocatedExcerpt[];
  samePassageAs?: ExcerptCoverage[];
  retrievalCut: boolean;
  selectionOmitted: boolean;
  spaceCut: boolean;
  retrievedAt?: string;
};
export type ModelFinding = { index: number; text: string; sourceIds: string[] };
export type ModelResultSelection = { findings: ModelFinding[]; contextLines: string[]; contentChars: number };
export type ResultAllocation = {
  evidence: AllocatedSource[];
  modelResult: ModelResultSelection;
  cutSourceIds: string[];
  effectiveChars?: number;
  requiredOverflowChars: number;
};
export type ResultAllocationInput = {
  sources: PreparedSource[];
  findings: string[];
  findingSourceIds: string[][];
  context: ContextMetadata;
  setting: LengthLimit;
  model?: ModelContext;
};
