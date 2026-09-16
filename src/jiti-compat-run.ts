import { ensureJitiCompat } from './jiti-compat.js';

// Side-effect-only module. It exists so `extension.ts` can run the compat
// patch as its *first* import: ESM evaluates a module's dependency subtree,
// including that module's body, before moving on to the next import. A plain
// `ensureJitiCompat()` call in the extension body would run too late, after
// jsdom (and therefore tr46/cssstyle) had already been evaluated.
//
// Keep this import first in extension.ts.
ensureJitiCompat();
