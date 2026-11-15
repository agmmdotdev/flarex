// Eager, unused Postgres barrel imports resolve to traps, never an engine.
// Any attempt to open a database or request a driver parser fails the cohort.
export class Client { constructor() { throw new Error("Postgres client construction is forbidden"); } }
export class Pool { constructor() { throw new Error("Postgres pool construction is forbidden"); } }
export class PGlite { constructor() { throw new Error("PGlite construction is forbidden"); } }
export const types = { getTypeParser() { throw new Error("Postgres type parsing is forbidden"); } };
export default { Client, Pool, types };
