/** Repo research limits (#72, #70). Constants on purpose, not settings. */
export const REPO_MAX_SIZE_MB = 300;
export const REPO_CLONE_TIMEOUT_MS = 60_000;
export const REPO_META_TIMEOUT_MS = 15_000;
/** Cap on clones kept around idle between questions; clones in use are bounded by REPO_MAX_SIZE_MB instead. */
export const REPO_IDLE_CACHE_MAX_BYTES = 1024 ** 3;
export const REPO_MAX_FILES = 4;
export const REPO_MAX_TYPED_REPOS = 2;
export const REPO_CLOSE_GRACE_MS = 10_000;
/** `gh auth token` only reads local state; a wedged gh must not hold up a run. */
export const GH_TOKEN_TIMEOUT_MS = 5_000;
/** GIT_CONFIG_GLOBAL, which keeps the user's own git config out, arrived in git 2.32. */
export const MIN_GIT_VERSION = { major: 2, minor: 32 } as const;
