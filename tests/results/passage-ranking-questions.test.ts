import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractReadableContentForQuery } from '../../src/extract/readability.js';
import { selectRelevantContent, type SelectionFormat } from '../../src/extract/section-selector.js';
import { rankEvidencePassages } from '../../src/orchestration/evidence-passages.js';
import type { ResearchEvidence } from '../../src/orchestration/research-types.js';
import { allocateResult } from '../../src/results/allocate.js';
import type { LengthLimit } from '../../src/results/types.js';
import { prepareEvidenceSources } from '../../src/tools/evidence-records.js';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'passage-ranking');
const LIMITS: Array<{ label: string; setting: LengthLimit }> = [
  { label: '1000', setting: 1000 },
  { label: '1310', setting: 1310 },
  { label: '4000', setting: 4000 },
  { label: '8000', setting: 8000 },
  { label: 'standard', setting: 'standard' }
];

type Source = { file: string; format: 'html' | SelectionFormat; url: string };
type Question = { id: string; query: string; sources: Source[]; answers: string[] };

const coverageGuide: Source = { file: 'vitest-coverage-guide.html', format: 'html', url: 'https://vitest.dev/guide/coverage' };
const discussion3916: Source = { file: 'vitest-discussion-3916.md', format: 'markdown', url: 'https://github.com/vitest-dev/vitest/discussions/3916' };
const discussion2977: Source = { file: 'vitest-discussion-2977.md', format: 'markdown', url: 'https://github.com/vitest-dev/vitest/discussions/2977' };
const issue4150: Source = { file: 'vitest-issue-4150.md', format: 'markdown', url: 'https://github.com/vitest-dev/vitest/issues/4150' };
const configMd: Source = { file: 'vitest-config.md', format: 'markdown', url: 'https://vitest.dev/config/' };
const readme: Source = { file: 'vitest-readme.md', format: 'markdown', url: 'https://github.com/vitest-dev/vitest' };
const llms: Source = { file: 'vitest-llms.txt', format: 'text', url: 'https://vitest.dev/llms.txt' };
const mocking: Source = { file: 'vitest-mocking.md', format: 'markdown', url: 'https://vitest.dev/guide/mocking' };
const viteChangelog: Source = { file: 'vite-changelog.md', format: 'markdown', url: 'https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md' };
const argparse: Source = { file: 'python-argparse.html', format: 'html', url: 'https://docs.python.org/3/library/argparse.html' };
const argparseJa: Source = { file: 'python-argparse-ja.html', format: 'html', url: 'https://docs.python.org/ja/3/library/argparse.html' };

const mdnReduce: Source = { file: 'mdn-array-reduce.html', format: 'html', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce' };
const pythonJson: Source = { file: 'python-json.html', format: 'html', url: 'https://docs.python.org/3/library/json.html' };
const rustVectors: Source = { file: 'rust-book-vectors.html', format: 'html', url: 'https://doc.rust-lang.org/book/ch08-01-vectors.html' };
const nhsCold: Source = { file: 'nhs-common-cold.html', format: 'html', url: 'https://www.nhs.uk/conditions/common-cold/' };
const paulGraham: Source = { file: 'paulgraham-great-work.html', format: 'html', url: 'https://paulgraham.com/greatwork.html' };
const sourdough: Source = { file: 'wikipedia-sourdough.html', format: 'html', url: 'https://en.wikipedia.org/wiki/Sourdough' };
const seoul: Source = { file: 'ko-wikipedia-seoul.html', format: 'html', url: 'https://ko.wikipedia.org/wiki/서울특별시' };
const sorted: Source = { file: 'stackoverflow-sorted-array-thread.md', format: 'markdown', url: 'https://stackoverflow.com/questions/11227809' };
const requestsIssue: Source = { file: 'github-requests-issue-7341.md', format: 'markdown', url: 'https://github.com/psf/requests/issues/7341' };
const cookies: Source = { file: 'wikibooks-chocolate-chip-cookies.html', format: 'html', url: 'https://en.wikibooks.org/wiki/Cookbook:Chocolate_Chip_Cookies_I' };

const QUESTIONS: Question[] = [
  {
    id: 'vitest-enable-coverage',
    query: 'how do I enable coverage in vitest',
    sources: [coverageGuide, discussion3916, issue4150],
    answers: ['pass the --coverage flag', 'npm i -D @vitest/coverage-v8']
  },
  {
    id: 'vitest-custom-reporter',
    query: 'vitest custom coverage reporter config',
    sources: [coverageGuide, issue4150],
    answers: ['custom coverage reporters by passing either the name of the package', "'@vitest/custom-coverage-reporter', { someOption: true }"]
  },
  {
    id: 'vitest-coverage-include',
    query: 'which files show up in vitest coverage include exclude',
    sources: [coverageGuide, discussion2977, discussion3916],
    answers: ['configure coverage.include with a pattern that will pick your source files', 'If some file is not visible in coverage report']
  },
  {
    id: 'vitest-config-override',
    query: 'vitest config instead of vite.config',
    sources: [configMd, readme],
    answers: ['will have the higher priority and will **override** the configuration']
  },
  {
    id: 'vitest-mock-date',
    query: 'mock current date time vitest',
    sources: [mocking, llms],
    answers: ['use `vi.setSystemTime` helper function']
  },
  {
    id: 'vitest-stub-global',
    query: 'stub a global variable in vitest',
    sources: [mocking],
    answers: ["vi.stubGlobal('__VERSION__', '1.0.0')"]
  },
  {
    id: 'vitest-browser-components',
    query: 'vitest browser mode component testing',
    sources: [readme, llms],
    answers: ['for running component tests in the browser']
  },
  {
    id: 'vite-chunk-import-map-preload',
    query: 'vite build preloads chunkImportMap non-root base',
    sources: [viteChangelog, readme],
    answers: ['correct preloads when chunkImportMap is enabled with non-root base']
  },
  {
    id: 'argparse-mutually-exclusive',
    query: 'argparse mutually exclusive group',
    sources: [argparse],
    answers: ['Create a mutually exclusive group.']
  },
  {
    id: 'argparse-ja-english-query',
    query: 'argparse add_mutually_exclusive_group',
    sources: [argparseJa],
    answers: ['相互排他グループを作成します']
  },
  {
    id: 'argparse-ja-japanese-query',
    query: '相互排他グループを作成する方法',
    sources: [argparseJa, argparse],
    answers: ['相互排他グループを作成します']
  },
  {
    id: 'mdn-reduce-no-initial-value',
    query: 'javascript reduce without initial value',
    sources: [mdnReduce, rustVectors],
    answers: ['Otherwise the array element at index 0 is used as the initial value', 'accumulator is initialized to the first value in the array']
  },
  {
    id: 'python-json-indent',
    query: 'python json dumps indent spaces per level',
    sources: [pythonJson, mdnReduce],
    answers: ['A positive integer indents that many spaces per level']
  },
  {
    id: 'rust-vector-get-out-of-range',
    query: 'rust vector get index out of range returns None',
    sources: [rustVectors, pythonJson],
    answers: ['returns None without panicking']
  },
  {
    id: 'nhs-cold-duration',
    query: 'how long does a common cold last adults',
    sources: [nhsCold, sourdough],
    answers: ['You should begin to feel better in about 1 to 2 weeks']
  },
  {
    id: 'paulgraham-find-aptitude',
    query: 'how do I find work to do well aptitude',
    sources: [paulGraham, pythonJson],
    answers: ['find something you have an aptitude for']
  },
  {
    id: 'sourdough-starter-time',
    query: 'sourdough starter how long warm place',
    sources: [sourdough, cookies, nhsCold],
    answers: ['left in a warm place for a week or two']
  },
  {
    id: 'ko-seoul-population',
    query: '서울 인구는 몇 명인가',
    sources: [seoul, mdnReduce],
    answers: ['931만 5,066명']
  },
  {
    id: 'so-sorted-array-branch',
    query: 'why is sorted array faster branch prediction',
    sources: [sorted, requestsIssue],
    answers: ['unpredictable branches with no recognizable patterns']
  },
  {
    id: 'requests-chunked-error-docs',
    query: 'ChunkedEncodingError documentation transient network errors',
    sources: [requestsIssue, pythonJson],
    answers: ['can be caused by transient network issues']
  },
  {
    id: 'cookies-oven-temperature',
    query: 'chocolate chip cookies oven temperature',
    sources: [cookies, nhsCold],
    answers: ['Preheat oven to 375°F (210°C)']
  }
];

function readFixture(file: string) {
  return readFileSync(path.join(FIXTURES, file), 'utf8');
}

function normalize(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}

function candidatesFor(question: Question): ResearchEvidence[] {
  return question.sources.map((source) => {
    const raw = readFixture(source.file);
    const text = source.format === 'html'
      ? extractReadableContentForQuery(raw, question.query).content.text
      : selectRelevantContent({ source: raw, format: source.format, query: question.query, maxLength: 4000 }).text;
    return {
      title: source.file,
      url: source.url,
      method: 'http',
      sourceKind: 'official-docs',
      summary: '',
      supports: [],
      resultCandidates: rankEvidencePassages(text, question.query),
      retrievalCut: false,
      selectionOmitted: false
    } as ResearchEvidence;
  });
}

const evidenceCache = new Map<string, ResearchEvidence[]>();

function allocation(question: Question, setting: LengthLimit) {
  if (!evidenceCache.has(question.id)) evidenceCache.set(question.id, candidatesFor(question));
  return allocateResult({
    sources: prepareEvidenceSources(evidenceCache.get(question.id)!, question.query, 0),
    findings: [],
    findingSourceIds: [],
    context: {},
    setting
  });
}

function emitted(question: Question, setting: LengthLimit): string[] {
  return allocation(question, setting).evidence.flatMap((source) => source.excerpts.map((excerpt) => normalize(excerpt.text)));
}

function hit(question: Question, setting: LengthLimit) {
  const texts = emitted(question, setting);
  return question.answers.some((answer) => texts.some((text) => text.includes(normalize(answer))));
}

function volume(question: Question, setting: LengthLimit) {
  const texts = emitted(question, setting);
  return { excerpts: texts.length, chars: texts.reduce((sum, text) => sum + Array.from(text).length, 0) };
}

// After-state for the question set, columns in LIMITS order. Y means the
// answer is emitted at that limit. A dash is a known miss, not asserted.
const AFTER_STATE: Record<string, string> = {
  'vitest-enable-coverage': 'YYYYY',
  'vitest-custom-reporter': 'YYYYY',
  'vitest-coverage-include': 'YYYYY',
  'vitest-config-override': 'YYYYY',
  'vitest-mock-date': 'YYYYY',
  'vitest-stub-global': 'YYYYY',
  'vitest-browser-components': 'YYYYY',
  'vite-chunk-import-map-preload': 'YYYYY',
  'argparse-mutually-exclusive': 'YYYYY',
  'argparse-ja-english-query': 'YYYYY',
  'argparse-ja-japanese-query': '-----',
  'mdn-reduce-no-initial-value': '---YY',
  'python-json-indent': 'YYYYY',
  'rust-vector-get-out-of-range': 'YYYYY',
  'nhs-cold-duration': 'YYYYY',
  'paulgraham-find-aptitude': '-----',
  'sourdough-starter-time': 'YYYYY',
  'ko-seoul-population': 'YYYYY',
  'so-sorted-array-branch': '-----',
  'requests-chunked-error-docs': 'YYYYY',
  'cookies-oven-temperature': 'YYYYY',
};

// Chars emitted at the roomy limits (4000, 8000, standard) when the guard was written.
// The guard asserts at least 90% of each value, so it catches a drop without pinning exact numbers.
const RECORDED_ROOMY_CHARS: Record<string, [number, number, number]> = {
  'vitest-enable-coverage': [3820, 5045, 5045],
  'vitest-custom-reporter': [3925, 4148, 4148],
  'vitest-coverage-include': [3827, 4502, 4502],
  'vitest-config-override': [3948, 4246, 4246],
  'vitest-mock-date': [3952, 4081, 4081],
  'vitest-stub-global': [1894, 1894, 1894],
  'vitest-browser-components': [3965, 4802, 4802],
  'vite-chunk-import-map-preload': [3943, 5257, 5257],
  'argparse-mutually-exclusive': [2644, 2644, 2644],
  'argparse-ja-english-query': [2671, 2671, 2671],
  'argparse-ja-japanese-query': [3859, 3859, 3859],
  'mdn-reduce-no-initial-value': [3964, 5318, 5318],
  'python-json-indent': [3973, 4064, 4064],
  'rust-vector-get-out-of-range': [3977, 5060, 5060],
  'nhs-cold-duration': [3683, 3683, 3683],
  'paulgraham-find-aptitude': [3881, 3881, 3881],
  'sourdough-starter-time': [3961, 5333, 5333],
  'ko-seoul-population': [2217, 2217, 2217],
  'so-sorted-array-branch': [2590, 2590, 2590],
  'requests-chunked-error-docs': [2966, 2966, 2966],
  'cookies-oven-temperature': [3910, 4310, 4310],
};

const ROOMY = LIMITS.filter(({ label }) => label === '4000' || label === '8000' || label === 'standard');

describe('passage ranking question set', () => {
  it('records the answer-presence table', () => {
    const rows = QUESTIONS.map((question) => ({
      id: question.id,
      cells: LIMITS.map(({ setting }) => {
        const { excerpts, chars } = volume(question, setting);
        return `${hit(question, setting) ? 'Y' : '-'}${excerpts}/${chars}`;
      })
    }));
    const header = `${'question'.padEnd(30)} ${LIMITS.map(({ label }) => label.padStart(10)).join(' ')}`;
    const lines = [header, ...rows.map((row) => `${row.id.padEnd(30)} ${row.cells.map((cell) => cell.padStart(10)).join(' ')}`)];
    const total = LIMITS.map((_, index) => rows.filter((row) => row.cells[index]!.startsWith('Y')).length);
    lines.push(`${'hits'.padEnd(30)} ${total.map((count) => `${count}/${QUESTIONS.length}`.padStart(10)).join(' ')}`);
    const cutsOut = process.env.PASSAGE_RANKING_CUTS;
    if (cutsOut) {
      const cutRows = QUESTIONS.map((question) => `${question.id.padEnd(30)} ${LIMITS.map(({ setting }) => {
        const result = allocation(question, setting);
        return `${result.cutSourceIds.length}/${result.evidence.length}`.padStart(10);
      }).join(' ')}`);
      writeFileSync(cutsOut, [`${'question'.padEnd(30)} ${LIMITS.map(({ label }) => label.padStart(10)).join(' ')}`, ...cutRows].join('\n') + '\n');
    }
    const out = process.env.PASSAGE_RANKING_TABLE;
    if (out) writeFileSync(out, lines.join('\n') + '\n');
  }, 300_000);

  it('marks no source as cut at standard', () => {
    const cut: string[] = [];
    for (const question of QUESTIONS) {
      const result = allocation(question, 'standard');
      if (result.cutSourceIds.length) cut.push(`${question.id}: ${result.cutSourceIds.join(',')}`);
    }
    expect(cut, `sources marked cut at standard:\n${cut.join('\n')}`).toEqual([]);
  }, 300_000);

  it('keeps every answer in the after-state table', () => {
    const dropped: string[] = [];
    for (const question of QUESTIONS) {
      const expected = AFTER_STATE[question.id];
      expect(expected, `missing after-state row for ${question.id}`).toHaveLength(LIMITS.length);
      LIMITS.forEach(({ label, setting }, index) => {
        if (expected![index] === 'Y' && !hit(question, setting)) dropped.push(`${question.id} at limit ${label}`);
      });
    }
    expect(dropped, `answers dropped from the passage ranking question set:\n${dropped.join('\n')}`).toEqual([]);
  }, 300_000);

  it('keeps emitted chars at the roomy limits above 90% of the recorded values', () => {
    const shrunk: string[] = [];
    for (const question of QUESTIONS) {
      const recorded = RECORDED_ROOMY_CHARS[question.id];
      expect(recorded, `missing recorded chars for ${question.id}`).toBeDefined();
      ROOMY.forEach(({ label, setting }, index) => {
        const { chars } = volume(question, setting);
        if (chars < Math.floor(recorded![index]! * 0.9)) shrunk.push(`${question.id} at limit ${label}: ${chars} < ${Math.floor(recorded![index]! * 0.9)}`);
      });
    }
    expect(shrunk, `excerpt text shrank at roomy limits:\n${shrunk.join('\n')}`).toEqual([]);
  }, 300_000);
});
