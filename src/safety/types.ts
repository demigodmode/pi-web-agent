export type AgentNote = 'site-authors' | 'repo-author';

export interface SourceSafety {
  flaggedParagraphs: string[];
  agentNotes: AgentNote[];
}

export interface EmittedSourceSafety {
  markedParagraphs: string[];
  agentNotes: AgentNote[];
}
