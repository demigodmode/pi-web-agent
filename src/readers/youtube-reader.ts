import { getSubtitles, getVideoDetails } from 'youtube-caption-extractor';
import type { WebFetchResponse } from '../types.js';
import type { SpecialContentReader } from './types.js';
import { READER_TEXT_CAP } from './limits.js';

type Subtitle = { start: string; dur: string; text: string };
type YoutubeReaderDeps = {
  /** Fetch implementation used for YouTube's requests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  fetchSubtitles?: (input: { videoID: string; lang: string }) => Promise<Subtitle[]>;
  fetchDetails?: (input: { videoID: string; lang: string }) => Promise<{ title?: string; description?: string }>;
};

function extractVideoId(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') {
    return parsed.pathname.split('/').filter(Boolean)[0];
  }
  if (host === 'youtube.com') {
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v') ?? undefined;
    const [prefix, id] = parsed.pathname.split('/').filter(Boolean);
    if ((prefix === 'shorts' || prefix === 'live' || prefix === 'embed') && id) return id;
  }
  return undefined;
}

export function createYoutubeReader({
  fetchImpl = fetch,
  fetchSubtitles,
  fetchDetails
}: YoutubeReaderDeps = {}): SpecialContentReader {
  // Route YouTube's caption/metadata requests through the configured fetch
  // client (e.g. the proxy) unless an explicit override is provided.
  const doFetchSubtitles =
    fetchSubtitles ?? ((input: { videoID: string; lang: string }) => getSubtitles({ ...input, fetch: fetchImpl }));
  const doFetchDetails =
    fetchDetails ??
    ((input: { videoID: string; lang: string }) =>
      getVideoDetails({ ...input, fetch: fetchImpl }).then((details) => ({
        title: details.title,
        description: details.description
      })));

  return {
    name: 'youtube',
    canHandle(url: string): boolean {
      return extractVideoId(url) !== undefined;
    },
    async read(url: string): Promise<WebFetchResponse> {
      const videoID = extractVideoId(url);
      if (!videoID) {
        return {
          status: 'error',
          url,
          metadata: { method: 'youtube', cacheHit: false },
          error: { code: 'YOUTUBE_READ_FAILED', message: 'Could not extract a video id.' }
        };
      }
      try {
        const [subtitles, details] = await Promise.all([
          doFetchSubtitles({ videoID, lang: 'en' }),
          doFetchDetails({ videoID, lang: 'en' }).catch(() => ({ title: undefined }))
        ]);

        if (!subtitles || subtitles.length === 0) {
          return {
            status: 'unsupported',
            url,
            metadata: { method: 'youtube', cacheHit: false },
            error: { code: 'YOUTUBE_NO_CAPTIONS', message: 'No captions available for this video.' }
          };
        }

        const transcript = subtitles.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
        return {
          status: 'ok',
          url,
          content: { title: details.title ?? `YouTube ${videoID}`, text: transcript.slice(0, READER_TEXT_CAP) },
          metadata: { method: 'youtube', cacheHit: false, truncated: transcript.length >= READER_TEXT_CAP }
        };
      } catch (err) {
        return {
          status: 'error',
          url,
          metadata: { method: 'youtube', cacheHit: false },
          error: { code: 'YOUTUBE_READ_FAILED', message: err instanceof Error ? err.message : 'YouTube read failed.' }
        };
      }
    }
  };
}
