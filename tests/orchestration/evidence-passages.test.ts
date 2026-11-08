import { describe, expect, it } from 'vitest';
import { rankEvidencePassages, selectEvidencePassages, splitEvidenceParagraphs } from '../../src/orchestration/evidence-passages.js';

describe('selectEvidencePassages', () => {
  it('keeps a relevant late paragraph under a bounded passage count', () => {
    const text = ['General introduction.', 'Unrelated background.', 'More background.', 'Install the coverage provider with npm install @vitest/coverage-v8.'].join('\n\n');
    const result = selectEvidencePassages(text, 'install vitest coverage provider');
    expect(result.excerpts).toContain('Install the coverage provider with npm install @vitest/coverage-v8.');
    expect(result.excerpts).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('does not score a query term inside a longer word', () => {
    const text = [
      'The capital city has a large population.',
      'Capital projects require annual budget approval.',
      'Capital letters are used at the start of sentences.',
      'The API contract requires an Authorization header.'
    ].join('\n\n');

    const result = selectEvidencePassages(text, 'API');

    expect(result.excerpts).toEqual([
      'The capital city has a large population.',
      'Capital projects require annual budget approval.',
      'The API contract requires an Authorization header.'
    ]);
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

  it('keeps tilde-fenced code with interior blank lines as one ordered paragraph', () => {
    const code = '~~~ts\nconst value = 1;\n\nconsole.log(value);\n~~~';
    expect(splitEvidenceParagraphs(`Before.\n\n${code}\n\nAfter.`)).toEqual(['Before.', code, 'After.']);
  });

  it('ranks a late exact version over navigation boilerplate', () => {
    const text = [
      'Home Docs Blog Cookies Privacy Sign in.',
      'API version 1.5 added the Unicode parser for AcmeWidget.',
      'Home Docs Blog Cookies Privacy Sign in.'
    ].join('\n\n');
    const ranked = rankEvidencePassages(text, 'AcmeWidget API 1.5');
    expect(ranked[0]).toMatchObject({ text: 'API version 1.5 added the Unicode parser for AcmeWidget.', order: 1, codeBlock: false });
  });

  it('preserves code provenance for every long fenced-code chunk', () => {
    const code = `~~~ts\n${'const value = call(value);\n'.repeat(70)}~~~`;
    const ranked = rankEvidencePassages(code, 'call value');
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked.every((candidate) => candidate.codeBlock)).toBe(true);
  });

  it('keeps a short exact version answer when other candidates are boilerplate', () => {
    const ranked = rankEvidencePassages('Home Docs Cookies Privacy.\n\n1.4', 'version 1.4');
    expect(ranked.map((candidate) => candidate.text)).toContain('1.4');
  });

  it('ranks an exact numeric answer above an earlier generic matching paragraph', () => {
    const ranked = rankEvidencePassages([
      'Version notes describe the rollout.',
      'Version 42 is the supported rollout.'
    ].join('\n\n'), 'version 42');
    expect(ranked[0]?.text).toBe('Version 42 is the supported rollout.');
  });

  it('filters ordinary consent and subscribe boilerplate without losing a short code answer', () => {
    const consent = 'We use cookies to personalize content and measure traffic. Accept all cookies, manage consent preferences, subscribe to our newsletter, or sign in to continue.';
    const ranked = rankEvidencePassages(`${consent}\n\n\`--force\``, 'force');
    expect(ranked.map((candidate) => candidate.text)).not.toContain(consent);
    expect(ranked.map((candidate) => candidate.text)).toContain('`--force`');
  });

  it('keeps a four-backtick block intact when it contains shorter tick and tilde fences', () => {
    const code = '````markdown\n```\n~~~\n````';
    expect(splitEvidenceParagraphs(`Before.\n\n${code}\n\nAfter.`)).toEqual(['Before.', code, 'After.']);
    expect(rankEvidencePassages(code, 'markdown')[0]).toMatchObject({ text: code, codeBlock: true });
  });
});
