export const codePoints = (text: string) => Array.from(text).length;

/** Clips source text without splitting a Unicode code point. */
export function clipCodePoints(text: string, chars: number): string {
  if (!Number.isFinite(chars) || chars <= 0) return '';
  return Array.from(text).slice(0, Math.floor(chars)).join('');
}

/**
 * The exact content representation used by allocation and model serialization.
 * Source headers, citation tags, notices and structural evidence labels are not
 * model-result content for the length policy.
 */
export function countResultContent(findings: string[], excerpts: string[], context: string[]): number {
  return codePoints([
    findings.join('\n\n'), excerpts.join('\n'), context.join('\n')
  ].filter(Boolean).join('\n\n'));
}
