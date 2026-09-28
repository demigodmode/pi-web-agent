import { describe, it, expect, vi } from 'vitest';
import { createPdfReader } from '../../src/readers/pdf-reader.js';

function pdfResponse(bytes = new Uint8Array([1, 2, 3])) {
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer, headers: new Headers({ 'content-type': 'application/pdf' }) };
}

describe('createPdfReader', () => {
  it('handles .pdf urls and application/pdf content type', () => {
    const reader = createPdfReader({ fetchImpl: vi.fn(), extractPdfText: vi.fn() });
    expect(reader.canHandle('https://h/doc.pdf')).toBe(true);
    expect(reader.canHandle('https://h/doc.pdf?x=1')).toBe(true);
    expect(reader.canHandle('https://h/page')).toBe(false);
    expect(reader.canHandleContentType?.('application/pdf')).toBe(true);
    expect(reader.canHandleContentType?.('text/html')).toBe(false);
  });

  it('extracts pdf text and caps it', async () => {
    const reader = createPdfReader({
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      extractPdfText: vi.fn().mockResolvedValue({ text: 'Hello from the PDF.' })
    });
    const res = await reader.read('https://h/doc.pdf');
    expect(res.status).toBe('ok');
    expect(res.metadata.method).toBe('pdf');
    expect(res.content?.text).toBe('Hello from the PDF.');
  });

  it('uses filename fallback when no metadata title', async () => {
    const reader = createPdfReader({
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      extractPdfText: vi.fn().mockResolvedValue({ text: 'Hello from the PDF.' })
    });
    const res = await reader.read('https://h/doc.pdf?v=2');
    expect(res.status).toBe('ok');
    expect(res.content?.title).toBe('doc.pdf');
  });

  it('uses metadata title when provided', async () => {
    const reader = createPdfReader({
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      extractPdfText: vi.fn().mockResolvedValue({ text: 'Body', title: 'Real Title' })
    });
    const res = await reader.read('https://h/something.pdf');
    expect(res.status).toBe('ok');
    expect(res.content?.title).toBe('Real Title');
  });

  it('caveats a scanned pdf with no text layer', async () => {
    const reader = createPdfReader({
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      extractPdfText: vi.fn().mockResolvedValue({ text: '   ' })
    });
    const res = await reader.read('https://h/scan.pdf');
    expect(res.status).toBe('unsupported');
    expect(res.error?.code).toBe('PDF_NO_TEXT');
  });

  it('returns an error response when extraction throws', async () => {
    const reader = createPdfReader({
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      extractPdfText: vi.fn().mockRejectedValue(new Error('corrupt'))
    });
    const res = await reader.read('https://h/bad.pdf');
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('PDF_READ_FAILED');
  });

  it('returns text longer than the old 4000-char cap', async () => {
    const long = 'x'.repeat(10000);
    const reader = createPdfReader({
      fetchImpl: vi.fn().mockResolvedValue(pdfResponse()),
      extractPdfText: vi.fn().mockResolvedValue({ text: long, title: undefined })
    });
    const res = await reader.read('https://h/big.pdf');
    expect(res.status).toBe('ok');
    expect(res.content?.text.length).toBe(10000);
    expect(res.metadata.truncated).toBe(false);
  });
});

describe('pdf reader cancellation', () => {
  it('gives the download a signal tied to the caller', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const controller = new AbortController();
    await createPdfReader({ fetchImpl: fetchImpl as unknown as typeof fetch }).read('https://example.com/a.pdf', controller.signal);
    const signal = (fetchImpl.mock.calls[0][1] as RequestInit).signal!;
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});
