# Architecture

The code is split into small modules on purpose.

That is partly for code health, but mostly because this package gets worse fast if search, fetch, browser rendering, and research orchestration all blur together.

## Main boundaries

- `src/extension.ts` wires the package into Pi
- `src/tools/` contains thin Pi-facing tool adapters
- `src/search/` holds search backend logic
- `src/fetch/` handles HTTP and headless fetch logic
- `src/extract/` handles readable-content extraction
- `src/orchestration/` handles bounded research flow
- `src/cache/` holds small cache helpers
- `src/types.ts` defines shared contracts

## Why the split exists

`web_search` should stay about discovery.

`web_fetch` should stay about plain HTTP reads.

`web_fetch_headless` should stay explicit.

`web_explore` should stay the higher-level research path.

Once those responsibilities start leaking into each other, the package becomes harder to reason about and easier to lie with by accident.

Keeping the boundaries explicit makes failures easier to understand and makes it easier to change one part without quietly changing the meaning of another.
