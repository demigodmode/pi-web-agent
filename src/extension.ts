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
import { sanitizeTerminalText } from './presentation/explore-presentation.js';
import type { PresentationConfig } from './presentation/types.js';
import { createWebExploreTool } from './tools/web-explore.js';
import type { WebExploreResponse } from './types.js';
import { getUpdateChangelogNotice } from './changelog-notice.js';
import { createRepoCache, type RepoCache } from './repo/repo-cache.js';
import { Text } from '@earendil-works/pi-tui';
import { formatResearchProgress } from './orchestration/progress.js';

/**
 * What the model receives as the tool result: the actual synthesized findings (which for a
 * direct GitHub/PDF/YouTube read is the full extracted content), plus source citations and any
 * caveat. This is separate from the terminal display (see renderResult), so the model always
 * gets the substance regardless of the user's compact/preview/verbose presentation setting.
 */
function serializeForModel(result: WebExploreResponse): string {
  if (result.status === 'error') {
    return `Research failed: ${result.error?.message ?? 'Unknown research failure.'}`;
  }
  if (result.findings.length === 0 && result.sources.length === 0) {
    return 'No usable evidence found.';
  }
  const linked = (result.evidence?.length ?? 0) > 0;
  const findings = result.findings.map((finding, index) => {
    const ids = result.findingSourceIds?.[index] ?? [];
    return ids.length ? `[${ids.join(', ')}] ${finding}` : finding;
  });
  const evidence = result.evidence?.map((item) => [
    `[${item.id}] ${item.title}: ${item.url}`,
    ...item.excerpts.map((excerpt) => `  - ${excerpt.anchor ? `#${excerpt.anchor}: ` : ''}${excerpt.text}`),
    item.truncated ? '  (source excerpt truncated)' : undefined
  ].filter(Boolean).join('\n')).join('\n');
  return [
    findings.join('\n\n'),
    linked ? `Evidence:\n${evidence}` : result.sources.length
      ? `Sources:\n${result.sources.map((source) => `- ${source.title}: ${source.url}`).join('\n')}`
      : undefined,
    result.caveat
  ]
    .filter(Boolean)
    .join('\n\n');
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
  type Workflow = ReturnType<typeof createResearchWorkflow>;
  // Clones live for the Pi session (#72): the extension owns the cache, not a backend set,
  // so a backend config change keeps them and session_shutdown removes them.
  const makeRepoCache = (pi as ExtensionAPI & { __repoCacheFactory?: () => RepoCache }).__repoCacheFactory ?? (() => createRepoCache());
  type Session = {
    repoCache: RepoCache;
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

  async function getConfiguredWebExplore(configuredSession = session) {
    if (injectedWebExplore) return injectedWebExplore;

    const backendConfig = await getEffectiveBackendConfig(pi);
    const backendKey = JSON.stringify(backendConfig);
    if (!configuredSession.cachedWebExplore || configuredSession.cachedBackendKey !== backendKey) {
      if (configuredSession.cachedWorkflow) retire(configuredSession.cachedWorkflow);
      configuredSession.cachedBackendKey = backendKey;
      configuredSession.cachedWorkflow = createResearchWorkflow({ backendConfig, repoCache: configuredSession.repoCache });
      configuredSession.workflows.add(configuredSession.cachedWorkflow);
      configuredSession.cachedWebExplore = createWebExploreTool({ explore: leased(configuredSession.cachedWorkflow) });
    }

    return configuredSession.cachedWebExplore;
  }

  pi.on('session_shutdown', async () => {
    const shuttingDown = session;
    session = makeSession();
    // A new session (after /new, /resume, /fork or a reload) starts with an empty cache.
    await Promise.allSettled([...shuttingDown.operations]);
    await Promise.allSettled([...shuttingDown.workflows].flatMap((workflow) => [...(activeRunSettlements.get(workflow) ?? [])]));
    await Promise.allSettled([...shuttingDown.workflows].map(closeWorkflowNow));
    await shuttingDown.repoCache.close();
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

  pi.on('before_agent_start', async (event) => ({
    systemPrompt:
      `${event.systemPrompt}\n\n` +
      'For web research questions that require finding and comparing sources, use web_explore. ' +
      'web_explore handles search, fetch, source ranking, and headless escalation internally. ' +
      'If more web evidence is needed after web_explore, call web_explore again with a narrower query; do not use shell/network commands such as curl, Invoke-WebRequest, npm view/search/pack, or direct HTTP URLs for web research.'
  }));

  pi.registerTool({
    name: 'web_explore',
    label: 'Web Explore',
    description:
      'Research a web question using bounded search/fetch passes, source ranking, and targeted headless escalation. Use this for web research, current docs/discussion lookups, and recommendation summaries.',
    parameters: Type.Object({
      query: Type.String({ description: 'Web research question to explore.' })
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const executionSession = session;
      const operation = (async () => {
        const webExplore = await getConfiguredWebExplore(executionSession);
        const result: WebExploreResponse = await webExplore({
          query: params.query,
          ...(signal ? { signal } : {}),
          onProgress(progress) {
            const terminalText = formatResearchProgress(progress);
            try {
              onUpdate?.({
                content: [{ type: 'text', text: terminalText }],
                details: { terminalText, terminalTextExpanded: terminalText }
              });
            } catch { /* A closed display must not fail research. */ }
          }
        });

        // Terminal display honors the user's presentation mode; the model gets the full findings.
        // The fallback must stay terse: never fall back to serializeForModel here, or a missing
        // presentation would dump the full findings into the terminal.
        const mode = resolvePresentationMode('web_explore', await getEffectivePresentationConfig(pi));
        const terseFallback = 'web_explore result';
        const terminalText = selectPresentationView(result.presentation, mode) ?? terseFallback;
        const terminalTextExpanded = selectPresentationView(result.presentation, 'verbose') ?? terminalText;

        return {
          content: [{ type: 'text' as const, text: serializeForModel(result) }],
          details: { ...result, terminalText, terminalTextExpanded },
          isError: result.status === 'error'
        };
      })();
      executionSession.operations.add(operation);
      try {
        return await operation;
      } finally {
        executionSession.operations.delete(operation);
      }
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
