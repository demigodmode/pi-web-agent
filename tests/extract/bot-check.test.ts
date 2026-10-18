import { describe, expect, test } from 'vitest';
import { isBotCheckContent } from '../../src/extract/bot-check.js';

describe('isBotCheckContent', () => {
  test('uses an explicit bot-check marker', () => {
    expect(isBotCheckContent({ text: 'ordinary content', botCheck: true })).toBe(true);
  });

  test('detects bot-check text in a title or body', () => {
    expect(isBotCheckContent({ title: 'Just a moment', text: 'ordinary content' })).toBe(true);
    expect(isBotCheckContent({ text: 'Checking your browser before accessing the site.' })).toBe(true);
  });

  test('does not classify ordinary readable content', () => {
    expect(isBotCheckContent({ text: 'A detailed article about browser testing.' })).toBe(false);
  });
});
