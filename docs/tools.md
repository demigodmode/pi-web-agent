# Tools

The public tool surface is intentionally small now.

## `web_explore`

Use `web_explore` for web research questions:

- current docs lookups
- comparing sources
- checking discussions or issues
- getting a recommendation with citations
- finding practical context around a library or API

It runs a bounded research workflow instead of making the model manually chain separate search/fetch/browser tools.

Internally, `web_explore` can do a few things:

- plan search queries
- run web search
- pick candidate pages
- read pages over HTTP
- escalate selected pages to headless rendering
- rank evidence
- synthesize findings and caveats

The important bit: those internal steps are not separate public tools for normal model use. If more web evidence is needed, the model should call `web_explore` again with a narrower query.

## What preview and verbose show

In compact mode, `web_explore` keeps the transcript short:

```text
Reviewed 3 sources · synthesized answer with 3 findings
```

In preview or verbose mode, findings include where the evidence came from internally:

```text
- [web_fetch] Official docs say ...
- [web_fetch_headless] Rendered docs show ...

Internal research: web_search ×2, web_fetch ×5, web_fetch_headless ×1
```

That is meant to be transparent, not an invitation to call those internal steps directly.

## When evidence is weak

Sometimes a research pass finds nothing useful. In that case the output says:

```text
No usable evidence found.
```

That is expected. Web pages can be thin, blocked, duplicated, or irrelevant. A follow-up `web_explore` call with a more specific query is usually the right next move.

## A practical rule

If the task is web research, use `web_explore`.

If you need another angle, call `web_explore` again with a better query. Do not switch to shell network commands like `curl`, `Invoke-WebRequest`, or `npm view` just to continue web research.
