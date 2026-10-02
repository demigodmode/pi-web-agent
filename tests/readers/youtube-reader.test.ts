import { describe, it, expect, vi } from 'vitest';
import { createYoutubeReader } from '../../src/readers/youtube-reader.js';

describe('createYoutubeReader', () => {
  it('handles watch, youtu.be, shorts, live, embed forms', () => {
    const reader = createYoutubeReader({ fetchSubtitles: vi.fn(), fetchDetails: vi.fn() });
    expect(reader.canHandle('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(reader.canHandle('https://youtu.be/abc123')).toBe(true);
    expect(reader.canHandle('https://www.youtube.com/shorts/abc123')).toBe(true);
    expect(reader.canHandle('https://www.youtube.com/live/abc123')).toBe(true);
    expect(reader.canHandle('https://www.youtube.com/embed/abc123')).toBe(true);
    expect(reader.canHandle('https://www.youtube.com/feed/subscriptions')).toBe(false);
    expect(reader.canHandle('https://example.com/watch?v=abc')).toBe(false);
  });

  it('returns the transcript text with title', async () => {
    const reader = createYoutubeReader({
      fetchSubtitles: vi.fn().mockResolvedValue([
        { start: '0', dur: '1', text: 'hello' },
        { start: '1', dur: '1', text: 'world' }
      ]),
      fetchDetails: vi.fn().mockResolvedValue({ title: 'My Talk', description: '' })
    });
    const res = await reader.read('https://youtu.be/abc123');
    expect(res.status).toBe('ok');
    expect(res.metadata.method).toBe('youtube');
    expect(res.content?.title).toBe('My Talk');
    expect(res.content?.text).toContain('hello world');
  });

  it('passes the extracted video id to the fetchers', async () => {
    const fetchSubtitles = vi.fn().mockResolvedValue([{ start: '0', dur: '1', text: 'x' }]);
    const reader = createYoutubeReader({ fetchSubtitles, fetchDetails: vi.fn().mockResolvedValue({ title: 't' }) });
    await reader.read('https://www.youtube.com/watch?v=XYZ987');
    expect(fetchSubtitles).toHaveBeenCalledWith({ videoID: 'XYZ987', lang: 'en' });
  });

  it('caveats a video with no captions', async () => {
    const reader = createYoutubeReader({
      fetchSubtitles: vi.fn().mockResolvedValue([]),
      fetchDetails: vi.fn().mockResolvedValue({ title: 'Silent' })
    });
    const res = await reader.read('https://youtu.be/nocaps');
    expect(res.status).toBe('unsupported');
    expect(res.error?.code).toBe('YOUTUBE_NO_CAPTIONS');
  });

  it('returns an error response when the fetcher throws', async () => {
    const reader = createYoutubeReader({
      fetchSubtitles: vi.fn().mockRejectedValue(new Error('yt changed its api')),
      fetchDetails: vi.fn().mockResolvedValue({ title: 't' })
    });
    const res = await reader.read('https://youtu.be/boom');
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('YOUTUBE_READ_FAILED');
  });
});

describe('youtube reader cancellation', () => {
  it('routes the caption requests through a fetch that carries the caller signal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    const controller = new AbortController();
    await createYoutubeReader({ fetchImpl: fetchImpl as unknown as typeof fetch }).read('https://www.youtube.com/watch?v=XYZ987', controller.signal);
    expect(fetchImpl).toHaveBeenCalled();
    const signal = (fetchImpl.mock.calls[0][1] as RequestInit).signal!;
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});
