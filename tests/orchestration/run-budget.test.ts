import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResearchRunBudget } from '../../src/orchestration/run-budget.js';

afterEach(() => vi.useRealTimers());

describe('research run budget', () => {
  it('caps searches, page fetches, and headless attempts across one run', () => {
    const budget = createResearchRunBudget({ timeoutMs: 120_000 });
    expect(Array.from({ length: 5 }, () => budget.claimSearch())).toEqual([true, true, true, true, true]);
    expect(budget.claimSearch()).toBe(false);
    expect(Array.from({ length: 20 }, (_, index) => budget.claimFetch(`https://example.com/${index}`)).every(Boolean)).toBe(true);
    expect(budget.claimFetch('https://example.com/overflow')).toBe(false);
    expect(budget.claimHeadless()).toBe(true);
    expect(budget.claimHeadless()).toBe(true);
    expect(budget.claimHeadless()).toBe(false);
    expect(budget.snapshot()).toMatchObject({ searches: 5, fetches: 20, headless: 2, limitReason: 'headless-limit' });
    budget.dispose();
  });

  it('reserves canonical URLs once even when tracking parameters differ', () => {
    const budget = createResearchRunBudget({ timeoutMs: 120_000 });
    expect(budget.claimFetch('https://example.com/page?utm_source=first')).toBe(true);
    expect(budget.claimFetch('https://example.com/page?utm_source=second')).toBe(false);
    expect(budget.snapshot().fetches).toBe(1);
    budget.dispose();
  });

  it('settles waiting at deadline while retaining the underlying operation for drainage', async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined);
    const tracked: Promise<unknown>[] = [];
    const budget = createResearchRunBudget({ timeoutMs: 100, track: (promise) => tracked.push(promise) });
    const result = budget.wait(pending);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(budget.deadlineReached()).toBe(true);
    expect(tracked).toEqual([pending]);
    budget.dispose();
  });

  it('keeps caller cancellation distinct from deadline exhaustion', async () => {
    const controller = new AbortController();
    const budget = createResearchRunBudget({ signal: controller.signal, timeoutMs: 120_000 });
    expect(budget.claimFetch('https://example.com/guide')).toBe(true);
    controller.abort();
    expect(() => budget.claimFetch('https://example.com/guide')).toThrowError(/aborted/i);
    await expect(budget.wait(Promise.resolve('done'))).rejects.toMatchObject({ name: 'AbortError' });
    expect(budget.deadlineReached()).toBe(false);
    budget.dispose();
  });
});
