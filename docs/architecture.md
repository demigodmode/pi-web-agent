# Architecture

The code is split into small modules on purpose.

That is partly for code health, but mostly because this package gets worse fast if search, fetch, browser rendering, and research synthesis all blur together.

## Main boundaries

- `src/extension.ts` wires the package into Pi and registers the public `web_explore` tool
- `src/tools/` contains tool adapters and internal tool-shaped helpers
- `src/search/` holds search backend logic
- `src/fetch/` handles HTTP and headless fetch logic
- `src/extract/` handles readable-content extraction
- `src/orchestration/` handles the bounded research flow
- `src/cache/` holds small cache helpers
- `src/types.ts` defines shared contracts

## Public surface vs internals

The public model-facing web research surface is `web_explore`.

The lower-level capabilities still exist in code, but they are internal steps now:

- search is for discovery
- HTTP fetch is for plain page reads
- headless fetch is for selected browser-rendered reads
- orchestration decides when enough evidence exists

Keeping those responsibilities separate still matters. It lets the package show provenance like `[web_fetch]` or `[web_fetch_headless]` in preview/verbose output without forcing the outer model to manually chain those steps.

## Why the split exists

A search result should not be treated as a page read.

A weak HTTP extraction should not be treated as reliable evidence.

A bot-check page should not become a source.

And if more evidence is needed, the model should call `web_explore` again with a narrower query instead of dropping into shell commands or raw HTTP calls.

Those boundaries make failures easier to understand and make it harder for the package to lie by accident.
