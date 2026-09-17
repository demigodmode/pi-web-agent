# Architecture

The code is split into small modules on purpose.

That is partly for code health, but mostly because this package gets worse fast if search, fetch, browser rendering, and research synthesis all blur together.

## Main boundaries

- `src/extension.ts` wires the package into Pi and registers the public `web_explore` tool
- `src/tools/` contains tool adapters and internal tool-shaped helpers
- `src/search/` holds search backend logic for DuckDuckGo, SearXNG, Brave, You.com, Exa, and Tavily
- `src/readers/` handles special-content URLs (GitHub, PDF, YouTube) in front of the plain fetcher
- `src/fetch/` handles HTTP and headless fetch logic, including the network guard and the local guard proxy that every model-chosen connection goes through
- `src/backends/` holds backend config, the factory that wires providers together, provider failure classification, and the fallback policy (cooldowns, one retry, when to fall back)
- `src/extract/` handles readable-content extraction
- `src/orchestration/` handles the bounded research flow
- `src/cache/` holds small cache helpers
- `src/types.ts` defines shared contracts

## Public surface vs internals

The public model-facing web research surface is `web_explore`.

The lower-level capabilities still exist in code, but they are internal steps now:

- search is for discovery, whether it comes from DuckDuckGo, SearXNG, Brave, You.com, Exa, or Tavily
- special-content readers handle GitHub, PDF, and YouTube URLs before the plain fetcher sees them
- HTTP fetch is for plain page reads
- headless fetch is for selected browser-rendered reads
- orchestration decides when enough evidence exists and when source-quality concerns need another pass or a caveat

Keeping those responsibilities separate still matters. It lets the package show provenance like `[web_fetch]`, `[web_fetch_headless]`, `[github]`, `[pdf]`, or `[youtube]` in preview/verbose output without forcing the outer model to manually chain those steps.

## Special-content readers

A GitHub, PDF, or YouTube link handled as a generic web page is mostly useless: you get the GitHub chrome instead of the code, nothing out of a PDF, and a player shell instead of what the video says. So those URLs get their own readers.

A resolver sits in front of the fetcher (wired in `src/backends/factory.ts`). For each URL it asks the readers whether they handle it; the first match reads it and everything else falls through to the normal HTTP → headless path. PDFs served without a `.pdf` extension are also caught after the fetch, by content type.

Each reader returns the same shape as a normal fetch, so ranking, evidence, and presentation downstream don't know or care where the text came from. They're keyless: GitHub uses the raw/API endpoints (`GITHUB_TOKEN` just raises the rate limit), PDFs go through unpdf, YouTube pulls the caption track. When a reader can't get anything useful (a scanned PDF with no text layer, a video with no captions), it returns a caveat instead of throwing, and the research loop treats it like any other weak read.

## Why the split exists

A search result should not be treated as a page read.

A weak HTTP extraction should not be treated as reliable evidence.

A bot-check page should not become a source.

A same-host or community-only source set should not get treated like broad corroboration.

And if more evidence is needed, the model should call `web_explore` again with a narrower query instead of dropping into shell commands or raw HTTP calls.

Those boundaries make failures easier to understand and make it harder for the package to lie by accident.
