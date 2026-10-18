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

Preview shows up to three plain findings. Verbose also shows sources, evidence,
and how each source was read, such as `[HTTP]`, `[Browser]`, or a special-content
reader like `[GitHub]`, `[PDF]`, or `[YouTube]`.

## What you get right now

This project is still early, but it is usable.

Right now it gives you:

- one public web research tool: `web_explore`
- compact-by-default transcript output
- preview mode with up to three plain findings, plus verbose provenance and retrieval detail
- a `/web-agent` settings UI for presentation and backend config
- direct-link and forum/thread-aware research handling
- keyless public GitHub content plus PDF and YouTube readers that pull the real content behind those links
- questions about a pasted GitHub repo answered from a clone of its code, with commit-pinned citations
- Esc cancels a running research pass, and one page failing to load doesn't fail the run
- local-browser headless rendering with managed Chromium fallback
- optional hosted discovery through Brave, You.com, Exa, Tavily, or a Google SERP endpoint without changing the public `web_explore` tool
- bounded research behavior that is willing to say when evidence was weak, narrow, blocked, or cautionary

## Start here

- If you want to try it quickly, start with [Getting started](/getting-started).
- If you want the install details, go to [Install](/install).
- If you want to understand the tool behavior first, go to [Tools](/tools).
- If you want to change transcript output or backend config, go to [Presentation and settings](/presentation).
- If you want to work on the repo, go to [Development](/development).
