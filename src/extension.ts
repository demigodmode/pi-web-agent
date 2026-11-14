// Keep first: re-applies the jsdom/jiti compat patch before jsdom loads (#34).
import './jiti-compat-run.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { DEFAULT_BACKEND_CONFIG, type BackendConfig } from './backends/config.js';
import { Type } from 'typebox';
import { registerWebAgentConfigCommands } from './commands/web-agent-config.js';
import { DEFAULT_PRESENTATION_CONFIG, resolvePresentationMode } from './presentation/config.js';
import { createResearchWorkflow } from './orchestration/index.js';
import { loadPresentationConfigLayers } from './presentation/config-store.js';
import { selectPresentationView } from './presentation/select-view.js';
import { sanitizeTerminalText } from './presentation/explore-display-text.js';
import { renderExploreCall } from './presentation/explore-call.js';
import type { PresentationConfig } from './presentation/types.js';
import { createWebExploreTool } from './tools/web-explore.js';
import { buildExplorePresentation } from './presentation/explore-presentation.js';
import type { WebExploreResponse } from './types.js';
import { throwIfAborted } from './abort.js';
import { detectInputSecret } from './safety/secrets.js';
import { secretRefusal } from './safety/refusal.js';
import { getUpdateChangelogNotice } from './changelog-notice.js';
import { createRepoCache, type RepoCache } from './repo/repo-cache.js';
import { Text } from '@earendil-works/pi-tui';
import { formatResearchProgress } from './orchestration/progress.js';
import { serializeExploreResult } from './tools/serialize-explore-result.js';
import { DEFAULT_RESULTS_CONFIG } from './results/config.js';
import type { ModelContext } from './results/types.js';

const SESSION_SHUTDOWN_GRACE_MS = 5_000;

async function waitWithin<T>(work: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pi reports a cancelled call as its abort error text, with no terminal details of ours. */
function isCancelledResult(toolResult: { content?: unknown; details?: unknown }): boolean {
  if ((toolResult.details as { terminalText?: string } | undefined)?.terminalText) return false;
  const parts = Array.isArray(toolResult.content) ? toolResult.content as Array<{ text?: unknown }> : [];
  const text = parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join(' ').trim();
  return /^(?:this |the )?operation (?:was )?aborted\.?$/i.test(text);
}

async function loadWebAgentConfig(pi: ExtensionAPI) {
  const store = (
    pi as ExtensionAPI & {
      __presentationConfigStore?: {
        load?: typeof loadPresentationConfigLayers;
      };
    }
  ).__presentationConfigStore;

  return store?.load?.() ?? loadPresentationConfigLayers();
}

async function getEffectivePresentationConfig(pi: ExtensionAPI): Promise<PresentationConfig> {
  try {
    const loaded = await loadWebAgentConfig(pi);
    return loaded.effectiveConfig;
  } catch {
    return DEFAULT_PRESENTATION_CONFIG;
  }
}

async function getEffectiveBackendConfig(pi: ExtensionAPI): Promise<BackendConfig> {
  try {
    const loaded = await loadWebAgentConfig(pi);
    return loaded.effectiveBackends ?? DEFAULT_BACKEND_CONFIG;
  } catch {
    return DEFAULT_BACKEND_CONFIG;
  }
}

export default function extension(pi: ExtensionAPI) {
  registerWebAgentConfigCommands(pi);

  const injectedWebExplore = (pi as ExtensionAPI & { __webExploreTool?: ReturnType<typeof createWebExploreTool> }).__webExploreTool;
  const now = (pi as ExtensionAPI & { __webExploreNow?: () => number }).__webExploreNow ?? (() => performance.now());
  type Workflow = ReturnType<typeof createResearchWorkflow>;
  // Clones live for the Pi session (#72): the extension owns the cache, not a backend set,
  // so a backend config change keeps them and session_shutdown removes them.
  const makeRepoCache = (pi as ExtensionAPI & { __repoCacheFactory?: () => RepoCache }).__repoCacheFactory ?? (() => createRepoCache());
  type Session = {
    repoCache: RepoCache;
    shutdownDeadline?: number;
    cachedBackendKey?: string;
    cachedWorkflow?: Workflow;
    cachedWebExplore?: ReturnType<typeof createWebExploreTool>;
    workflows: Set<Workflow>;
    operations: Set<Promise<unknown>>;
  };
  const makeSession = (): Session => ({
    repoCache: makeRepoCache(),
    workflows: new Set<Workflow>(),
    operations: new Set<Promise<unknown>>()
  });
  let session = makeSession();
  // Runs in flight per workflow, so a replaced workflow is never closed mid-run.
  const activeRuns = new Map<Workflow, number>();
  const activeRunSettlements = new Map<Workflow, Set<Promise<void>>>();
  const retiring = new Set<Workflow>();
  const closePromises = new Map<Workflow, Promise<void>>();
  const closeWorkflowNow = (workflow: Workflow): Promise<void> => {
    const existing = closePromises.get(workflow);
    if (existing) return existing;
    retiring.delete(workflow);
    const closing = Promise.resolve().then(() => (workflow as { close?: () => Promise<void> }).close?.()).catch(() => undefined);
    closePromises.set(workflow, closing);
    return closing;
  };

  const closeWorkflow = (workflow: Workflow) => {
    void closeWorkflowNow(workflow);
  };

  const retire = (workflow: Workflow) => {
    if ((activeRuns.get(workflow) ?? 0) === 0) {
      closeWorkflow(workflow);
    } else {
      retiring.add(workflow);
    }
  };

  const leased = (workflow: Workflow) => ({
    run: async (input: Parameters<Workflow['run']>[0]) => {
      let finish!: () => void;
      const settled = new Promise<void>((resolve) => { finish = resolve; });
      const settlements = activeRunSettlements.get(workflow) ?? new Set<Promise<void>>();
      settlements.add(settled);
      activeRunSettlements.set(workflow, settlements);
      activeRuns.set(workflow, (activeRuns.get(workflow) ?? 0) + 1);
      try {
        return await workflow.run(input);
      } finally {
        const remaining = (activeRuns.get(workflow) ?? 1) - 1;
        if (remaining > 0) {
          activeRuns.set(workflow, remaining);
        } else {
          activeRuns.delete(workflow);
          if (retiring.has(workflow)) closeWorkflow(workflow);
        }
        settlements.delete(settled);
        if (settlements.size === 0) activeRunSettlements.delete(workflow);
        finish();
      }
    }
  });

  async function getConfiguredWebExplore(configuredSession = session, configuredBackends?: BackendConfig) {
    if (injectedWebExplore) return injectedWebExplore;

    const backendConfig = configuredBackends ?? await getEffectiveBackendConfig(pi);
    if (configuredSession.shutdownDeadline !== undefined && Date.now() >= configuredSession.shutdownDeadline) {
      throw new Error('The session has ended.');
    }
    const backendKey = JSON.stringify(backendConfig);
    if (!configuredSession.cachedWebExplore || configuredSession.cachedBackendKey !== backendKey) {
      if (configuredSession.cachedWorkflow) retire(configuredSession.cachedWorkflow);
      configuredSession.cachedBackendKey = backendKey;
      configuredSession.cachedWorkflow = createResearchWorkflow({ backendConfig, repoCache: configuredSession.repoCache });
      configuredSession.workflows.add(configuredSession.cachedWorkflow);
      configuredSession.cachedWebExplore = createWebExploreTool({ explore: leased(configuredSession.cachedWorkflow), now });
    }

    return configuredSession.cachedWebExplore;
  }

  pi.on('session_shutdown', async () => {
    const shuttingDown = session;
    const deadline = Date.now() + SESSION_SHUTDOWN_GRACE_MS;
    shuttingDown.shutdownDeadline = deadline;
    session = makeSession();
    const remaining = () => Math.max(0, deadline - Date.now());
    // A new session (after /new, /resume, /fork or a reload) starts with an empty cache.
    await waitWithin(Promise.allSettled([...shuttingDown.operations]), remaining());
    await waitWithin(Promise.allSettled([...shuttingDown.workflows].flatMap((workflow) => [...(activeRunSettlements.get(workflow) ?? [])])), remaining());
    await waitWithin(Promise.allSettled([...shuttingDown.workflows].map(closeWorkflowNow)), remaining());
    await waitWithin(shuttingDown.repoCache.close(), remaining());
  });

  pi.on('session_start', async (_event, ctx) => {
    try {
      const notice = await getUpdateChangelogNotice();
      if (notice) {
        ctx.ui.notify(`pi-web-agent updated\n\n${notice}`, 'info');
      }
    } catch {
      // Never block extension startup on changelog display.
    }
  });

  pi.registerTool({
    name: 'web_explore',
    label: 'Web Explore',
    description:
      'Search the web and read the best sources, using bounded search/fetch passes, source ranking, and targeted headless escalation. ' +
      'The query is used as the first search as written, so make it a short, specific search request rather than a conversational sentence. ' +
      'Prefer this for ordinary web research. If the result says something is still open, call again with a narrower query for that part. ' +
      'Include every link the user supplied, unchanged, in the query: links in the query are read directly (GitHub issues and pull requests through the API, GitHub repositories cloned and searched), and reported if they cannot be read. ' +
      'Pi can still use git and gh for repository, issue, and pull request work, and tools the user explicitly requests.',
    parameters: Type.Object({
      query: Type.String({ description: 'Short, specific search request, used as the first search as written. Skip filler like "can you find" or "please". Keep words that say what you want: "vs" for comparisons, version numbers, "API", "user opinions", "summarize" with a link. Include any links the user gave, unchanged.' })
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const executionSession = session;
      const startedAt = now();
      let updatesOpen = true;
      let lastActivity: string | undefined;
      const update = (terminalText: string, force = false) => {
        if (!updatesOpen || (!force && terminalText === lastActivity)) return;
        lastActivity = terminalText;
        try {
          onUpdate?.({
            content: [{ type: 'text', text: terminalText }],
            details: { terminalText, terminalTextExpanded: terminalText }
          });
        } catch { /* A closed display must not fail research. */ }
      };
      const cancel = () => {
        if (!updatesOpen) return;
        update('Cancelled', true);
        updatesOpen = false;
      };
      signal?.addEventListener('abort', cancel, { once: true });
      const operation = (async () => {
        try {
          throwIfAborted(signal);
          const secret = detectInputSecret(params.query);
          if (secret) {
            const result = secretRefusal(secret);
            const presentation = buildExplorePresentation(result);
            const mode = resolvePresentationMode('web_explore', DEFAULT_PRESENTATION_CONFIG);
            const terminalText = selectPresentationView(presentation, mode) ?? 'web_explore result';
            const terminalTextExpanded = selectPresentationView(presentation, 'verbose') ?? terminalText;
            return {
              content: [{ type: 'text' as const, text: serializeExploreResult({ ...result, presentation }) }],
              details: { ...result, presentation, selectedMode: mode, terminalText, terminalTextExpanded },
              isError: true
            };
          }
          update('Starting web research…', true);
          // Pi's context may contain provider credentials and mutable state; retain
          // only the model facts this call needs before any asynchronous config read.
          const contextModel = (ctx as { model?: ModelContext } | undefined)?.model;
          const modelContext = contextModel ? { id: contextModel.id, provider: contextModel.provider, contextWindow: contextModel.contextWindow } : undefined;
          // Read the layered file once for this call: its result policy and backend
          // choice are a single execution-time snapshot.
          const hasInjectedStore = Boolean((pi as ExtensionAPI & { __presentationConfigStore?: unknown }).__presentationConfigStore);
          const loaded = (!injectedWebExplore || hasInjectedStore) ? await loadWebAgentConfig(pi).catch(() => undefined) : undefined;
          const results = loaded?.effectiveResults ?? DEFAULT_RESULTS_CONFIG;
          const presentationConfig = loaded?.effectiveConfig ?? (injectedWebExplore ? DEFAULT_PRESENTATION_CONFIG : await getEffectivePresentationConfig(pi));
          const webExplore = await getConfiguredWebExplore(executionSession, loaded?.effectiveBackends);
          const result: WebExploreResponse = await webExplore({
            query: params.query,
            ...(signal ? { signal } : {}),
            startedAt,
            results,
            ...(modelContext ? { modelContext } : {}),
            onProgress(progress) {
              update(formatResearchProgress(progress));
            }
          });
          update('Research complete.');

          // Terminal display honors the presentation mode; serializeExploreResult sends the
          // allocated model selection, so a missing presentation never dumps it to the terminal.
          const mode = resolvePresentationMode('web_explore', presentationConfig);
          const terseFallback = 'web_explore result';
          const terminalText = selectPresentationView(result.presentation, mode) ?? terseFallback;
          const terminalTextExpanded = selectPresentationView(result.presentation, 'verbose') ?? terminalText;

          return {
            content: [{ type: 'text' as const, text: serializeExploreResult(result) }],
            details: { ...result, selectedMode: mode, terminalText, terminalTextExpanded },
            isError: result.status === 'error'
          };
        } catch (error) {
          if (signal?.aborted) cancel();
          throw error;
        } finally {
          updatesOpen = false;
          signal?.removeEventListener('abort', cancel);
        }
      })();
      executionSession.operations.add(operation);
      try {
        return await operation;
      } finally {
        executionSession.operations.delete(operation);
      }
    },
    renderCall(args, theme, context) {
      return renderExploreCall(args?.query, context.argsComplete, theme);
    },
    renderResult(toolResult, options) {
      const details = toolResult.details as
        | {
            terminalText?: string;
            terminalTextExpanded?: string;
            presentation?: { views?: { compact?: string; verbose?: string } };
          }
        | undefined;
      try {
        if (isCancelledResult(toolResult)) return new Text('Cancelled', 0, 0);
        // Legacy fallback: results persisted before this change carry `presentation` but no
        // `terminalText`, so old sessions stay readable instead of rendering blank.
        const legacy = options.expanded
          ? details?.presentation?.views?.verbose ?? details?.presentation?.views?.compact
          : details?.presentation?.views?.compact;
        const text =
          (options.expanded ? details?.terminalTextExpanded : details?.terminalText) ??
          details?.terminalText ??
          legacy ??
          'web_explore result';
        return new Text(sanitizeTerminalText(text), 0, 0);
      } catch {
        // Never throw: a thrown renderer makes Pi fall back to raw content, which would dump
        // the full model-facing findings into the terminal.
        return new Text('web_explore result', 0, 0);
      }
    }
  });
}
