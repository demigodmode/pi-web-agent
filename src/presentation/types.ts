export const PRESENTATION_MODES = ['compact', 'preview', 'verbose'] as const;
export type PresentationMode = (typeof PRESENTATION_MODES)[number];

export type PresentationViews = {
  compact: string;
  preview?: string;
  verbose?: string;
};

export type PresentationMetrics = {
  durationMs?: number;
  resultCount?: number;
  sourceCount?: number;
  wordCount?: number;
  statusCode?: number;
  cacheHit?: boolean;
  truncated?: boolean;
};

export type PresentationSource = {
  title: string;
  url: string;
  domain?: string;
};

export type PresentationEnvelope = {
  mode: PresentationMode;
  views: PresentationViews;
  metrics?: PresentationMetrics;
  sources?: PresentationSource[];
  debug?: Record<string, unknown>;
};

export type PresentationToolName =
  | 'web_search'
  | 'web_fetch'
  | 'web_fetch_headless'
  | 'web_explore';

export type PresentationConfig = {
  defaultMode: PresentationMode;
  tools: Partial<Record<PresentationToolName, { mode: PresentationMode }>>;
};
