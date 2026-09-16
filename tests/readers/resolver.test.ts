import { describe, it, expect, vi } from 'vitest';
import { createSpecialContentResolver } from '../../src/readers/resolver.js';
import type { SpecialContentReader } from '../../src/readers/types.js';

function reader(name: string, handles: (u: string) => boolean, ct?: (c: string) => boolean): SpecialContentReader {
  return {
    name,
    canHandle: handles,
    canHandleContentType: ct,
    read: vi.fn().mockResolvedValue({ status: 'ok', url: 'x', content: { title: name, text: name }, metadata: { method: name, cacheHit: false } })
  };
}

describe('createSpecialContentResolver', () => {
  it('routes a matching url to its reader', async () => {
    const gh = reader('github', (u) => new URL(u).hostname === 'github.com');
    const fallback = vi.fn();
    const resolve = createSpecialContentResolver({ readers: [gh], fallback });
    const res = await resolve({ url: 'https://github.com/a/b' });
    expect(res.content?.title).toBe('github');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls through to the fallback for a normal url', async () => {
    const gh = reader('github', (u) => new URL(u).hostname === 'github.com');
    const fallback = vi.fn().mockResolvedValue({ status: 'ok', url: 'y', content: { title: 'html', text: 'html' }, metadata: { method: 'http', cacheHit: false } });
    const resolve = createSpecialContentResolver({ readers: [gh], fallback });
    const res = await resolve({ url: 'https://example.com/post' });
    expect(res.content?.title).toBe('html');
    expect(fallback).toHaveBeenCalledWith({ url: 'https://example.com/post' });
  });

  it('routes an unsupported application/pdf fallback response to the pdf reader', async () => {
    const pdf = reader('pdf', () => false, (c) => c.includes('application/pdf'));
    const fallback = vi.fn().mockResolvedValue({ status: 'unsupported', url: 'z', metadata: { method: 'http', cacheHit: false, contentType: 'application/pdf' } });
    const resolve = createSpecialContentResolver({ readers: [pdf], fallback });
    const res = await resolve({ url: 'https://h/download' });
    expect(res.content?.title).toBe('pdf');
    expect(pdf.read).toHaveBeenCalledWith('https://h/download');
  });
});
