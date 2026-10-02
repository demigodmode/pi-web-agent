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

- read HTTP/HTTPS links from the prompt before search
- strip common tracking params from direct links
- plan search queries
- run web search through the configured search backend: DuckDuckGo, SearXNG, Brave, You.com, Exa, Tavily, or Google SERP
- optionally fan search across multiple configured providers at once when fanout is enabled, dedupe and rerank the merged results
- read GitHub, PDF, and YouTube links through dedicated readers instead of scraping the page
- clone and search a GitHub repo when you paste a repo or folder link
- pick candidate pages
- prefer forum/thread sources when the query asks for discussions
- read pages over HTTP
- escalate selected pages to headless rendering
- keep explicit gaps for unreadable direct/thread sources
- rank evidence
- evaluate source quality and source diversity
- synthesize findings and caveats

The important bit: those internal steps are not separate public tools for normal model use. If more web evidence is needed, the model should call `web_explore` again with a narrower query.

## GitHub, PDF, and YouTube links

You don't do anything special for these. If a GitHub, PDF, or YouTube URL shows up, whether you pasted it or search surfaced it, `web_explore` reads the real content instead of the rendered page:

- GitHub: files come from the raw endpoint, issues and PRs come from the API with their comments, and a repo that turns up in search gives you the README plus a top-level file listing. It's keyless; set `GITHUB_TOKEN` in the environment if you want the higher API rate limit. A repo link you type yourself is handled differently, see below.
- PDF: the text is extracted directly. A scanned PDF with no text layer can't be read, so you get a note saying so rather than a silent empty result.
- YouTube: you get the transcript from the captions. A video with no captions gets the same kind of note.

These run behind `web_explore`, so there's still nothing extra to call. When you paste a link to one of these and ask to read or summarize it, you get the extracted content back: the transcript or PDF text or file/issue body (long content is capped around 24k characters), not a research digest.

## Asking about a GitHub repo

When you put a repo link in your question yourself (`https://github.com/owner/repo`, or a folder link like `https://github.com/owner/repo/tree/main/src/auth`), `web_explore` downloads that repo, searches the code for the words in your question, and answers from the files that match. Each excerpt comes with a link pinned to the exact commit it read, like `https://github.com/owner/repo/blob/<commit>/src/auth/refresh.ts#L40-L95`, so the link still points at the same code after the repo changes.

- Very large repos may be searched only partially; paste a tree or folder link to narrow the search to that directory.
- The search is plain keyword matching, with no model calls. Nearby terms rank higher. It skips vendored folders, lockfiles, source maps, snapshots, standalone SVGs, binaries, and files over 512KB. `dist`, `build`, `target`, and `out` are skipped only at the clone root or at the directory named by a tree or folder link.
- It prefers code over docs and tests. JSON, CSV, TSV, and extensionless project documents named `CHANGELOG`, `LICENSE`, `NOTICE`, `AUTHORS`, `COPYING`, or `CONTRIBUTING` rank lower, as do generated and minified files. It returns up to four files within the usual reader budget.
- The README is added when the search finds little (fewer than two files), and the folder listing when it finds nothing. A general question like "what is this repo?" therefore still gets the README.

- It fetches one exact commit at depth 1, over HTTPS only, and never runs anything from the repo. Folder links limit the folder listing to that folder. They use that folder's README when it has one, or the repository root README otherwise.
- Clones live for your Pi session in a private folder in your temp directory (`pi-web-agent-repos-<your-user-id>`), so follow-up questions about the same repo are instant. They're deleted when the session ends (quit, `/new`, `/resume`, `/fork`, reload), and anything left behind by a crash is cleaned up the next time Pi starts. Idle clones are capped at 1GB in total.
- Limits: repos over 300MB are refused, the clone gives up after 60 seconds, and at most two repo links per question.
- If the repo can't be read (too big, private without access, `git` missing, clone timed out), the answer says so and stops there. It doesn't fall back to the README, because that would look like an answer about the code without being one.
- Private repos work if you're signed in with the GitHub CLI (`gh auth login`) or have `GITHUB_TOKEN` set. The token is sent as an HTTP header, never on the command line.
- It needs `git` 2.32 or newer. `/web-agent doctor` shows a `repo research:` line with your git version and where the GitHub token comes from.
- Repo links that only turn up in search results still get the lighter README reader.
- The search walks at most 20,000 files, 64MB, or 10 seconds. If it hits one of those, the answer says it searched only the first N files and suggests a `/tree/` folder link.
- If GitHub's rate limit is hit, the answer says so and suggests `GITHUB_TOKEN` or `gh auth login`. A repo that doesn't exist, or that your token can't see, gets a "wasn't found" refusal.

## Cancelling and timeouts

Esc on a running `web_explore` stops searches, page fetches, repo clones, and the headless browser. Nothing retries or falls back after a cancel.

Reads that could otherwise hang have timeouts. Page fetches and the GitHub and YouTube readers give up after 15 seconds, PDFs after 60, and Firecrawl scrapes after 45. A page that times out, drops the connection, refuses the port, fails DNS or TLS, or loops on redirects counts as a failed read of that one page. The run moves on to the other sources.

## What preview and verbose show

In compact mode, `web_explore` keeps the transcript short:

```text
Reviewed 3 sources · synthesized answer with 3 findings
```

In preview or verbose mode, findings include where the evidence came from internally:

```text
- [web_fetch] Official docs say ...
- [web_fetch_headless] Rendered docs show ...
- [github] The README describes ...

Internal research: web_search ×2, web_fetch ×5, web_fetch_headless ×1
```

The label reflects which reader produced the finding, so you'll also see `[github]`, `[pdf]`, or `[youtube]` when one of those handled a link. When fanout is enabled, the research summary shows which providers were queried, for example `web_search ×2 (fanout: duckduckgo, brave, exa)`.

That is meant to be transparent, not an invitation to call those internal steps directly.

## When evidence is weak

Sometimes a research pass finds nothing useful. In that case the output says:

```text
No usable evidence found.
```

That is expected. Web pages can be thin, blocked, duplicated, or irrelevant. Forum/thread pages can also render bot checks or noisy app shells. A follow-up `web_explore` call with a more specific query is usually the right next move.

Partial answers may explain the specific quality problem, for example:

```text
Evidence is partial: one or more thread sources could not be read reliably, and the source set was narrow.
```

## A practical rule

If the task is web research, use `web_explore`.

If you need another angle, call `web_explore` again with a better query. Do not switch to shell network commands like `curl`, `Invoke-WebRequest`, or `npm view` just to continue web research.
