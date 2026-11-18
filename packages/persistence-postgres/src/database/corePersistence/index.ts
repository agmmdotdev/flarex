/** Trusted host construction; physical installation remains a maintenance owner. */
export { makeCorePostgresDriver } from "./driver";
export type { CorePostgresClient, CorePostgresPool, CoreSqlDriver } from "./driver";
export { loadCorePersistenceTarget, upgradeCorePersistenceAfterDrain } from "./target";
export type { CorePersistenceTarget } from "./target";
export { createCorePersistence } from "./persistence";
