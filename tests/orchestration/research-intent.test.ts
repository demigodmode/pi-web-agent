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

  it('does not cover a named target merely because another source mentions it', () => {
    const intent = classifyResearchIntent('Compare https://react.dev/guide with Vue');
    const evidence = [
      { title: 'React guide', url: 'https://react.dev/guide', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React differs from Vue', supports: ['Vue uses a different model'] },
      { title: 'React versus Vue', url: 'https://blog.example/react-vs-vue', sourceKind: 'community' as const, method: 'http' as const, summary: 'A comparison of React and Vue', supports: [] }
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

  it('does not count commentary about the original project as an alternative', () => {
    const intent = classifyResearchIntent('Compare https://react.dev/learn with alternatives');
    const evidence = [
      { title: 'React learn', url: 'https://react.dev/learn', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React guide', supports: [] },
      { title: 'React vs Vue', url: 'https://blog.example/react-vs-vue', sourceKind: 'community' as const, method: 'http' as const, summary: 'React and Vue compared', supports: [] }
    ];
    expect(missingComparisonTargets(intent, evidence)).toEqual(['alternatives']);
  });

  it('does not mistake a blog branded article for a different project', () => {
    const intent = classifyResearchIntent('Compare https://react.dev/learn with alternatives');
    const evidence = [
      { title: 'React learn', url: 'https://react.dev/learn', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'React guide', supports: [] },
      { title: 'Blog: React vs Vue', url: 'https://blog.example/react-vs-vue', sourceKind: 'community' as const, method: 'http' as const, summary: 'React and Vue compared', supports: [] }
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

  it('counts a website as an alternative to a pinned GitHub repository', () => {
    const intent = classifyResearchIntent('Compare https://github.com/acme/widget with alternatives');
    const evidence = [
      { title: 'Widget', url: `https://github.com/acme/widget/tree/${'a'.repeat(40)}`, sourceKind: 'unknown' as const, method: 'github' as const, summary: 'Widget code', supports: [] },
      { title: 'Other Project', url: 'https://otherproject.dev/docs', sourceKind: 'official-docs' as const, method: 'http' as const, summary: 'Alternative project documentation', supports: [] }
    ];

    expect(missingComparisonTargets(intent, evidence)).toEqual([]);
  });

  it('recognizes a project hosted under a multi-label public suffix', () => {
    const intent = classifyResearchIntent('Compare https://github.com/acme/widget with alternatives');
    const evidence = [
      { title: 'Widget', url: `https://github.com/acme/widget/tree/${'a'.repeat(40)}`, sourceKind: 'unknown' as const, method: 'github' as const, summary: 'Widget code', supports: [] },
      { title: 'Other Project', url: 'https://other.co.uk/docs', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'Other project docs', supports: [] }
    ];
    expect(missingComparisonTargets(intent, evidence)).toEqual([]);
  });

  it('does not count a repository project website as an alternative to itself', () => {
    const intent = classifyResearchIntent('Compare https://github.com/acme/widget with alternatives');
    const evidence = [
      { title: 'Widget', url: `https://github.com/acme/widget/tree/${'a'.repeat(40)}`, sourceKind: 'unknown' as const, method: 'github' as const, summary: 'Widget code', supports: [] },
      { title: 'Widget documentation', url: 'https://widget.dev/docs', sourceKind: 'unknown' as const, method: 'http' as const, summary: 'Widget docs', supports: [] }
    ];
    expect(missingComparisonTargets(intent, evidence)).toEqual(['alternatives']);
  });

  it('distinguishes package identities on the same registry host', () => {
    const intent = classifyResearchIntent('Compare https://www.npmjs.com/package/react with alternatives');
    const evidence = [
      { title: 'react - npm', url: 'https://www.npmjs.com/package/react', sourceKind: 'package-page' as const, method: 'http' as const, summary: 'React package', supports: [] },
      { title: 'vue - npm', url: 'https://www.npmjs.com/package/vue', sourceKind: 'package-page' as const, method: 'http' as const, summary: 'Vue package', supports: [] }
    ];
    expect(missingComparisonTargets(intent, evidence)).toEqual([]);
  });
});

describe('classifyResearchIntent with links only', () => {
  it('reads a query that is nothing but a link', () => {
    const url = 'https://github.com/demigodmode/pi-web-agent/issues/83';
    expect(classifyResearchIntent(url)).toEqual({ kind: 'read', targets: [{ kind: 'url', value: url }], requiresAlternative: false });
  });

  it('reads every link when the words around them only frame the request', () => {
    expect(classifyResearchIntent('check https://a.test/x https://b.test/y')).toEqual({
      kind: 'read',
      targets: [{ kind: 'url', value: 'https://a.test/x' }, { kind: 'url', value: 'https://b.test/y' }],
      requiresAlternative: false
    });
  });

  it('keeps a real question about a plain page as research', () => {
    expect(classifyResearchIntent('how does https://example.com/docs handle retries').kind).toBe('research');
  });

  it('keeps a question about a typed repository on the existing repository rule', () => {
    expect(classifyResearchIntent('how does https://github.com/acme/widget handle retries').kind).toBe('read');
  });

  it('keeps a comparison of two links a comparison', () => {
    expect(classifyResearchIntent('compare https://a.test vs https://b.test').kind).toBe('compare');
  });
});
