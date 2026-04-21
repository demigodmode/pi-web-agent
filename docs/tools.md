# Tools

The package works because the tools do not all pretend to do the same job.

That might sound small, but it is most of the reason this package exists.

## `web_search`

Use it when you want discovery:

- links
- titles
- snippets
- a first pass at what sources exist

What it should not do is imply that a page was actually read.

If all you have is search output, then all you have is search output.

## `web_fetch`

Use it when you want to read one page over plain HTTP.

This is the direct path for straightforward page reads.

What it should not do is quietly switch into browser mode just because the target page is awkward.

If the page looks too thin, too blocked, or too JS-heavy to trust, it should return `needs_headless` instead of bluffing.

That is a feature, not a failure.

## `web_fetch_headless`

Use it when browser rendering is explicitly needed.

That might be because the page is client-rendered, because the plain HTTP result was too weak, or because you already know the target is browser-first.

What it should not do is act like a hidden fallback behind normal HTTP fetches.

If a browser gets launched, it should be because you asked for the browser path.

## `web_explore`

Use it for broader web research where the job is to gather and compare sources with a bounded search and fetch pass.

This is the higher-level path when you are asking a research question, not just requesting one search or one page read.

What it should not do is turn into endless low-level tool churn after a decent answer already exists.

That tighter behavior is intentional.

## Which one should you reach for?

A quick rule of thumb:

- if you want links and snippets, use `web_search`
- if you want one page over HTTP, use `web_fetch`
- if you want a browser-rendered page, use `web_fetch_headless`
- if you want a bounded research workflow, use `web_explore`
