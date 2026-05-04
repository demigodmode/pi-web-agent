import { describe, expect, it } from 'vitest';
import { createBackendSet } from '../../src/backends/factory.js';

describe('backend factory', () => {
  it('creates the existing search/fetch/headless tools by default', () => {
    const backends = createBackendSet();

    expect(backends.search).toEqual(expect.any(Function));
    expect(backends.fetchPage).toEqual(expect.any(Function));
    expect(backends.headlessFetch).toEqual(expect.any(Function));
  });
});
