import { describe, expect, it, vi } from 'vitest';
import extension from '../../src/extension.js';
import { createWebExploreTool } from '../../src/tools/web-explore.js';
import { countResultContent } from '../../src/results/content-length.js';

type Evidence = { title: string; url: string; method?: 'http' | 'pdf' | 'github'; summary: string; supports: string[]; readerDocument?: string; sourceKind: 'official-docs'; retrievalCut?: boolean };
const meta = (extra = {}) => ({ searchPasses: 1, fetchedPages: 1, headlessAttempts: 0, exhaustedBudget: false, presentationStats: { searches: 1, executedQueries: ['safe query'], pagesRead: 1, failedReads: 0, methods: { http: 1 } }, ...extra });
const page = (index: number, text = `evidence ${index}`): Evidence => ({ title: `Source ${index}`, url: `https://example.test/${index}?id=${index}`, method: 'http', sourceKind: 'official-docs', summary: `finding ${index}: ${text}`, supports: [text] });

function registered(result: unknown, lengthLimit: 'auto' | 'short' | 'medium' | 'standard' | number = 'auto') {
  const tools: any[] = [];
  const workflow = vi.fn(async (_input: any) => result);
  const real = createWebExploreTool({ explore: workflow as never });
  extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: real,
    __presentationConfigStore: { load: vi.fn().mockResolvedValue({ effectiveConfig: { defaultMode: 'compact', tools: {} }, effectiveResults: { lengthLimit } }) } } as never);
  return { tool: tools.find((tool) => tool.name === 'web_explore'), workflow };
}

describe('registered result-length pipeline', () => {
  it('sends a supplied 24k reader once at Standard, while discovered readers use ordinary excerpts', async () => {
    const document = 'word '.repeat(4_800);
    const required = { title: 'Required PDF', url: 'https://example.test/required.pdf', method: 'pdf' as const, sourceKind: 'official-docs' as const, summary: document.slice(0, 180).trimEnd(), supports: [document], readerDocument: document };
    const discovered = { title: 'Found PDF', url: 'https://example.test/found.pdf', method: 'pdf' as const, sourceKind: 'official-docs' as const, summary: 'found summary', supports: ['x'.repeat(1000), 'y'.repeat(1000), 'z'.repeat(1000), 'w'.repeat(1000)], readerDocument: 'x'.repeat(1000) + '\n\n' + 'y'.repeat(1000) + '\n\n' + 'z'.repeat(1000) + '\n\n' + 'w'.repeat(1000) };
    const { tool } = registered({ decision: { action: 'answer' }, evidence: [required, discovered], requiredSourceEvidence: [required], workerPass: {}, metadata: meta() }, 'standard');
    const output = await tool.execute('id', { query: 'read PDFs' });
    const details = output.details;
    expect(details.evidence[0].excerpts).toEqual([{ text: document }]);
    expect(output.content[0].text.split(document)).toHaveLength(2);
    expect(details.modelResult.findings).toEqual([{ index: 1, text: 'found summary', sourceIds: ['S2'] }]);
    expect(details.evidence[1].excerpts).toHaveLength(3);
    expect(details.evidence[1].excerpts.every((excerpt: { text: string }) => excerpt.text.length <= 900)).toBe(true);
  });

  it('honors the live context window per registered call and counts only model content', async () => {
    const evidence = Array.from({ length: 5 }, (_, index) => page(index + 1, `${'unique passage '.repeat(100)}${index}`));
    const { tool, workflow } = registered({ decision: { action: 'answer' }, evidence, workerPass: {}, metadata: meta({ openGaps: ['A full unresolved question that needs more research.'], suggestedQueries: ['the useful follow up query'] }) });
    const short = await tool.execute('one', { query: 'raw https://alice:pw@example.test/x?token=secret&id=7' }, undefined, undefined, { model: { id: 'tiny', provider: 'custom', contextWindow: 8192 } });
    const large = await tool.execute('two', { query: 'second raw query' }, undefined, undefined, { model: { id: 'large', provider: 'custom', contextWindow: 128000 } });
    const count = (details: any) => countResultContent(details.modelResult.findings.map((finding: { text: string }) => finding.text), details.evidence.flatMap((source: { excerpts: Array<{ text: string }> }) => source.excerpts.map((excerpt) => excerpt.text)), details.modelResult.contextLines);
    expect(short.details.metadata.resultLength.effectiveChars).toBe(1310);
    expect(count(short.details)).toBe(short.details.metadata.resultLength.contentChars);
    expect(short.content[0].text).not.toContain('alice:pw');
    expect(short.content[0].text).not.toContain('token=secret');
    expect(short.content[0].text).toContain('https://example.test/1?id=1');
    expect(large.details.metadata.resultLength.contentChars).toBeGreaterThan(short.details.metadata.resultLength.contentChars);
    expect(workflow.mock.calls.map(([input]) => input.query)).toEqual(['raw https://alice:pw@example.test/x?token=secret&id=7', 'second raw query']);
  });

  it('keeps terminal required evidence and error notices, including no-evidence precedence', async () => {
    const required = page(1, 'required passage');
    const { tool } = registered({ decision: { action: 'research-again' }, evidence: [], requiredSourceEvidence: [required], workerPass: {}, terminalFailure: { code: 'STOPPED', message: 'backend stopped' }, requiredSourceFailures: [{ url: 'https://bad.test', code: 'BAD', message: 'not read', reason: 'read-failed' }], metadata: meta() }, 'short');
    const output = await tool.execute('one', { query: 'required source' }, undefined, undefined, { model: { contextWindow: 8192 } });
    expect(output.content[0].text).toContain('required passage');
    expect(output.content[0].text).toContain('Required source not read: https://bad.test');
    expect(output.content[0].text).toContain('Research failed: backend stopped');
    const invalid = await tool.execute('two', { query: ' ' });
    expect(invalid.content[0].text).toBe('Research failed: Query must not be empty.');
  });

  it('picks up a results-only edit without rebuilding the registered callable and keeps cuts out of compact', async () => {
    const tools: any[] = [];
    const loader = vi.fn()
      .mockResolvedValueOnce({ effectiveConfig: { defaultMode: 'compact', tools: {} }, effectiveResults: { lengthLimit: 'short' } })
      .mockResolvedValueOnce({ effectiveConfig: { defaultMode: 'compact', tools: {} }, effectiveResults: { lengthLimit: 'medium' } });
    const real = createWebExploreTool({ explore: vi.fn(async () => ({ decision: { action: 'answer' as const }, evidence: Array.from({ length: 5 }, (_, index) => page(index + 1, `${index} ${'long '.repeat(500)}`)), workerPass: {}, metadata: meta() })) as never });
    extension({ registerTool: (tool: any) => tools.push(tool), registerCommand: vi.fn(), on: vi.fn(), __webExploreTool: real, __presentationConfigStore: { load: loader } } as never);
    const one = await tools[0].execute('one', { query: 'same query' }, undefined, undefined, { model: { contextWindow: 8192 } });
    const two = await tools[0].execute('two', { query: 'same query' }, undefined, undefined, { model: { contextWindow: 8192 } });
    expect(one.details.metadata.resultLength.setting).toBe('short');
    expect(two.details.metadata.resultLength.setting).toBe('medium');
    expect(two.details.metadata.resultLength.contentChars).toBeGreaterThan(one.details.metadata.resultLength.contentChars);
    expect(one.details.terminalText).not.toContain("didn't fit");
    expect(one.details.terminalTextExpanded).toContain("didn't fit");
  });

  it('keeps later source IDs when the first finding is covered by emitted evidence', async () => {
    const first = page(1, 'first finding is fully contained in this emitted evidence');
    first.summary = 'first finding is fully contained in this emitted evidence';
    const second = page(2, 'different second evidence');
    second.summary = 'second finding remains';
    const { tool } = registered({ decision: { action: 'answer' }, evidence: [first, second], workerPass: {}, metadata: meta() }, 'standard');
    const output = await tool.execute('call', { query: 'compare' });
    expect(output.details.modelResult.findings).toEqual([{ index: 1, text: 'second finding remains', sourceIds: ['S2'] }]);
    expect(output.content[0].text).toContain('[S2] second finding remains');
  });

  it('keeps the required minimum for three readers under Short in query order', async () => {
    const readers = Array.from({ length: 3 }, (_, index) => ({ title: `Reader ${index + 1}`, url: `https://example.test/${index + 1}.pdf`, method: 'pdf' as const, sourceKind: 'official-docs' as const, summary: `reader ${index + 1}`, supports: [`reader ${index + 1} ${'x'.repeat(2000)}`], readerDocument: `reader ${index + 1} ${'x'.repeat(2000)}` }));
    const { tool } = registered({ decision: { action: 'answer' }, evidence: readers, requiredSourceEvidence: readers, workerPass: {}, metadata: meta() }, 'short');
    const output = await tool.execute('call', { query: 'three links' }, undefined, undefined, { model: { contextWindow: 8192 } });
    expect(output.details.evidence.map((source: { id: string; excerpts: unknown[] }) => source.excerpts.length)).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]));
    expect(output.details.evidence.every((source: { excerpts: unknown[] }) => source.excerpts.length >= 1)).toBe(true);
    expect(output.details.metadata.resultLength.requiredOverflowChars).toBeGreaterThanOrEqual(0);
    expect(output.content[0].text.indexOf('[S1]')).toBeLessThan(output.content[0].text.indexOf('[S2]'));
  });

  it('preserves a no-evidence result and legacy serializer fallback', async () => {
    const { tool } = registered({ decision: { action: 'answer' }, evidence: [], workerPass: {}, metadata: meta() });
    const output = await tool.execute('call', { query: 'nothing' });
    expect(output.content[0].text).toContain('No usable evidence found.');
    const { serializeExploreResult } = await import('../../src/tools/serialize-explore-result.js');
    expect(serializeExploreResult({ status: 'ok', findings: ['old'], sources: [{ title: 'Old', url: 'https://old.test' }], findingSourceIds: [['S1']], evidence: [{ id: 'S1', title: 'Old', url: 'https://old.test', excerpts: [{ text: 'legacy excerpt' }], truncated: true }] })).toContain('(source excerpt truncated)');
  });

  it('keeps actual serialized model content within an exact 1000-character setting', async () => {
    const evidence = Array.from({ length: 5 }, (_, index) => page(index + 1, `single line excerpt ${index + 1} ${'x'.repeat(500)}`));
    const { tool } = registered({ decision: { action: 'research-again' }, evidence, workerPass: {}, metadata: meta({ openGaps: ['A remaining question'], suggestedQueries: ['follow up query'], executedQueries: ['one query'] }) }, 1000);
    const output = await tool.execute('call', { query: 'five sources' });
    const text = output.content[0].text as string;
    const beforeEvidence = text.split('\n\nEvidence:\n')[0] ?? '';
    const findings = [...beforeEvidence.matchAll(/^\[S\d+\] (.*)$/gm)].map((match) => match[1]!);
    const excerpts = [...text.matchAll(/^  - (.*)$/gm)].map((match) => match[1]!);
    const context = [...text.matchAll(/^(?:Still open|Try next|Searched): .*$/gm)].map((match) => match[0]!);
    const actual = countResultContent(findings, excerpts, context);
    expect(actual).toBe(output.details.metadata.resultLength.contentChars);
    expect(actual).toBeLessThanOrEqual(1000);
    expect(text).toContain('[S1] Source 1:');
    expect(text).toContain('S1, S2, S3, S4, S5 had more relevant text');
  });
});
