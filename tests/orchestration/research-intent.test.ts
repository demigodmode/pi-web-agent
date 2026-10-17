import { describe, expect, it } from 'vitest';
import { classifyResearchIntent, missingComparisonTargets } from '../../src/orchestration/research-intent.js';

describe('classifyResearchIntent', () => {
  it('treats an explicit request to read one URL as a read', () => {
    expect(classifyResearchIntent('Read https://example.com/file.pdf')).toEqual({
      kind: 'read', targets: [{ kind: 'url', value: 'https://example.com/file.pdf' }], requiresAlternative: false
    });
    expect(classifyResearchIntent('Please summarize https://example.com/file.pdf').kind).toBe('read');
    expect(classifyResearchIntent('Can you read this URL: https://example.com/file.pdf?').kind).toBe('read');
  });

  it('treats a question about one typed repository as a direct read', () => {
    expect(classifyResearchIntent('where does this project refresh OAuth tokens? https://github.com/acme/widget').kind).toBe('read');
    expect(classifyResearchIntent('what is https://github.com/acme/widget').kind).toBe('read');
    expect(classifyResearchIntent('What does this repo do with Reddit? https://github.com/acme/widget').kind).toBe('read');
  });

  it('treats a URL comparison with alternatives as a comparison', () => {
    expect(classifyResearchIntent('Compare https://example.com/file.pdf with alternatives')).toEqual({
      kind: 'compare', targets: [{ kind: 'url', value: 'https://example.com/file.pdf' }], requiresAlternative: true
    });
  });

  it('extracts unambiguous named comparison targets', () => {
    expect(classifyResearchIntent('Compare React and Vue')).toEqual({
      kind: 'compare', targets: [{ kind: 'name', value: 'React' }, { kind: 'name', value: 'Vue' }], requiresAlternative: false
    });
    expect(classifyResearchIntent('React vs Vue')).toEqual({
      kind: 'compare', targets: [{ kind: 'name', value: 'React' }, { kind: 'name', value: 'Vue' }], requiresAlternative: false
    });
  });

  it('tracks the named target when comparing a supplied URL with a product', () => {
    expect(classifyResearchIntent('Compare https://react.dev/guide with Vue')).toEqual({
      kind: 'compare',
      targets: [{ kind: 'url', value: 'https://react.dev/guide' }, { kind: 'name', value: 'Vue' }],
      requiresAlternative: false
    });
    expect(classifyResearchIntent('Compare Vue with https://react.dev/guide').targets).toEqual([
      { kind: 'url', value: 'https://react.dev/guide' }, { kind: 'name', value: 'Vue' }
    ]);
    const intent = classifyResearchIntent('Compare https://react.dev/guide with Vue');
    const evidence = [
      { title: 'React guide', url: 'https://react.dev/guide', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React guide', supports: [] },
      { title: 'Other page', url: 'https://example.com/other', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'Other page', supports: [] }
    ];
    expect(missingComparisonTargets(intent, evidence)).toEqual(['Vue']);
  });

  it('leaves a generic API question as research', () => {
    expect(classifyResearchIntent('How does the React API work?')).toEqual({ kind: 'research', targets: [], requiresAlternative: false });
  });

  it('reports the specific target still missing from comparison evidence', () => {
    const intent = classifyResearchIntent('Compare React and Vue');
    const evidence = [{ title: 'React guide', url: 'https://react.dev/guide', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React effects', supports: ['React effects'] }];
    expect(missingComparisonTargets(intent, evidence)).toEqual(['Vue']);
  });

  it('counts a pinned cloned repository as coverage for its supplied root URL', () => {
    const intent = classifyResearchIntent('Compare https://github.com/acme/widget with alternatives');
    const evidence = [{ title: 'Widget', url: `https://github.com/acme/widget/tree/${'a'.repeat(40)}`, sourceKind: 'unknown' as const, method: 'github' as const, summary: 'Widget code', supports: ['Widget code'] }];
    expect(missingComparisonTargets(intent, evidence)).toEqual(['alternatives']);
  });

  it('requires an alternative identity instead of two pages from the compared site', () => {
    const intent = classifyResearchIntent('Compare https://react.dev/learn with alternatives');
    const evidence = [
      { title: 'React learn', url: 'https://react.dev/learn', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React learn', supports: [] },
      { title: 'React reference', url: 'https://react.dev/reference', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React reference', supports: [] }
    ];

    expect(missingComparisonTargets(intent, evidence)).toEqual(['alternatives']);
  });

  it('does not treat differently titled pages from one project documentation site as alternatives', () => {
    const intent = classifyResearchIntent('Compare https://react.dev/learn with alternatives');
    const evidence = [
      { title: 'Quick Start | React', url: 'https://react.dev/learn', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'React quick start', supports: [] },
      { title: 'Hooks | React', url: 'https://react.dev/reference/react/useState', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'React hooks reference', supports: [] }
    ];

    expect(missingComparisonTargets(intent, evidence)).toEqual(['alternatives']);
  });

  it('counts distinct subjects on the same documentation host as alternatives', () => {
    const intent = classifyResearchIntent('Compare https://developer.mozilla.org/en-US/docs/Web/JavaScript with alternatives');
    const evidence = [
      { title: 'JavaScript | MDN', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'JavaScript language guide', supports: [] },
      { title: 'CSS | MDN', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'CSS styling guide', supports: [] }
    ];

    expect(missingComparisonTargets(intent, evidence)).toEqual([]);
  });

  it('counts different GitHub repositories as distinct alternatives', () => {
    const intent = classifyResearchIntent('Compare https://github.com/acme/widget with alternatives');
    const evidence = [
      { title: 'Widget', url: 'https://github.com/acme/widget', sourceKind: 'unknown' as const, method: 'github' as const, summary: 'Widget code', supports: [] },
      { title: 'Alternative', url: 'https://github.com/other/widget', sourceKind: 'unknown' as const, method: 'github' as const, summary: 'Alternative code', supports: [] }
    ];

    expect(missingComparisonTargets(intent, evidence)).toEqual([]);
  });
});
