import base from "./vitest.config.ts";

// Direct runs and the named PGlite lane use the same lazy content-keyed image
// owner. No global setup starts a database for filtered pure-only selections.
export default base;
