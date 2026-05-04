import type { PresentationEnvelope } from './presentation/types.js';

export const TOOL_STATUSES = [
  'ok',
  'needs_headless',
  'blocked',
  'unsupported',
  'error'
] as const;

export type ToolStatus = (typeof TOOL_STATUSES)[number];

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type ToolError = {
  code: string;
  message: string;
};

export type SearchMetadata = {
  backend: 'duckduckgo';
  cacheHit: boolean;
};

export type FetchMetadata = {
  method: 'http' | 'headless';
  cacheHit: boolean;
  contentType?: string;
  truncated?: boolean;
  browser?: 'configured' | 'chrome' | 'edge' | 'brave' | 'chromium';
  navigationMs?: number;
};

export type ExtractedContent = {
  title?: string;
  byline?: string;
  text: string;
};

export type WebSearchResponse = {
  status: 'ok' | 'error';
  results: SearchResult[];
  metadata: SearchMetadata;
  presentation?: PresentationEnvelope;
  error?: ToolError;
};

export type WebFetchResponse = {
  status: ToolStatus;
  url: string;
  content?: ExtractedContent;
  metadata: FetchMetadata;
  presentation?: PresentationEnvelope;
  error?: ToolError;
};

export type WebFetchHeadlessResponse = {
  status: Exclude<ToolStatus, 'needs_headless'>;
  url: string;
  content?: ExtractedContent;
  metadata: FetchMetadata;
  presentation?: PresentationEnvelope;
  error?: ToolError;
};

export type WebExploreResponse = {
  status: 'ok' | 'error';
  findings: string[];
  sources: Array<{ title: string; url: string; method?: 'http' | 'headless' }>;
  caveat?: string;
  metadata?: {
    searchPasses: number;
    fetchedPages: number;
    headlessAttempts: number;
    exhaustedBudget: boolean;
  };
  presentation?: PresentationEnvelope;
  error?: ToolError;
};
