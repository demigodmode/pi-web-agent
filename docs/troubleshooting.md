# Troubleshooting

## `web_fetch` returned `needs_headless`

That usually means the plain HTTP read was not strong enough to trust.

This is not the package refusing to work. It is the package refusing to pretend a weak read was good enough.

If the page is heavily client-rendered or the extracted content is too thin, `web_fetch_headless` is probably the better next step.

## The page looked thin or partial

That can happen when:

- the page is mostly client-rendered
- the readable content is blocked or minimal over HTTP
- the page shell is easier to fetch than the real content

Again, this is exactly where a clean `needs_headless` result is more useful than fake certainty.

## `/web-agent` did something unexpected

`/web-agent` opens the settings UI.

If you just want to inspect the currently effective config instead, use:

```text
/web-agent show
```

If the current behavior does not match what you expected, check both config scopes:

- global: `~/.pi/agent/extensions/pi-web-agent/config.json`
- project: `.pi/extensions/pi-web-agent/config.json`

Project config overrides global config.

## Pi seems to be loading the wrong copy

If you use both the published package and the local repo-based extension, double-check which one Pi actually loaded.

This is an easy way to waste time debugging the wrong thing.

A quick sanity check is to make a tiny local change, reload Pi, and see whether the behavior changes with it.

## A search result was not the same as a page read

That is intentional.

`web_search` is discovery only. If you want page content, use `web_fetch` or `web_fetch_headless`.

## Headless fetch did not help as much as expected

Sometimes the browser path gets you a better page, and sometimes it mostly gets you a better shell with a lot of noise around it.

Busy homepages and app-like sites can still be messy even after rendering. The goal is better signal, not miracles.
