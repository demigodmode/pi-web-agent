# Releases

## Normal release flow

1. on `develop`, update `CHANGELOG.md` under `## Unreleased`
2. run `npm run release:dry-run`
3. run `npm run release`, which commits and tags on `develop`
4. push `develop` and open a PR from `develop` into `main`, then merge it with a merge commit (not squash or rebase) so the tagged commit ends up on `main`
5. push the tag by name, for example `git push origin v1.8.0`
6. let the tag-push publish workflow create the GitHub release and publish to npm; the merge into `main` triggers the separate docs deployment
7. fast-forward `develop` to `main` (`git checkout develop && git merge --ff-only origin/main && git push origin develop`), so both branches point at the same commit again

The release merge leaves `main` one merge commit ahead of `develop`, with no file changes. Step 7 just moves `develop` up to it, so GitHub stops showing `main` as ahead and the next release starts from the same commit.

The publish workflow refuses a tag that isn't on `main`, so merge first and push the tag after. Feature PRs target `develop`; only release merges go to `main`.

The bump is inferred from what's under `## Unreleased`: a `### Breaking` entry makes it major, `### Added` makes it minor, otherwise it's a patch. `npm run release` moves the Unreleased notes into a dated version section, bumps `package.json`, commits, and tags. The tag is lightweight, so `git push --follow-tags` can skip it; push the tag by name.

On the tag push, the publish workflow runs two jobs. The first creates the GitHub release, pulling that version's notes out of `CHANGELOG.md` via `scripts/release-notes.mjs`. The second builds, tests, and publishes to npm with provenance.

## Manual publishing

The **Publish package** workflow also accepts a manual dispatch with an existing release tag in its `tag` input. The release job checks out that tag, verifies that the checkout matches its commit and that the commit is on `main`, then passes the validated commit to the publish job. The publish job builds that exact commit even if the dispatch came from another branch. Invalid or off-main tags fail before release creation.

Use this to retry a failed publication of an existing release. It does not create a new version or tag. The release job keeps an existing GitHub release; npm still rejects a version that has already been published.

## Trusted publishing

This repo uses npm Trusted Publishing from GitHub Actions.

That replaced the older `NPM_TOKEN` secret flow.

If the publish job fails with a transient Sigstore/Rekor provenance error, rerun the failed job before changing code. The package may have built and tested cleanly while the transparency-log request failed outside the repo.

## Docs publishing

The docs site publishes through GitHub Pages.

With Pages enabled for the repo, pushes to `main` (release merges) should rebuild and redeploy the docs automatically through the docs workflow.
