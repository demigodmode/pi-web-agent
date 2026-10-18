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

- GitHub: files come from the raw endpoint, issues and PRs come from the API with their comments, and a repo that turns up in search gives you the README plus a top-level file listing. Public content is keyless. Private content needs `GITHUB_TOKEN` or `gh auth login`. A repo link you type yourself is handled differently, see below.
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
- Limits: a question can contain up to eight direct query links, including at most three repo reads. Further links are reported as `Source limit reached; use a follow-up call for this URL.`
- If a repo can't be read (too big, private without access, `git` missing, clone timed out), its required-source failure stays in the result. Later query links can still be read, but the failed repo is never replaced with its README.
- Private repos work if you're signed in with the GitHub CLI (`gh auth login`) or have `GITHUB_TOKEN` set. The token is sent as an HTTP header, never on the command line.
- It needs `git` 2.32 or newer. `/web-agent doctor` shows a `repo research:` line with your git version and where the GitHub token comes from.
- Repo links that only turn up in search results still get the lighter README reader.
- The search walks at most 20,000 files, 64MB, or 10 seconds. If it hits one of those, the answer says it searched only the first N files and suggests a `/tree/` folder link.
- If GitHub's rate limit is hit, the answer says so and suggests `GITHUB_TOKEN` or `gh auth login`. A repo that doesn't exist, or that your token can't see, gets a "wasn't found" refusal.

## Cancelling and timeouts

Esc on a running `web_explore` stops searches, page fetches, repo clones, and the headless browser. Nothing retries or falls back after a cancel.

Reads that could otherwise hang have timeouts. Page fetches and the GitHub and YouTube readers give up after 15 seconds, PDFs after 60, and Firecrawl scrapes after 45. A page that times out, drops the connection, refuses the port, fails DNS or TLS, or loops on redirects counts as a failed read of that one page. The run moves on to the other sources.

## What Pi shows while a call runs

Every call starts with the same heading. Pi provides the outer shell and `⎿`
marker shown in these examples; the extension only renders the heading and
result content.

```text
web_explore ("Vitest coverage configuration")
  ⎿ Searching: site:vitest.dev coverage providers
```

One activity line is replaced as the work moves between search and reads. It
shows safe, short activity only, never page text or raw provider errors.

For a completed research result with execution-time statistics, all modes begin
with actual counts. Input-validation errors, such as an empty query, have no
research summary:

```text
web_explore ("Vitest coverage configuration")
  ⎿ 3 searches · 4 pages read · 8s
```

`searches` is the number of logical searches that started. Provider fanout or
fallback for one query still counts once. `pages read` is the number of
distinct, successful readable documents, including direct links and successful
repository research. Retries and redirects for the same document count once.

Compact keeps only that summary and required-source notices or a concise
limitation. Preview adds at most three plain findings and deliberately leaves
out reader labels, source lists, and retrieval detail. Verbose adds executed
queries, all findings, sources, evidence, caveats, backend attempts, and a
successful-read breakdown by HTTP, Browser, Firecrawl, GitHub, PDF, YouTube,
and Repository. Repository research is separate from the GitHub reader.

Required-source notices appear before findings in every mode. They give the
requested URL, the reason it could not be read, and say that its requirements
were not checked. The model receives the complete findings, evidence,
citations, caveats, and these notices unchanged across compact, preview, and
verbose modes. Expanding a result opens the verbose view; saved results keep
the mode selected when they ran, and older saved results use a legacy fallback.

The visible mode changes terminal presentation only. It does not create extra
public tools or change the research workflow.

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

If you need another angle, call `web_explore` again with a better query.
