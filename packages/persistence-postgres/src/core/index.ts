/** Trusted host composition only. User/adapter capabilities do not export this owner. */
export { openCoreDatabase } from "./database";
export { makeCoreApplicationOwner } from "./applicationOwner";
export type { CoreApplicationOwner, CoreApplicationMaintenance, CoreApplicationGenerationPhase } from "./applicationOwner";
export { CORE_TRANSACTION_REFERENCE_LIMITS } from "./accounting";
export { CoreTransactionError, CoreQueryInputError, CoreNativeReferenceError, CoreNativeForeignKeyError, isCoreDefinitiveCommitRefusal,
  CoreSchemaWorkBudgetSchema, CoreSchemaWorkerOptionsSchema } from "./api";
export { CoreSchemaError } from "./schemaTypes";
export type { CoreTableNamespace } from "./namespace";
export { CorePersistenceError } from "./contracts";
export type * from "./api";
export type * from "./contracts";
export { parseCoreTableSummary, serializeCoreTableSummary } from "./tableSummary";
export { makeCoreRelationalNativeDefinition, coreNativeRelationalRows, coreNativeRelationalFailure } from "./nativePolicy";
export type { CoreNativeDefinition, CoreNativeRelationalRowPolicy, CoreNativeRelationalIndex } from "./nativePolicy";
export { makeCoreSchemaBundle } from "./schemaBundle";
export type { CoreSchemaBundle, CoreSchemaSource, CoreSchemaTableBinding } from "./schemaBundle";
