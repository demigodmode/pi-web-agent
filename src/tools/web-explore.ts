import { createResearchWorkflow } from '../orchestration/index.js';
import { synthesizeAnswer } from '../orchestration/answer-synthesizer.js';
import type { ResearchEvidence } from '../orchestration/research-types.js';
import { buildExplorePresentation } from '../presentation/explore-presentation.js';
import type { EvidenceCaveatReason } from '../orchestration/evidence-quality.js';
import type { WebExploreResponse } from '../types.js';
import { raceAbort, throwIfAborted } from '../abort.js';
import { prepareEvidenceSources } from './evidence-records.js';
import { allocateResult } from '../results/allocate.js';
import { DEFAULT_RESULTS_CONFIG } from '../results/config.js';
import type { ModelContext, ResultsConfig } from '../results/types.js';
import type { ResearchProgress } from '../orchestration/progress.js';
import { redactUrlForDisplay, redactUrlsInText } from '../orchestration/url.js';
import type { PresentationEnvelope } from '../presentation/types.js';
import { detectInputSecret } from '../safety/secrets.js';
import { secretRefusal } from '../safety/refusal.js';

// Output-only: the orchestrator keeps raw URLs for fetching, and every view is built from this copy.
// Findings and evidence excerpts are page content and stay as read.
function redactStrings<T>(value: T): T {
  if (typeof value === 'string') return redactUrlsInText(value) as T;
  if (Array.isArray(value)) return value.map(redactStrings) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStrings(item)])) as T;
  }
  return value;
}

function withRedactedUrls(response: WebExploreResponse): WebExploreResponse {
  const redactUrls = <T extends { url: string; requestedUrl?: string }>(item: T): T => ({
    ...item,
    url: redactUrlForDisplay(item.url),
    ...(item.requestedUrl ? { requestedUrl: redactUrlForDisplay(item.requestedUrl) } : {})
  });
  return {
    ...response,
    sources: response.sources.map(redactUrls),
    ...(response.evidence ? { evidence: response.evidence.map(redactUrls) } : {}),
    ...(response.caveat ? { caveat: redactUrlsInText(response.caveat) } : {}),
    ...(response.error ? { error: redactStrings(response.error) } : {}),
    ...(response.requiredSourceFailures ? { requiredSourceFailures: redactStrings(response.requiredSourceFailures) } : {}),
    ...(response.searchUnavailable ? { searchUnavailable: redactStrings(response.searchUnavailable) } : {}),
    ...(response.metadata ? { metadata: redactStrings(response.metadata) } : {})
  };
}

function toPublicResponse(response: WebExploreResponse): WebExploreResponse & { presentation: PresentationEnvelope } {
  const redacted = withRedactedUrls(response);
  return { ...redacted, presentation: buildExplorePresentation(redacted) };
}

type ExploreInput = { query: string; signal?: AbortSignal; onProgress?: (event: ResearchProgress) => void };
type ExploreResult = {
  decision: { action: 'answer' | 'research-again' | 'escalate-headless' };
  evidence: ResearchEvidence[];
  workerPass: unknown;
  metadata?: WebExploreResponse['metadata'];
  terminalFailure?: { code: string; message: string };
  requiredSourceEvidence?: ResearchEvidence[];
  requiredSourceFailures?: NonNullable<WebExploreResponse['requiredSourceFailures']>;
  searchUnavailable?: WebExploreResponse['searchUnavailable'];
};
type ExploreRunner = (input: ExploreInput) => Promise<ExploreResult>;

export function createWebExploreTool({
  explore,
  now = () => performance.now()
}: {
  explore?:
    | {
        run: ExploreRunner;
      }
    | ExploreRunner;
  now?: () => number;
} = {}) {
  let runExplore: ExploreRunner | undefined;
  const getRunExplore = (): ExploreRunner => {
    if (!runExplore) {
      const configured = explore ?? createResearchWorkflow();
      const runner: ExploreRunner = typeof configured === 'function' ? configured : configured.run.bind(configured);
      runExplore = runner;
    }
    return runExplore;
  };

  return async function webExplore({ query, signal, onProgress, startedAt, results = DEFAULT_RESULTS_CONFIG, modelContext }: { query: string; signal?: AbortSignal; onProgress?: (event: ResearchProgress) => void; startedAt?: number; results?: ResultsConfig; modelContext?: ModelContext }) {
    const localStartedAt = now();
    const durationMs = () => Math.max(0, now() - (startedAt ?? localStartedAt));
    throwIfAborted(signal);
    const secret = detectInputSecret(query);
    if (secret) return toPublicResponse({ ...secretRefusal(secret), durationMs: durationMs() });
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      const result: WebExploreResponse = {
        status: 'error',
        durationMs: durationMs(),
        findings: [],
        sources: [],
        error: { code: 'INVALID_QUERY', message: 'Query must not be empty.' }
      };

      return toPublicResponse(result);
    }

    const safeProgress = onProgress ? (event: ResearchProgress) => {
      try { onProgress(event); } catch { /* Display callbacks must not fail research. */ }
    } : undefined;
    const run = getRunExplore()({ query: normalizedQuery, ...(signal ? { signal } : {}), ...(safeProgress ? { onProgress: safeProgress } : {}) });
    // Backstop: Pi waits for this promise, so answer the cancel right away even if
    // some layer underneath is slow to stop. The run itself keeps its lease in
    // extension.ts until it really settles.
    const result = signal ? await raceAbort(run, signal) : await run;
    const counts = result.metadata?.budget ?? {
      searches: result.metadata?.searchPasses ?? 0,
      fetches: result.metadata?.fetchedPages ?? 0,
      headless: result.metadata?.headlessAttempts ?? 0
    };
    const presentationStats = result.metadata?.presentationStats;
    safeProgress?.({ phase: 'complete', state: 'settled', searches: counts.searches, fetches: counts.fetches, headless: counts.headless, ...(presentationStats ? { pagesRead: presentationStats.pagesRead, failedReads: presentationStats.failedReads } : {}) });
    if (result.terminalFailure) {
      const required = result.requiredSourceEvidence ?? [];
      const publicEvidence = required;
      const base: WebExploreResponse = {
        status: 'error',
        durationMs: durationMs(),
        findings: required.map((item) => item.summary),
        sources: required.map((item) => ({ title: item.title, url: item.url, ...(item.requestedUrl ? { requestedUrl: item.requestedUrl } : {}), method: item.method })),
        evidence: [],
        findingSourceIds: required.map((_, index) => [`S${index + 1}`]),
        error: result.terminalFailure,
        metadata: result.metadata,
        requiredSourceFailures: result.requiredSourceFailures ?? result.metadata?.requiredSourceFailures,
        ...(result.searchUnavailable ? { searchUnavailable: result.searchUnavailable } : {})
      };
      return allocatePublicResponse(base, publicEvidence, normalizedQuery, required.length, results, modelContext);
    }

    const required = result.requiredSourceEvidence ?? [];
    const discretionary = result.evidence.filter((item) => !required.some((direct) =>
      (direct.requestedUrl !== undefined && direct.requestedUrl === item.requestedUrl) || direct.url === item.url
    ));
    const publicEvidence = [...required, ...discretionary].slice(0, required.length + 5);
    const selectedEvidence = [...required, ...discretionary].slice(0, 5);
    const sources = publicEvidence.map((item) => ({
      title: item.title,
      url: item.url,
      ...(item.requestedUrl ? { requestedUrl: item.requestedUrl } : {}),
      method: item.method
    }));
    const reasons = (result.metadata?.caveatReasons ?? []) as EvidenceCaveatReason[];
    const decisionPartial = result.decision.action !== 'answer';
    const coveragePartial = reasons.includes('partial-search-coverage');
    const threadCommentsPartial = reasons.includes('partial-thread-comments');
    const synthesized = synthesizeAnswer({
      evidence: selectedEvidence,
      partial: decisionPartial || coveragePartial || threadCommentsPartial,
      // A confident answer with partial coverage mentions only the coverage, not unrelated quality notes.
      caveatReasons: decisionPartial ? reasons : reasons.filter((reason) => reason === 'partial-search-coverage' || reason === 'partial-thread-comments'),
      missingComparisonTargets: result.metadata?.missingComparisonTargets
    });

    const shaped: WebExploreResponse = {
      status: 'ok',
      durationMs: durationMs(),
      findings: synthesized.findings,
      sources,
      evidence: [],
      findingSourceIds: selectedEvidence.map((item) => [`S${publicEvidence.indexOf(item) + 1}`]),
      caveat: synthesized.caveat,
      metadata: result.metadata,
      requiredSourceFailures: result.requiredSourceFailures ?? result.metadata?.requiredSourceFailures,
      ...(result.searchUnavailable ? { searchUnavailable: result.searchUnavailable } : {})
    };

    return allocatePublicResponse(shaped, publicEvidence, normalizedQuery, required.length, results, modelContext);
  };
}

function allocatePublicResponse(base: WebExploreResponse, rawEvidence: ResearchEvidence[], query: string, requiredCount: number, results: ResultsConfig, modelContext?: ModelContext) {
  // URLs and metadata are public output. Candidate text remains the unredacted page content.
  const redacted = withRedactedUrls(base);
  const allocation = allocateResult({
    sources: prepareEvidenceSources(rawEvidence, query, requiredCount).map((source) => ({
      ...source,
      url: redactUrlForDisplay(source.url),
      ...(source.requestedUrl ? { requestedUrl: redactUrlForDisplay(source.requestedUrl) } : {})
    })),
    findings: redacted.findings,
    findingSourceIds: redacted.findingSourceIds ?? [],
    context: redacted.metadata ?? {},
    setting: results.lengthLimit,
    ...(modelContext ? { model: modelContext } : {})
  });
  const response: WebExploreResponse = {
    ...redacted,
    evidence: allocation.evidence,
    modelResult: allocation.modelResult,
    metadata: {
      ...(redacted.metadata ?? { searchPasses: 0, fetchedPages: 0, headlessAttempts: 0, exhaustedBudget: false }),
      resultLength: { setting: results.lengthLimit, ...(allocation.effectiveChars !== undefined ? { effectiveChars: allocation.effectiveChars } : {}), contentChars: allocation.modelResult.contentChars, requiredOverflowChars: allocation.requiredOverflowChars, cutSourceIds: allocation.cutSourceIds }
    }
  };
  return { ...response, presentation: buildExplorePresentation(response) };
}
