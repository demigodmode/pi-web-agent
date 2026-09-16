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
import type { PresentationConfig } from './presentation/types.js';
import { createWebExploreTool } from './tools/web-explore.js';
import type { WebExploreResponse } from './types.js';
import { getUpdateChangelogNotice } from './changelog-notice.js';
import { Text } from '@earendil-works/pi-tui';

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
  return [
    result.findings.join('\n\n'),
    result.sources.length
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

  let cachedBackendKey: string | undefined;
  let cachedWorkflow: Workflow | undefined;
  let cachedWebExplore: ReturnType<typeof createWebExploreTool> | undefined;
  // Runs in flight per workflow, so a replaced workflow is never closed mid-run.
  const activeRuns = new Map<Workflow, number>();
  const retiring = new Set<Workflow>();

  const closeWorkflow = (workflow: Workflow) => {
    retiring.delete(workflow);
    void Promise.resolve((workflow as { close?: () => Promise<void> }).close?.()).catch(() => undefined);
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
      }
    }
  });

  async function getConfiguredWebExplore() {
    if (injectedWebExplore) return injectedWebExplore;

    const backendConfig = await getEffectiveBackendConfig(pi);
    const backendKey = JSON.stringify(backendConfig);
    if (!cachedWebExplore || cachedBackendKey !== backendKey) {
      if (cachedWorkflow) retire(cachedWorkflow);
      cachedBackendKey = backendKey;
      cachedWorkflow = createResearchWorkflow({ backendConfig });
      cachedWebExplore = createWebExploreTool({ explore: leased(cachedWorkflow) });
    }

    return cachedWebExplore;
  }

  pi.on('session_shutdown', async () => {
    const workflow = cachedWorkflow;
    cachedWorkflow = undefined;
    cachedWebExplore = undefined;
    cachedBackendKey = undefined;
    if (workflow) retire(workflow);
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
    async execute(_toolCallId, params) {
      const webExplore = await getConfiguredWebExplore();
      const result: WebExploreResponse = await webExplore({ query: params.query });

      // Terminal display honors the user's presentation mode; the model gets the full findings.
      // The fallback must stay terse: never fall back to serializeForModel here, or a missing
      // presentation would dump the full findings into the terminal.
      const mode = resolvePresentationMode('web_explore', await getEffectivePresentationConfig(pi));
      const terseFallback = 'web_explore result';
      const terminalText = selectPresentationView(result.presentation, mode) ?? terseFallback;
      const terminalTextExpanded = selectPresentationView(result.presentation, 'verbose') ?? terminalText;

      return {
        content: [{ type: 'text', text: serializeForModel(result) }],
        details: { ...result, terminalText, terminalTextExpanded },
        isError: result.status === 'error'
      };
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
        return new Text(text, 0, 0);
      } catch {
        // Never throw: a thrown renderer makes Pi fall back to raw content, which would dump
        // the full model-facing findings into the terminal.
        return new Text('web_explore result', 0, 0);
      }
    }
  });
}
