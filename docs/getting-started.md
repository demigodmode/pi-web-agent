# Getting started

If you just want to try the package in Pi, this is the short version.

## Install it

```bash
pi install npm:@demigodmode/pi-web-agent
```

If Pi is already running, reload or restart it so the package gets picked up.

## What you get

The package exposes one public web research tool:

- `web_explore`

Use it when you want Pi to find and compare current web sources.

`web_explore` handles the annoying parts internally: search, HTTP reads, targeted headless rendering, source ranking, and caveats when the evidence is not strong enough.

## Try a prompt

> Find current docs and discussions about configuring Vitest coverage in TypeScript projects.

Pi should call `web_explore` and return a compact research result. If you need more detail inline, switch presentation mode to `preview` or `verbose`.

Another example:

> Find two or three current sources on DuckDuckGo HTML scraping in Node.js and tell me what the common parsing pitfalls are.

That should still go through `web_explore`. If the first pass is thin, Pi can call `web_explore` again with a narrower query instead of dropping into shell commands or raw HTTP calls.

## Presentation defaults

The package renders web research output in `compact` mode by default.

If you want to change that, open the settings UI with:

```text
/web-agent
```

That lets you change the default presentation mode and the `web_explore` override without editing JSON by hand.

If you want the full details, see [Presentation and settings](/presentation).

## One thing to keep in mind

If the package says no usable evidence was found, or adds a caveat, that is intentional. It is better to admit the research pass was thin than to turn weak pages or bot-check screens into fake confidence.
