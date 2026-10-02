import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import type { WebFetchResponse } from '../types.js';
import type { SpecialContentReader } from './types.js';
import { READER_TEXT_CAP } from './limits.js';
import { PDF_FETCH_TIMEOUT_MS, requestSignal } from '../abort.js';

type PdfReaderDeps = {
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to unpdf. */
  extractPdfText?: (bytes: Uint8Array) => Promise<{ text: string; title?: string }>;
};

async function defaultExtract(bytes: Uint8Array): Promise<{ text: string; title?: string }> {
  const pdf = await getDocumentProxy(bytes);
  const [{ text }, meta] = await Promise.all([
    extractText(pdf, { mergePages: true }),
    getMeta(pdf).catch(() => ({ info: undefined }))
  ]);
  const info = (meta as { info?: { Title?: string } }).info;
  const rawTitle = info?.Title?.trim();
  return { text, title: rawTitle ? rawTitle : undefined };
}

function isPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'PDF';
    return decodeURIComponent(last);
  } catch {
    return 'PDF';
  }
}

export function createPdfReader({ fetchImpl = fetch, extractPdfText = defaultExtract }: PdfReaderDeps = {}): SpecialContentReader {
  return {
    name: 'pdf',
    canHandle: isPdfUrl,
    canHandleContentType(contentType: string): boolean {
      return contentType.toLowerCase().includes('application/pdf');
    },
    async read(url: string, signal?: AbortSignal): Promise<WebFetchResponse> {
      try {
        const response = await fetchImpl(url, { signal: requestSignal(signal, PDF_FETCH_TIMEOUT_MS) });
        if (!('ok' in response) || !response.ok) {
          return {
            status: 'error',
            url,
            metadata: { method: 'pdf', cacheHit: false },
            error: { code: 'PDF_READ_FAILED', message: `Fetching the PDF failed.` }
          };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const extracted = await extractPdfText(bytes);
        const text = extracted.text.trim();

        if (text.length === 0) {
          return {
            status: 'unsupported',
            url,
            metadata: { method: 'pdf', cacheHit: false, contentType: 'application/pdf' },
            error: { code: 'PDF_NO_TEXT', message: 'This looks like a scanned PDF with no extractable text.' }
          };
        }

        return {
          status: 'ok',
          url,
          content: { title: extracted.title ?? filenameFromUrl(url), text: text.slice(0, READER_TEXT_CAP) },
          metadata: { method: 'pdf', cacheHit: false, contentType: 'application/pdf', truncated: text.length >= READER_TEXT_CAP }
        };
      } catch (err) {
        return {
          status: 'error',
          url,
          metadata: { method: 'pdf', cacheHit: false },
          error: { code: 'PDF_READ_FAILED', message: err instanceof Error ? err.message : 'PDF read failed.' }
        };
      }
    }
  };
}
