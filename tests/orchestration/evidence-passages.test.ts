import { describe, expect, it } from 'vitest';
import { selectEvidencePassages } from '../../src/orchestration/evidence-passages.js';

describe('selectEvidencePassages', () => {
  it('keeps a relevant late paragraph under a bounded passage count', () => {
    const text = ['General introduction.', 'Unrelated background.', 'More background.', 'Install the coverage provider with npm install @vitest/coverage-v8.'].join('\n\n');
    const result = selectEvidencePassages(text, 'install vitest coverage provider');
    expect(result.excerpts).toContain('Install the coverage provider with npm install @vitest/coverage-v8.');
    expect(result.excerpts).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('preserves line breaks in a relevant code block', () => {
    const code = '```ts\nconst coverage = {\n  provider: "v8"\n};\n```';
    const result = selectEvidencePassages(`Intro.\n\n${code}`, 'coverage provider');
    expect(result.excerpts).toContain(code);
  });

  it('keeps fenced code with an internal blank line as one excerpt', () => {
    const code = '```ts\nconst coverage = true;\n\nconsole.log(coverage);\n```';
    const result = selectEvidencePassages(`Intro.\n\n${code}`, 'coverage');
    expect(result.excerpts).toContain(code);
  });

  it('keeps early substantive passages when nothing matches', () => {
    const result = selectEvidencePassages('First paragraph.\n\nSecond paragraph.', 'unrelated term');
    expect(result.excerpts).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('caps a long passage and reports truncation', () => {
    const result = selectEvidencePassages(`coverage ${'details '.repeat(200)}`, 'coverage');
    expect(result.excerpts[0]?.length).toBeLessThanOrEqual(900);
    expect(result.truncated).toBe(true);
  });
});
