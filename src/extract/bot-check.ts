const BOT_CHECK_RE = /performing security verification|security service|verify you are not a bot|just a moment|checking your browser/i;

export function hasBotCheckContent(source: string, format: 'html' | 'markdown' | 'text' = 'text'): boolean {
  const visibleSource = format === 'html'
    ? source
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
    : source;
  return BOT_CHECK_RE.test(visibleSource);
}
