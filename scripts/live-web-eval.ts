import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager
} from '@mariozechner/pi-coding-agent';
import { createWebSearchTool } from '../src/tools/web-search.js';

type PromptCase = {
  id: 'prompt-1' | 'prompt-2' | 'prompt-4';
  title: string;
  prompt: string;
};

type SearchFailureCase = {
  id: 'no-results' | 'parse-failed' | 'blocked-html' | 'fetch-failed';
  title: string;
  expectedCode: string;
  expectedMessage: string;
  searchHtml: (query: string) => Promise<string>;
};

type SearchFailureEvaluation = {
  id: SearchFailureCase['id'];
  title: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  expectedCode: string;
  actualCode: string;
  expectedMessage: string;
  actualMessage: string;
  verdict: 'pass' | 'fail';
  notes: string[];
};

type ToolCallRecord = {
  toolName: string;
  args: unknown;
  startedAt: string;
  endedAt?: string;
  isError?: boolean;
  result?: unknown;
};

type PromptMetrics = {
  webExploreUsed: boolean;
  webExploreFirstWebTool: boolean;
  totalToolCalls: number;
  totalWebToolCalls: number;
};

type PromptEvaluation = {
  id: PromptCase['id'];
  title: string;
  prompt: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  finalAnswer: string;
  toolCalls: ToolCallRecord[];
  metrics: PromptMetrics;
  verdict: 'pass' | 'mixed' | 'fail';
  notes: string[];
};

type EvaluationRun = {
  startedAt: string;
  finishedAt: string;
  cwd: string;
  prompts: PromptEvaluation[];
  searchFailureCases: SearchFailureEvaluation[];
};

const PROMPTS: PromptCase[] = [
  {
    id: 'prompt-1',
    title: 'Playwright installed browser guidance',
    prompt:
      'Find current docs or discussions about Playwright launching an installed Chrome or Edge executable instead of a bundled browser, then summarize the recommended approach.'
  },
  {
    id: 'prompt-2',
    title: 'Vitest coverage configuration',
    prompt:
      'Find the current Vitest coverage docs and tell me how to enable coverage with the V8 provider in a TypeScript project.'
  },
  {
    id: 'prompt-4',
    title: 'DuckDuckGo HTML scraping pitfalls',
    prompt:
      'Find two or three current sources on DuckDuckGo HTML scraping in Node.js and tell me what the common parsing pitfalls are.'
  }
];

const SEARCH_FAILURE_CASES: SearchFailureCase[] = [
  {
    id: 'no-results',
    title: 'NO_RESULTS classification',
    expectedCode: 'NO_RESULTS',
    expectedMessage: 'DuckDuckGo returned no usable results for this query.',
    searchHtml: async () => `
      <html>
        <body>
          <div class="results">
            <div class="no-results">No results found for your search.</div>
          </div>
        </body>
      </html>
    `
  },
  {
    id: 'parse-failed',
    title: 'PARSE_FAILED classification',
    expectedCode: 'PARSE_FAILED',
    expectedMessage: 'DuckDuckGo returned a page, but it did not match the expected results format.',
    searchHtml: async () => `
      <html>
        <body>
          <main>
            <h1>Unexpected page</h1>
            <p>Nothing here looks like a search results page.</p>
          </main>
        </body>
      </html>
    `
  },
  {
    id: 'blocked-html',
    title: 'BLOCKED classification from challenge HTML',
    expectedCode: 'BLOCKED',
    expectedMessage: 'DuckDuckGo search appears to be blocked or rate limited.',
    searchHtml: async () => `
      <html>
        <body>
          <main>
            <h1>Are you a robot?</h1>
            <p>Please verify you are human to continue.</p>
          </main>
        </body>
      </html>
    `
  },
  {
    id: 'fetch-failed',
    title: 'FETCH_FAILED classification',
    expectedCode: 'FETCH_FAILED',
    expectedMessage: 'DuckDuckGo search request failed: socket hang up',
    searchHtml: async () => {
      throw new Error('socket hang up');
    }
  }
];

function isoNow() {
  return new Date().toISOString();
}

function safeFileStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('\n');
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;

  if (Array.isArray(record.content)) {
    return record.content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const contentItem = item as Record<string, unknown>;
        return typeof contentItem.text === 'string' ? contentItem.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const nestedMessage = record.message;
  if (nestedMessage && typeof nestedMessage === 'object') {
    const nestedRecord = nestedMessage as Record<string, unknown>;
    if (Array.isArray(nestedRecord.content)) {
      return extractText(nestedMessage);
    }
  }

  return '';
}

function buildMetrics(toolCalls: ToolCallRecord[]): PromptMetrics {
  const webToolNames = new Set(['web_explore', 'web_search', 'web_fetch', 'web_fetch_headless']);
  const webToolCalls = toolCalls.filter((call) => webToolNames.has(call.toolName));
  const firstWebTool = webToolCalls[0];
  const firstWebExploreIndex = toolCalls.findIndex((call) => call.toolName === 'web_explore');

  return {
    webExploreUsed: firstWebExploreIndex !== -1,
    webExploreFirstWebTool: firstWebTool?.toolName === 'web_explore',
    totalToolCalls: toolCalls.length,
    totalWebToolCalls: webToolCalls.length
  };
}

function evaluateVerdict(metrics: PromptMetrics, finalAnswer: string): {
  verdict: 'pass' | 'mixed' | 'fail';
  notes: string[];
} {
  const notes: string[] = [];

  if (!metrics.webExploreUsed) {
    notes.push('web_explore was not used');
    return { verdict: 'fail', notes };
  }

  if (!metrics.webExploreFirstWebTool) {
    notes.push('web_explore was not the first web research tool');
  }

  if (!finalAnswer.trim()) {
    notes.push('final answer text was empty');
    return { verdict: 'fail', notes };
  }

  if (metrics.webExploreFirstWebTool) {
    return { verdict: 'pass', notes };
  }

  return { verdict: 'mixed', notes };
}

function formatSearchFailureMarkdown(cases: SearchFailureEvaluation[]) {
  if (cases.length === 0) {
    return '## Search failure cases\n\nNone.\n';
  }

  const sections = cases
    .map((testCase) => {
      const notes = testCase.notes.length > 0 ? testCase.notes.map((note) => `- ${note}`).join('\n') : '- none';

      return `### ${testCase.title}\n\n` +
        `Verdict: **${testCase.verdict}**\n\n` +
        `- expected code: ${testCase.expectedCode}\n` +
        `- actual code: ${testCase.actualCode}\n` +
        `- expected message: ${testCase.expectedMessage}\n` +
        `- actual message: ${testCase.actualMessage}\n\n` +
        `Notes:\n${notes}\n`;
    })
    .join('\n');

  return `## Search failure cases\n\n${sections}`;
}

function formatMarkdown(run: EvaluationRun): string {
  const sections = run.prompts
    .map((prompt) => {
      const tools = prompt.toolCalls
        .map((call, index) => `  ${index + 1}. ${call.toolName}`)
        .join('\n');

      const notes = prompt.notes.length > 0 ? prompt.notes.map((note) => `- ${note}`).join('\n') : '- none';

      return `## ${prompt.title}\n\n` +
        `Prompt: ${prompt.prompt}\n\n` +
        `Verdict: **${prompt.verdict}**\n\n` +
        `Metrics:\n` +
        `- web_explore used: ${prompt.metrics.webExploreUsed}\n` +
        `- web_explore first web tool: ${prompt.metrics.webExploreFirstWebTool}\n` +
        `- total tool calls: ${prompt.metrics.totalToolCalls}\n` +
        `- total web tool calls: ${prompt.metrics.totalWebToolCalls}\n` +

        `Tool order:\n${tools || '  none'}\n\n` +
        `Notes:\n${notes}\n\n` +
        `Final answer:\n\n${prompt.finalAnswer.trim() || '(empty)'}\n`;
    })
    .join('\n---\n\n');

  return `# live web eval\n\nStarted: ${run.startedAt}\nFinished: ${run.finishedAt}\nCWD: ${run.cwd}\n\n` +
    `${sections}\n\n---\n\n${formatSearchFailureMarkdown(run.searchFailureCases)}`;
}

function evaluateSearchFailureCase(
  expectedCode: string,
  actualCode: string,
  expectedMessage: string,
  actualMessage: string
) {
  const notes: string[] = [];

  if (actualCode !== expectedCode) {
    notes.push(`expected code ${expectedCode} but got ${actualCode}`);
  }

  if (actualMessage !== expectedMessage) {
    notes.push(`expected message \"${expectedMessage}\" but got \"${actualMessage}\"`);
  }

  return {
    verdict: notes.length === 0 ? 'pass' : 'fail',
    notes
  } as const;
}

async function runPrompt(promptCase: PromptCase, cwd: string, authStorage: AuthStorage, modelRegistry: ModelRegistry) {
  const startedAt = Date.now();
  const toolCalls: ToolCallRecord[] = [];
  let finalAnswer = '';

  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory()
  });

  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === 'tool_execution_start') {
      toolCalls.push({
        toolName: event.toolName,
        args: event.args,
        startedAt: isoNow()
      });
    }

    if (event.type === 'tool_execution_end') {
      const active = [...toolCalls].reverse().find((call) => call.toolName === event.toolName && !call.endedAt);
      if (active) {
        active.endedAt = isoNow();
        active.isError = !!event.isError;
        active.result = event.result;
      }
    }

    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const text = extractText(event.message);
      if (text.trim()) {
        finalAnswer = text;
      }
    }
  });

  try {
    await session.prompt(promptCase.prompt);

    if (!finalAnswer.trim()) {
      const reversedMessages = [...session.messages].reverse();
      const lastAssistant = reversedMessages.find((message: any) => message?.role === 'assistant');
      finalAnswer = lastAssistant ? extractText(lastAssistant) : '';
    }
  } finally {
    unsubscribe();
    session.dispose();
  }

  const finishedAt = Date.now();
  const metrics = buildMetrics(toolCalls);
  const evaluation = evaluateVerdict(metrics, finalAnswer);

  return {
    id: promptCase.id,
    title: promptCase.title,
    prompt: promptCase.prompt,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    finalAnswer,
    toolCalls,
    metrics,
    verdict: evaluation.verdict,
    notes: evaluation.notes
  } satisfies PromptEvaluation;
}

async function runSearchFailureCase(testCase: SearchFailureCase) {
  const startedAt = Date.now();
  const search = createWebSearchTool({ searchHtml: testCase.searchHtml });
  const result = await search({ query: 'deterministic test query' });
  const finishedAt = Date.now();

  const actualCode = result.error?.code ?? 'NO_ERROR';
  const actualMessage = result.error?.message ?? 'No error message returned.';
  const evaluation = evaluateSearchFailureCase(
    testCase.expectedCode,
    actualCode,
    testCase.expectedMessage,
    actualMessage
  );

  return {
    id: testCase.id,
    title: testCase.title,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    expectedCode: testCase.expectedCode,
    actualCode,
    expectedMessage: testCase.expectedMessage,
    actualMessage,
    verdict: evaluation.verdict,
    notes: evaluation.notes
  } satisfies SearchFailureEvaluation;
}

async function main() {
  const cwd = process.cwd();
  const startedAt = isoNow();
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const prompts: PromptEvaluation[] = [];
  for (const promptCase of PROMPTS) {
    console.log(`Running ${promptCase.id}: ${promptCase.title}`);
    prompts.push(await runPrompt(promptCase, cwd, authStorage, modelRegistry));
  }

  const searchFailureCases: SearchFailureEvaluation[] = [];
  for (const testCase of SEARCH_FAILURE_CASES) {
    console.log(`Running ${testCase.id}: ${testCase.title}`);
    searchFailureCases.push(await runSearchFailureCase(testCase));
  }

  const run: EvaluationRun = {
    startedAt,
    finishedAt: isoNow(),
    cwd,
    prompts,
    searchFailureCases
  };

  const outputDir = path.join(cwd, 'local_docs', 'tmp', 'live-evals');
  await mkdir(outputDir, { recursive: true });

  const stamp = safeFileStamp();
  const jsonPath = path.join(outputDir, `${stamp}.json`);
  const mdPath = path.join(outputDir, `${stamp}.md`);

  await writeFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, `${formatMarkdown(run)}\n`, 'utf8');

  console.log(`\nSaved JSON: ${jsonPath}`);
  console.log(`Saved Markdown: ${mdPath}`);

  for (const prompt of run.prompts) {
    console.log(`\n${prompt.id} -> ${prompt.verdict}`);
    console.log(`  web_explore used: ${prompt.metrics.webExploreUsed}`);
    console.log(`  web_explore first web tool: ${prompt.metrics.webExploreFirstWebTool}`);
    console.log(`  total web tool calls: ${prompt.metrics.totalWebToolCalls}`);
  }

  for (const testCase of run.searchFailureCases) {
    console.log(`\n${testCase.id} -> ${testCase.verdict}`);
    console.log(`  expected code: ${testCase.expectedCode}`);
    console.log(`  actual code: ${testCase.actualCode}`);
  }
}

await main();
