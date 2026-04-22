# pi-web-agent

`@demigodmode/pi-web-agent` is a Pi package for web access that tries to stay honest about what it actually did.

The whole project is built around a simple rule: searching for a page is not the same thing as reading it, and reading it over plain HTTP is not the same thing as rendering it in a browser.

That sounds obvious, but agent web tooling gets fuzzy right there all the time. Search snippets get treated like page reads. Browser fallback happens quietly. Thin or blocked reads get softened into fake confidence.

This package is trying to do the opposite.

## The contract

- `web_search` is for discovery
- `web_fetch` is for plain HTTP reads
- `web_fetch_headless` is the explicit browser path
- `web_explore` is the bounded research path

Those boundaries are the point.

They make failures easier to reason about, and they make it harder for the tooling to quietly do something different from what you asked for.

## What you get right now

This project is still early, but it is usable.

Right now it gives you:

- search results that stay search results
- plain HTTP fetch that can say "this isn't reliable enough"
- explicit headless fetch when a browser is actually needed
- a higher-level research tool that is meant to stop after a bounded pass instead of wandering forever
- compact-by-default transcript output with user-facing presentation settings

## Start here

- If you want to try it quickly, start with [Getting started](/getting-started).
- If you want the install details, go to [Install](/install).
- If you want to understand the tool behavior first, go to [Tools](/tools).
- If you want to change transcript output and config, go to [Presentation and settings](/presentation).
- If you want to work on the repo, go to [Development](/development).
