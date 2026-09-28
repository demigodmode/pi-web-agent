import { describe, expect, it, vi } from 'vitest';
import {
  abortError,
  abortableSleep,
  fetchWithSignal,
  raceAbort,
  requestSignal,
  throwIfAborted
} from '../src/abort.js';

describe('abort helpers', () => {
  it('uses one error for every cancel', () => {
    const error = abortError();
    expect(error.message).toBe('Operation aborted');
    expect(error.name).toBe('AbortError');
  });

  it('throwIfAborted only throws for an aborted signal', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow('Operation aborted');
  });

  it('requestSignal fires on the caller cancel and on the timeout, and keeps them apart', async () => {
    const caller = new AbortController();
    const cancelled = requestSignal(caller.signal, 10_000);
    caller.abort();
    expect(cancelled.aborted).toBe(true);

    const idle = new AbortController();
    const timed = requestSignal(idle.signal, 10);
    await vi.waitFor(() => expect(timed.aborted).toBe(true));
    expect(idle.signal.aborted).toBe(false);

    const alone = requestSignal(undefined, 10);
    await vi.waitFor(() => expect(alone.aborted).toBe(true));
  });

  it('abortableSleep resolves normally and rejects as soon as the signal fires', async () => {
    await expect(abortableSleep(5)).resolves.toBeUndefined();

    const controller = new AbortController();
    const sleeping = abortableSleep(10_000, controller.signal);
    controller.abort();
    await expect(sleeping).rejects.toThrow('Operation aborted');

    await expect(abortableSleep(5, controller.signal)).rejects.toThrow('Operation aborted');
  });

  it('fetchWithSignal adds the signal to every call and keeps the rest of init', async () => {
    const base = vi.fn(async () => new Response('ok'));
    const controller = new AbortController();
    const wrapped = fetchWithSignal(base as unknown as typeof fetch, controller.signal);

    await wrapped('https://example.com/', { headers: { a: 'b' } });
    await wrapped('https://example.com/other');

    expect(base).toHaveBeenNthCalledWith(1, 'https://example.com/', { headers: { a: 'b' }, signal: controller.signal });
    expect(base).toHaveBeenNthCalledWith(2, 'https://example.com/other', { signal: controller.signal });
  });

  it('raceAbort rejects on cancel while the work keeps running, and passes results through otherwise', async () => {
    await expect(raceAbort(Promise.resolve('done'), new AbortController().signal)).resolves.toBe('done');

    const controller = new AbortController();
    let finish!: () => void;
    const work = new Promise<string>((resolve) => (finish = () => resolve('late')));
    const raced = raceAbort(work, controller.signal);
    controller.abort();
    await expect(raced).rejects.toThrow('Operation aborted');
    finish();
    await expect(work).resolves.toBe('late');

    const already = new AbortController();
    already.abort();
    await expect(raceAbort(Promise.resolve('x'), already.signal)).rejects.toThrow('Operation aborted');
  });

  it('raceAbort does not leave an unhandled rejection when the abandoned work fails', async () => {
    const controller = new AbortController();
    let fail!: () => void;
    const work = new Promise<string>((_, reject) => (fail = () => reject(new Error('boom'))));
    const raced = raceAbort(work, controller.signal);
    controller.abort();
    await expect(raced).rejects.toThrow('Operation aborted');
    fail();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('raceAbort does not leave an unhandled rejection when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let fail!: () => void;
    const work = new Promise<string>((_, reject) => (fail = () => reject(new Error('boom'))));
    const raced = raceAbort(work, controller.signal);
    await expect(raced).rejects.toThrow('Operation aborted');
    fail();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
