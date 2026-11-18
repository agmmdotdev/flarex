import type { FlarexMetadataDatabase } from "../application/deployments";
import type { LocatedScopeClockReader } from "../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../storage/documents/appRows";

export const RUN_LOCATED_REPEATABLE_READ_V1: unique symbol = Symbol(
  "FlarexDB/runLocatedRepeatableReadV1",
);

export const RUN_LOCATED_READ_COMMITTED_V1: unique symbol = Symbol(
  "FlarexDB/runLocatedReadCommittedV1",
);

/** Package-internal construction seam for the Postgres connected runner. */
export const LOCATED_READ_COMMITTED_RUNNER_V1: unique symbol = Symbol(
  "FlarexDB/locatedReadCommittedRunnerV1",
);

export type RunLocatedReadCommittedTransactionV1 = <Result>(
  work: (tx: AppRowTransaction) => Promise<Result>,
) => Promise<Result>;

/**
 * Package-internal read-only capability used by detached attempt evidence
 * loaders. It deliberately cannot run a caller callback under mutation locks.
 */
export interface LocatedRepeatableReadAttemptTargetV1
  extends LocatedScopeClockReader {
  readonly [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
    work: (tx: AppRowTransaction) => Promise<Result>,
  ) => Promise<Result>;
}

/**
 * Package-internal writer-transaction capability. The caller remains inside
 * persistence-postgres and receives no authority to escape the transaction.
 */
export interface LocatedReadCommittedAttemptTargetV1
  extends LocatedScopeClockReader {
  readonly [RUN_LOCATED_READ_COMMITTED_V1]: RunLocatedReadCommittedTransactionV1;
}

const locatedReadCommittedTargetDatabasesV1 = new WeakMap<
  LocatedReadCommittedAttemptTargetV1,
  FlarexMetadataDatabase
>();

/** Package-local exact target/database composition evidence. */
export function registerLocatedReadCommittedTargetDatabaseV1(
  target: LocatedReadCommittedAttemptTargetV1,
  database: FlarexMetadataDatabase,
): void {
  locatedReadCommittedTargetDatabasesV1.set(target, database);
}

export function hasLocatedReadCommittedTargetDatabaseV1(
  target: LocatedReadCommittedAttemptTargetV1,
  database: FlarexMetadataDatabase,
): boolean {
  return locatedReadCommittedTargetDatabasesV1.get(target) === database;
}

export function isLocatedReadCommittedAttemptTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedReadCommittedAttemptTargetV1 {
  return typeof Reflect.get(target, RUN_LOCATED_READ_COMMITTED_V1) ===
    "function";
}

export function isLocatedRepeatableReadAttemptTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedRepeatableReadAttemptTargetV1 {
  return typeof Reflect.get(target, RUN_LOCATED_REPEATABLE_READ_V1) ===
    "function";
}
