import type { FlarexPersistenceTx } from "./index";
import type { FlarexMetadataDatabase } from "./deployments";

const runtimePersistenceTransactionBrand: unique symbol = Symbol(
  "FlarexRuntimePersistenceTransaction",
);

/**
 * A database handle whose driver owns an active transaction around its use.
 *
 * The private brand prevents a top-level database from being passed to an
 * operation that relies on transaction-scoped locks or atomic rollback.
 */
export interface FlarexRuntimePersistenceTransaction {
  readonly [runtimePersistenceTransactionBrand]: true;
  readonly drizzle: FlarexMetadataDatabase;
  readonly sql: FlarexPersistenceTx;
}

export function createFlarexRuntimePersistenceTransaction(
  drizzle: FlarexMetadataDatabase,
  sql: FlarexPersistenceTx,
): FlarexRuntimePersistenceTransaction {
  return {
    [runtimePersistenceTransactionBrand]: true,
    drizzle,
    sql,
  };
}
