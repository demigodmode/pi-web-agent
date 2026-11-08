import { describe, expect, it } from 'vitest';
import { comparePassages, containsPassageTokens } from '../../src/results/duplicate-passages.js';

describe('comparePassages', () => {
  it.each([
    ['Recommended   mode!', 'recommended mode'],
    ['Caf\u00e9 guidance', 'caf\u00e9 guidance'],
    ['The caf\u00e9 is open', 'the cafe\u0301 is open']
  ])('recognizes normalized equality: %j / %j', (left, right) => {
    expect(comparePassages(left, right)).toBe('equal');
  });

  it('never drops the longer qualification', () => {
    expect(comparePassages('recommended mode', 'recommended mode for development only')).toBe('left-contained');
    expect(comparePassages('recommended mode for development only', 'recommended mode')).toBe('right-contained');
  });

  it.each([
    ['supported since 1.4', 'supported since 1.5'],
    ['limit is 10', 'limit is 20'],
    ['recommended mode', 'not recommended mode'],
    ['use this mode', 'use this mode unsupported'],
    ['use this mode', 'use this mode deprecated'],
    ["we don't support that", 'we support that'],
    ["needn't use this mode", 'use this mode'],
    ['Use `foo()` here', 'Use `Foo()` here'],
    ['Use ``a ` b`` here', 'Use ``a ` B`` here'],
    ['a-b', 'ab'],
    ['API', 'capital']
  ])('preserves distinct normal-prose meaning: %j / %j', (left, right) => {
    expect(comparePassages(left, right)).toBe('distinct');
  });

  it.each([
    ['```js\na + b\n```', '```js\na + b\n```', undefined, 'equal'],
    ['```js\na + b\n```', '```js\na - b\n```', undefined, 'distinct'],
    ['```js\nfoo()\n```', '```js\nFoo()\n```', undefined, 'distinct'],
    ['```js\na + b\n```', '```js\na + b\n``` ', undefined, 'distinct'],
    ['a + b', 'a + b', { leftCodeBlock: true }, 'equal'],
    ['a + b', 'a - b', { rightCodeBlock: true }, 'distinct']
  ])('uses byte equality for fenced or provenance-marked code', (left, right, code, relation) => {
    expect(comparePassages(left, right, code)).toBe(relation);
  });

  it('does not compare an interior chunk from a long fenced block as prose', () => {
    const interior = `value + ${'x'.repeat(920)}`;
    expect(comparePassages(interior, interior.toUpperCase(), { leftCodeBlock: true, rightCodeBlock: true })).toBe('distinct');
  });

  it.each([
    ['', ''],
    ['!!!', '???'],
    ['   ', '\n\t']
  ])('keeps empty or non-word values distinct unless byte-identical: %j / %j', (left, right) => {
    expect(comparePassages(left, right)).toBe(left === right ? 'equal' : 'distinct');
  });

  it('requires a whole token sequence for containment', () => {
    expect(comparePassages('api', 'capital')).toBe('distinct');
    expect(comparePassages('mode', 'recommended-mode only')).toBe('left-contained');
  });

  it('uses whole number, version, word, operator, and inline-code tokens for finding coverage', () => {
    expect(containsPassageTokens('finished in 50 milliseconds since 2020', '50 milliseconds')).toBe(true);
    expect(containsPassageTokens('finished in 500 milliseconds', '50')).toBe(false);
    expect(containsPassageTokens('supported since 50.5', '50')).toBe(false);
    expect(containsPassageTokens('supported since 1.40', '1.4')).toBe(false);
    expect(containsPassageTokens('request timeouts apply', 'timeout')).toBe(false);
    expect(containsPassageTokens('Use `bar()` here', 'Use `foo()` here')).toBe(false);
    expect(containsPassageTokens('value - limit', 'value + limit')).toBe(false);
  });

  it('strips a trailing ellipsis without allowing partial word, number, or identifier coverage', () => {
    expect(containsPassageTokens('request timeouts apply', 'timeout…')).toBe(false);
    expect(containsPassageTokens('request took 500 milliseconds', '50…')).toBe(false);
    expect(containsPassageTokens('timeout applies', 'timeout…')).toBe(true);
    expect(containsPassageTokens('client_timeout applies', 'timeout')).toBe(false);
  });
});
