import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Works around two incompatibilities between pi's extension loader (a patched
 * jiti) and jsdom's dependency tree:
 *
 *   1. jiti can't resolve the trailing-slash bare specifier require("punycode/")
 *      used by tr46.
 *   2. jiti wraps `module.exports = new Set(...)` (cssstyle) in a Proxy, which
 *      breaks native Set methods on the exported value.
 *
 * Both files live in the shared `~/.pi/agent/npm/node_modules` tree, so
 * installing or updating any *other* pi extension re-extracts them and reverts
 * the patch. A postinstall hook alone therefore can't keep this healthy, which
 * is why `ensureJitiCompat()` also runs on extension load, before jsdom is
 * evaluated. See https://github.com/demigodmode/pi-web-agent/issues/34.
 *
 * scripts/patch-jiti-compat.mjs duplicates this logic for the postinstall
 * hook. That hook runs before `npm run build`, so it cannot import dist/.
 * Keep the two in sync.
 */

const requireFromHere = createRequire(import.meta.url);

/**
 * Filesystem/resolver seam so tests can point this at a throwaway directory
 * instead of the real `node_modules/tr46` and `node_modules/cssstyle`. All
 * production call sites use the defaults (real `fs` + real module
 * resolution) and never pass this in.
 */
export type JitiCompatDeps = {
  /**
   * Resolve `specifier` as `fromFile` would. Omitting `fromFile` resolves from
   * this module, which is only correct when nothing else claims the package.
   */
  resolve: (specifier: string, fromFile?: string) => string;
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  writeFileSync: (path: string, contents: string) => void;
};

/**
 * Write via a temp file + rename rather than in place. Two reasons, both of
 * which bite harder now that this runs on every extension load instead of once
 * per install:
 *
 *   - `writeFileSync` truncates first. A crash, a full disk, or an OOM kill
 *     mid-write leaves a half-written file that still contains the marker
 *     comment, so every later run would skip it as "already patched" and the
 *     doctor would report a broken tree as healthy.
 *   - Another Pi session can be `require`-ing the same file while we write it.
 *     `rename` is atomic within a filesystem, so readers see the old file or
 *     the new one, never a partial one.
 *
 * The rename also breaks a pnpm-style hardlink instead of writing through it
 * into the shared content-addressable store.
 */
function writeFileAtomic(path: string, contents: string): void {
  const temp = `${path}.pi-web-agent-${process.pid}.tmp`;
  try {
    writeFileSync(temp, contents);
    renameSync(temp, path);
  } catch (err) {
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      // Best effort. Leaving a stray temp file is better than masking the
      // original write failure.
    }
    throw err;
  }
}

const defaultDeps: JitiCompatDeps = {
  resolve: (specifier, fromFile) =>
    (fromFile ? createRequire(fromFile) : requireFromHere).resolve(specifier),
  existsSync,
  readFileSync: (path) => readFileSync(path, 'utf8'),
  writeFileSync: writeFileAtomic
};

const SET_SHIM_MARKER = 'pi/jiti workaround';

const SET_SHIM = `
// ${SET_SHIM_MARKER}: expose bound native Set methods as own properties so a
// Proxy wrapper around this export does not break Set brand checks.
for (const k of ["has", "add", "delete", "forEach", "keys", "values", "entries"]) {
  module.exports[k] = Set.prototype[k].bind(module.exports);
}
module.exports[Symbol.iterator] = Set.prototype[Symbol.iterator].bind(module.exports);
`;

const PUNYCODE_SPECIFIER = 'require("punycode/")';
const PUNYCODE_REPLACEMENT = 'require("punycode/punycode.js")';

export type JitiCompatStatus = {
  /** Files that still need patching. Empty means the tree is healthy. */
  pending: string[];
  /** Files patched during this call. */
  patched: string[];
};

function findPackageRoot(deps: JitiCompatDeps, entryFile: string, packageName: string): string {
  let directory = dirname(entryFile);
  for (;;) {
    const manifestFile = join(directory, 'package.json');
    if (deps.existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(deps.readFileSync(manifestFile)) as { name?: string };
        if (manifest.name === packageName) return directory;
      } catch {
        // An unreadable or malformed package.json on the way up is not our
        // problem to report. Keep walking.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`could not find the ${packageName} package root from ${entryFile}`);
    }
    directory = parent;
  }
}

/**
 * Resolve the copies jsdom actually loads, not whichever copy happens to sit
 * highest in the tree.
 *
 * `~/.pi/agent/npm/node_modules` is shared by every pi extension, so version
 * conflicts routinely push a second copy of a package into a nested
 * `node_modules`. Resolving `cssstyle` or `tr46` from *this* module can then
 * find a hoisted copy that jsdom never requires: the patch lands on the wrong
 * file, the load still fails, and the doctor reports a healthy tree because it
 * checked the same wrong file. Walk the real import chain instead
 * (jsdom -> cssstyle, jsdom -> whatwg-url -> tr46) and only fall back to a
 * direct resolve when jsdom is not resolvable at all.
 */
function resolveFromJsdom(deps: JitiCompatDeps, specifier: string, via?: string): string {
  try {
    const jsdomEntry = deps.resolve('jsdom');
    const importer = via ? deps.resolve(via, jsdomEntry) : jsdomEntry;
    return deps.resolve(specifier, importer);
  } catch {
    // jsdom (or the intermediate package) is not resolvable from here, e.g. a
    // layout we do not recognize. Fall back to a plain resolve rather than
    // giving up on the patch entirely.
    return deps.resolve(specifier);
  }
}

function tr46Entry(deps: JitiCompatDeps): string {
  return resolveFromJsdom(deps, 'tr46', 'whatwg-url');
}

function cssstyleTargets(deps: JitiCompatDeps): { file: string; label: string }[] {
  const packageRoot = findPackageRoot(deps, resolveFromJsdom(deps, 'cssstyle'), 'cssstyle');
  return [
    join(packageRoot, 'lib', 'allExtraProperties.js'),
    join(packageRoot, 'lib', 'generated', 'allProperties.js'),
    join(packageRoot, 'lib', 'generated', 'implementedProperties.js')
  ].map((file) => ({
    file,
    label: `cssstyle/${relative(packageRoot, file).split(sep).join('/')}`
  }));
}

/**
 * Apply both patches if they are missing. Safe to call repeatedly: an already
 * patched tree is a few `readFileSync` calls and no writes. Never throws.
 */
export function ensureJitiCompat(deps: JitiCompatDeps = defaultDeps): JitiCompatStatus {
  const status: JitiCompatStatus = { pending: [], patched: [] };

  try {
    const file = tr46Entry(deps);
    const contents = deps.readFileSync(file);
    if (contents.includes(PUNYCODE_SPECIFIER)) {
      deps.writeFileSync(file, contents.replaceAll(PUNYCODE_SPECIFIER, PUNYCODE_REPLACEMENT));
      status.patched.push('tr46/index.js');
    }
  } catch {
    // A read-only install, a missing dependency, or a future dependency bump
    // that changes the shape. Report it rather than blocking extension load.
    status.pending.push('tr46/index.js');
  }

  try {
    for (const { file, label } of cssstyleTargets(deps)) {
      // Guard the read too: one unreadable file (EACCES, odd permissions) must
      // not abandon the other two, which may be perfectly writable.
      try {
        if (!deps.existsSync(file)) continue;
        const contents = deps.readFileSync(file);
        if (contents.includes(SET_SHIM_MARKER)) continue;
        if (!contents.includes('module.exports = new Set(')) continue;
        deps.writeFileSync(file, contents + SET_SHIM);
        status.patched.push(label);
      } catch {
        status.pending.push(label);
      }
    }
  } catch {
    status.pending.push('cssstyle');
  }

  return status;
}

/**
 * Read-only view of the same checks, for `/web-agent doctor`. Never throws and
 * never writes.
 */
export function checkJitiCompat(deps: JitiCompatDeps = defaultDeps): JitiCompatStatus {
  const status: JitiCompatStatus = { pending: [], patched: [] };

  try {
    const contents = deps.readFileSync(tr46Entry(deps));
    if (contents.includes(PUNYCODE_SPECIFIER)) status.pending.push('tr46/index.js');
  } catch {
    status.pending.push('tr46/index.js');
  }

  try {
    for (const { file, label } of cssstyleTargets(deps)) {
      try {
        if (!deps.existsSync(file)) continue;
        const contents = deps.readFileSync(file);
        if (contents.includes(SET_SHIM_MARKER)) continue;
        if (contents.includes('module.exports = new Set(')) status.pending.push(label);
      } catch {
        status.pending.push(label);
      }
    }
  } catch {
    status.pending.push('cssstyle');
  }

  return status;
}
