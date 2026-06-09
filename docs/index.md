# pi-web-agent

`@demigodmode/pi-web-agent` is a Pi package for web research.

Most agent web tooling turns search, fetch, browser rendering, and synthesis into one blurry thing. This package keeps the model-facing surface simple instead: use `web_explore` for web research, and let it handle the lower-level work internally.

That lower-level work still matters. A search result is not the same as a page read. A plain HTTP read is not the same as rendering a page in a browser. But those are implementation details now, not separate tools the model has to juggle in normal use.

## The contract

`web_explore` is the public research entrypoint.

Internally it can:

- read direct HTTP/HTTPS links from the prompt
- search for candidate sources
- fetch pages over HTTP
- escalate selected pages to headless rendering
- prefer forum/thread sources when the query asks for discussions
- rank official sources above weaker sources
- include community sources as practical context
- evaluate source quality, diversity, bot-checks, unreadable threads, and possible conflicts
- stop with a specific caveat when the evidence is thin or uneven

In `preview` or `verbose` mode, you can still see which internal reader produced each finding, for example `[web_fetch]` or `[web_fetch_headless]`. That gives you transparency without exposing a bunch of low-level public tools.

## What you get right now

This project is still early, but it is usable.

Right now it gives you:

- one public web research tool: `web_explore`
- compact-by-default transcript output
- preview/verbose modes that show internal research provenance
- a `/web-agent` settings UI for presentation and backend config
- direct-link and forum/thread-aware research handling
- local-browser headless rendering with managed Chromium fallback
- bounded research behavior that is willing to say when evidence was weak, narrow, blocked, or cautionary

## Start here

- If you want to try it quickly, start with [Getting started](/getting-started).
- If you want the install details, go to [Install](/install).
- If you want to understand the tool behavior first, go to [Tools](/tools).
- If you want to change transcript output or backend config, go to [Presentation and settings](/presentation).
- If you want to work on the repo, go to [Development](/development).
