import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkJitiCompat, ensureJitiCompat, type JitiCompatDeps } from '../src/jiti-compat.js';

const TR46_ENTRY = '/fake/node_modules/tr46/index.js';
const CSSSTYLE_ENTRY = '/fake/node_modules/cssstyle/lib/CSSStyleDeclaration.js';
const CSSSTYLE_MANIFEST = '/fake/node_modules/cssstyle/package.json';
const CSSSTYLE_ALL_EXTRA = '/fake/node_modules/cssstyle/lib/allExtraProperties.js';
const CSSSTYLE_ALL_PROPS = '/fake/node_modules/cssstyle/lib/generated/allProperties.js';
const CSSSTYLE_IMPLEMENTED_PROPS = '/fake/node_modules/cssstyle/lib/generated/implementedProperties.js';

const UNPATCHED_TR46 = 'const punycode = require("punycode/");\nmodule.exports = punycode;\n';
const PATCHED_TR46 = 'const punycode = require("punycode/punycode.js");\nmodule.exports = punycode;\n';
const UNPATCHED_CSSSTYLE_SET = 'module.exports = new Set(["display", "color"]);\n';
const ALREADY_PATCHED_CSSSTYLE_SET = `${UNPATCHED_CSSSTYLE_SET}\n// pi/jiti workaround: already applied\n`;

/**
 * An in-memory stand-in for `JitiCompatDeps` so tests never touch the real
 * node_modules/tr46 or node_modules/cssstyle on disk. `writeFailures` lets a
 * test simulate a read-only install for a specific path, and `readFailures`
 * an existing-but-unreadable file (EACCES), which is a different path through
 * the patch loop than a missing one.
 */
function createFakeDeps(
  files: Record<string, string>,
  options: {
    writeFailures?: Set<string>;
    readFailures?: Set<string>;
    /** Keyed `"<specifier> from <importer>"`, for nested-dependency layouts. */
    resolutions?: Record<string, string>;
  } = {}
): { deps: JitiCompatDeps; files: Map<string, string> } {
  const store = new Map(Object.entries(files));
  const writeFailures = options.writeFailures ?? new Set<string>();
  const readFailures = options.readFailures ?? new Set<string>();

  const deps: JitiCompatDeps = {
    resolve: (specifier, fromFile) => {
      const resolved = options.resolutions?.[`${specifier} from ${fromFile ?? ''}`];
      if (resolved) return resolved;
      if (options.resolutions && (specifier === 'jsdom' || fromFile)) {
        throw new Error(`unresolvable: ${specifier} from ${fromFile ?? 'self'}`);
      }
      if (specifier === 'tr46') return TR46_ENTRY;
      if (specifier === 'cssstyle') return CSSSTYLE_ENTRY;
      throw new Error(`unexpected specifier: ${specifier}`);
    },
    existsSync: (path) => store.has(path),
    readFileSync: (path) => {
      if (readFailures.has(path)) throw new Error(`EACCES: permission denied, ${path}`);
      const contents = store.get(path);
      if (contents === undefined) throw new Error(`ENOENT: ${path}`);
      return contents;
    },
    writeFileSync: (path, contents) => {
      if (writeFailures.has(path)) throw new Error(`EROFS: read-only file system, ${path}`);
      store.set(path, contents);
    }
  };

  return { deps, files: store };
}

function baseFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [TR46_ENTRY]: UNPATCHED_TR46,
    [CSSSTYLE_MANIFEST]: JSON.stringify({ name: 'cssstyle', version: '4.6.0' }),
    [CSSSTYLE_ALL_EXTRA]: UNPATCHED_CSSSTYLE_SET,
    [CSSSTYLE_ALL_PROPS]: UNPATCHED_CSSSTYLE_SET,
    [CSSSTYLE_IMPLEMENTED_PROPS]: UNPATCHED_CSSSTYLE_SET,
    ...overrides
  };
}

describe('ensureJitiCompat', () => {
  it('patches an unpatched tr46 file and reports it in patched', () => {
    const { deps, files } = createFakeDeps(baseFiles());

    const status = ensureJitiCompat(deps);

    expect(status.patched).toContain('tr46/index.js');
    expect(status.pending).not.toContain('tr46/index.js');
    expect(files.get(TR46_ENTRY)).toBe(PATCHED_TR46);
  });

  it('is idempotent: an already patched tree writes nothing and reports no patched files', () => {
    const { deps, files } = createFakeDeps(
      baseFiles({
        [TR46_ENTRY]: PATCHED_TR46,
        [CSSSTYLE_ALL_EXTRA]: ALREADY_PATCHED_CSSSTYLE_SET,
        [CSSSTYLE_ALL_PROPS]: ALREADY_PATCHED_CSSSTYLE_SET,
        [CSSSTYLE_IMPLEMENTED_PROPS]: ALREADY_PATCHED_CSSSTYLE_SET
      })
    );
    const before = new Map(files);

    const status = ensureJitiCompat(deps);

    expect(status.patched).toEqual([]);
    expect(status.pending).toEqual([]);
    expect(files).toEqual(before);
  });

  it('appends the Set shim to a cssstyle file needing it and skips one already marked', () => {
    const { deps, files } = createFakeDeps(
      baseFiles({
        [TR46_ENTRY]: PATCHED_TR46,
        [CSSSTYLE_ALL_EXTRA]: ALREADY_PATCHED_CSSSTYLE_SET
      })
    );

    const status = ensureJitiCompat(deps);

    expect(status.patched).not.toContain('cssstyle/lib/allExtraProperties.js');
    expect(files.get(CSSSTYLE_ALL_EXTRA)).toBe(ALREADY_PATCHED_CSSSTYLE_SET);

    expect(status.patched).toContain('cssstyle/lib/generated/allProperties.js');
    expect(status.patched).toContain('cssstyle/lib/generated/implementedProperties.js');
    expect(files.get(CSSSTYLE_ALL_PROPS)).toContain('pi/jiti workaround');
    expect(files.get(CSSSTYLE_ALL_PROPS)).toContain(UNPATCHED_CSSSTYLE_SET.trim());
  });

  it('reports pending and does not throw when a target file cannot be written', () => {
    const { deps, files } = createFakeDeps(baseFiles(), {
      writeFailures: new Set([TR46_ENTRY, CSSSTYLE_ALL_PROPS])
    });

    let status;
    expect(() => {
      status = ensureJitiCompat(deps);
    }).not.toThrow();

    expect(status!.pending).toContain('tr46/index.js');
    expect(status!.pending).toContain('cssstyle/lib/generated/allProperties.js');
    expect(status!.patched).not.toContain('tr46/index.js');
    expect(status!.patched).not.toContain('cssstyle/lib/generated/allProperties.js');
    // The other cssstyle files aren't in the failure set, so they still get patched.
    expect(status!.patched).toContain('cssstyle/lib/generated/implementedProperties.js');
    // The failed write left the file untouched.
    expect(files.get(TR46_ENTRY)).toBe(UNPATCHED_TR46);
  });
  it('patches the nested copies jsdom actually loads, not the hoisted ones', () => {
    // A shared ~/.pi/agent/npm tree with a version conflict: the hoisted
    // cssstyle/tr46 are not the ones jsdom requires. Patching those would fix
    // nothing while the doctor reported a healthy tree.
    const JSDOM_ENTRY = '/fake/node_modules/jsdom/index.js';
    const WHATWG_ENTRY = '/fake/node_modules/jsdom/node_modules/whatwg-url/index.js';
    const NESTED_TR46 = '/fake/node_modules/jsdom/node_modules/whatwg-url/node_modules/tr46/index.js';
    const NESTED_CSSSTYLE_ENTRY = '/fake/node_modules/jsdom/node_modules/cssstyle/lib/CSSStyleDeclaration.js';
    const NESTED_ROOT = '/fake/node_modules/jsdom/node_modules/cssstyle';

    const { deps, files } = createFakeDeps(
      {
        // hoisted copies: must be left alone
        [TR46_ENTRY]: UNPATCHED_TR46,
        [CSSSTYLE_MANIFEST]: JSON.stringify({ name: 'cssstyle', version: '4.6.0' }),
        [CSSSTYLE_ALL_EXTRA]: UNPATCHED_CSSSTYLE_SET,
        [CSSSTYLE_ALL_PROPS]: UNPATCHED_CSSSTYLE_SET,
        [CSSSTYLE_IMPLEMENTED_PROPS]: UNPATCHED_CSSSTYLE_SET,
        // the copies jsdom resolves
        [NESTED_TR46]: UNPATCHED_TR46,
        [`${NESTED_ROOT}/package.json`]: JSON.stringify({ name: 'cssstyle', version: '5.0.0' }),
        [`${NESTED_ROOT}/lib/allExtraProperties.js`]: UNPATCHED_CSSSTYLE_SET,
        [`${NESTED_ROOT}/lib/generated/allProperties.js`]: UNPATCHED_CSSSTYLE_SET,
        [`${NESTED_ROOT}/lib/generated/implementedProperties.js`]: UNPATCHED_CSSSTYLE_SET
      },
      {
        resolutions: {
          'jsdom from ': JSDOM_ENTRY,
          [`whatwg-url from ${JSDOM_ENTRY}`]: WHATWG_ENTRY,
          [`tr46 from ${WHATWG_ENTRY}`]: NESTED_TR46,
          [`cssstyle from ${JSDOM_ENTRY}`]: NESTED_CSSSTYLE_ENTRY
        }
      }
    );

    const status = ensureJitiCompat(deps);

    expect(status.pending).toEqual([]);
    expect(files.get(NESTED_TR46)).toBe(PATCHED_TR46);
    expect(files.get(`${NESTED_ROOT}/lib/generated/allProperties.js`)).toContain('pi/jiti workaround');

    // the hoisted copies stay untouched
    expect(files.get(TR46_ENTRY)).toBe(UNPATCHED_TR46);
    expect(files.get(CSSSTYLE_ALL_PROPS)).toBe(UNPATCHED_CSSSTYLE_SET);

    // and the doctor agrees the tree is healthy for the right reason
    expect(checkJitiCompat(deps).pending).toEqual([]);
  });

  it('is idempotent against its own output: a second run writes nothing', () => {
    const { deps, files } = createFakeDeps(
      baseFiles({
        [TR46_ENTRY]: UNPATCHED_TR46,
        [CSSSTYLE_ALL_EXTRA]: UNPATCHED_CSSSTYLE_SET,
        [CSSSTYLE_ALL_PROPS]: UNPATCHED_CSSSTYLE_SET,
        [CSSSTYLE_IMPLEMENTED_PROPS]: UNPATCHED_CSSSTYLE_SET
      })
    );

    const first = ensureJitiCompat(deps);
    expect(first.patched.length).toBeGreaterThan(0);
    const afterFirst = new Map(files);

    // The real shim, not a hand-written marker: this is what proves the marker
    // the patch writes is the same one the next run looks for.
    const second = ensureJitiCompat(deps);

    expect(second.patched).toEqual([]);
    expect(second.pending).toEqual([]);
    expect(files).toEqual(afterFirst);
  });

  it('keeps patching the remaining cssstyle files when one of them is unreadable', () => {
    const { deps, files } = createFakeDeps(
      baseFiles({
        [TR46_ENTRY]: PATCHED_TR46,
        [CSSSTYLE_ALL_EXTRA]: UNPATCHED_CSSSTYLE_SET,
        [CSSSTYLE_ALL_PROPS]: UNPATCHED_CSSSTYLE_SET,
        [CSSSTYLE_IMPLEMENTED_PROPS]: UNPATCHED_CSSSTYLE_SET
      }),
      { readFailures: new Set([CSSSTYLE_ALL_EXTRA]) }
    );

    const status = ensureJitiCompat(deps);

    expect(status.pending).toEqual(['cssstyle/lib/allExtraProperties.js']);
    expect(status.patched).toEqual([
      'cssstyle/lib/generated/allProperties.js',
      'cssstyle/lib/generated/implementedProperties.js'
    ]);
    expect(files.get(CSSSTYLE_ALL_PROPS)).toContain('pi/jiti workaround');
    expect(files.get(CSSSTYLE_IMPLEMENTED_PROPS)).toContain('pi/jiti workaround');
  });
});

describe('checkJitiCompat', () => {
  it('never writes: a file needing the patch stays byte-identical and is reported as pending', () => {
    const { deps, files } = createFakeDeps(baseFiles());
    const before = new Map(files);

    const status = checkJitiCompat(deps);

    expect(status.pending).toContain('tr46/index.js');
    expect(status.pending).toContain('cssstyle/lib/allExtraProperties.js');
    expect(status.pending).toContain('cssstyle/lib/generated/allProperties.js');
    expect(status.pending).toContain('cssstyle/lib/generated/implementedProperties.js');
    expect(status.patched).toEqual([]);
    expect(files).toEqual(before);
  });

  it('reports an already patched tree as fully healthy without writing', () => {
    const { deps, files } = createFakeDeps(
      baseFiles({
        [TR46_ENTRY]: PATCHED_TR46,
        [CSSSTYLE_ALL_EXTRA]: ALREADY_PATCHED_CSSSTYLE_SET,
        [CSSSTYLE_ALL_PROPS]: ALREADY_PATCHED_CSSSTYLE_SET,
        [CSSSTYLE_IMPLEMENTED_PROPS]: ALREADY_PATCHED_CSSSTYLE_SET
      })
    );
    const before = new Map(files);

    const status = checkJitiCompat(deps);

    expect(status.pending).toEqual([]);
    expect(files).toEqual(before);
  });
});

/**
 * src/jiti-compat.ts and scripts/patch-jiti-compat.mjs deliberately duplicate
 * the patch logic, because postinstall runs before `npm run build` and so the
 * script cannot import dist/. A file patched by one is checked by the other,
 * so any drift between them is a live bug. The comments in both files say
 * "keep the two in sync"; this is what actually enforces it.
 */
describe('jiti compat patch parity between src and the postinstall script', () => {
  const src = readFileSync(new URL('../src/jiti-compat.ts', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../scripts/patch-jiti-compat.mjs', import.meta.url), 'utf8');

  function setShimBody(source: string): string {
    const match = source.match(/for \(const k of \[[^\]]*\]\) \{[\s\S]*?Symbol\.iterator\][^\n]*\n/);
    if (!match) throw new Error('could not find the Set shim body');
    return match[0];
  }

  it('applies the same Set shim', () => {
    expect(setShimBody(script)).toBe(setShimBody(src));
  });

  it('uses the same marker string', () => {
    expect(src).toContain("const SET_SHIM_MARKER = 'pi/jiti workaround';");
    expect(script).toContain('contents.includes("pi/jiti workaround")');
    expect(script).toContain('// pi/jiti workaround:');
  });

  it('uses the same punycode specifier and replacement', () => {
    expect(src).toContain('const PUNYCODE_SPECIFIER = \'require("punycode/")\';');
    expect(src).toContain('const PUNYCODE_REPLACEMENT = \'require("punycode/punycode.js")\';');
    expect(script).toContain('\'require("punycode/")\', \'require("punycode/punycode.js")\'');
  });

  it('targets the same three cssstyle files', () => {
    for (const target of ['allExtraProperties.js', 'allProperties.js', 'implementedProperties.js']) {
      expect(src).toContain(target);
      expect(script).toContain(target);
    }
  });
});
