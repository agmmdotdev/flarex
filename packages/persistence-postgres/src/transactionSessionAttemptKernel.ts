import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";
import type { ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";

import type { AppRowTransaction } from "./appRows";
import type {
  LocatedScopeClockReader,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import type { fxSystemTransactionJournals } from "./schema";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptExecutionPinV1,
  PointMutationSessionAttemptSelectorV1,
} from "./transactionSessionActivation";

type TransactionJournalRootRowV1 =
  typeof fxSystemTransactionJournals.$inferSelect;

export interface ExactRunningAttemptKernelInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
}

export interface ExactRunningAttemptKernelContextV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionPin: PointMutationSessionAttemptExecutionPinV1;
  readonly databaseNow: Date;
  readonly journalRoot: Readonly<TransactionJournalRootRowV1>;
}

export type ExactRunningAttemptWorkV1<Result> = (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
) => Promise<Result>;

/**
 * Package-internal capability. This module is deliberately absent from package
 * exports so no public caller can request a raw transaction callback.
 */
export const RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_V1: unique symbol =
  Symbol("FlarexDB/runExactRunningPointMutationAttemptV1");

export const RESOLVE_PINNED_POINT_TABLE_ID_V1: unique symbol = Symbol(
  "FlarexDB/resolvePinnedPointTableIdV1",
);

export const RUN_LOCATED_REPEATABLE_READ_V1: unique symbol = Symbol(
  "FlarexDB/runLocatedRepeatableReadV1",
);

export interface LocatedExactRunningAttemptKernelV1
  extends LocatedScopeClockReader {
  readonly [RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_V1]: <Result>(
    input: ExactRunningAttemptKernelInputV1,
    work: ExactRunningAttemptWorkV1<Result>,
  ) => Promise<Result>;
  readonly [RESOLVE_PINNED_POINT_TABLE_ID_V1]: (input: {
    readonly deploymentId: TransactionGrantDeploymentIdV1;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly tableName: SchemaManifestAppTableName;
  }) => Promise<CatalogTableId>;
  readonly [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
    work: (tx: AppRowTransaction) => Promise<Result>,
  ) => Promise<Result>;
}

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

export function isLocatedRepeatableReadAttemptTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedRepeatableReadAttemptTargetV1 {
  return typeof Reflect.get(target, RUN_LOCATED_REPEATABLE_READ_V1) ===
    "function";
}

export function isLocatedExactRunningAttemptKernelV1(
  target: LocatedScopeClockReader,
): target is LocatedExactRunningAttemptKernelV1 {
  return (
    typeof Reflect.get(
      target,
      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_V1,
    ) === "function" &&
    typeof Reflect.get(target, RESOLVE_PINNED_POINT_TABLE_ID_V1) === "function"
    && typeof Reflect.get(target, RUN_LOCATED_REPEATABLE_READ_V1) === "function"
  );
}
