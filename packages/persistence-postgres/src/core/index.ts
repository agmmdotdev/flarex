/** Trusted host composition only. User/adapter capabilities do not export this owner. */
export { openCoreDatabase } from "./database";
export { CORE_TRANSACTION_REFERENCE_LIMITS } from "./accounting";
export { CoreTransactionError, CoreQueryInputError } from "./api";
export { CorePersistenceError } from "./contracts";
export type * from "./api";
export type * from "./contracts";
