/** Slice text without leaving a high surrogate at the end. */
export function safeSlice(text: string, end: number): string {
  const sliced = text.slice(0, Math.max(0, Math.min(end, text.length)));
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}
