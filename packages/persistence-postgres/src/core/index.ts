/** Trusted host composition only. User/adapter capabilities do not export this owner. */
export { openCoreDatabase } from "./database";
export { CORE_TRANSACTION_REFERENCE_LIMITS } from "./accounting";
export { CoreTransactionError, CoreQueryInputError, CoreSchemaWorkBudgetSchema, CoreSchemaWorkerOptionsSchema } from "./api";
export { CoreSchemaError } from "./schemaTypes";
export type { CoreTableNamespace } from "./namespace";
export { CorePersistenceError } from "./contracts";
export type * from "./api";
export type * from "./contracts";
export { parseCoreTableSummary, serializeCoreTableSummary } from "./tableSummary";
