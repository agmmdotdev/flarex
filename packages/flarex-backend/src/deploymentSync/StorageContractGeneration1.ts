import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "@flarex/query-sync/internal/state";
import { makeEmptyQuerySyncScopeFacts } from "@flarex/query-sync/internal/transition-plan";
import { Data, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  captureScopeSyncSourceEpochV1,
  captureScopeSyncSourceSequenceV1,
} from "./QuerySyncModel";
import {
  decodeDeploymentSyncGeneration1ScopeRowResult,
  type DeploymentSyncGeneration1ScopeState,
} from "./RowCodec";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStorageCatalogDefinition,
} from "./StorageContract";

const STORAGE_READINESS_OPERATION = "initializeOrInspectNamespace" as const;

export const GENERATION_1_SCOPE_TABLE_DDL =
  `CREATE TABLE deployment_sync_scope_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  local_schema_revision INTEGER NOT NULL,
  scope_uuid TEXT NOT NULL,
  epoch_uuid TEXT NOT NULL,
  storage_generation TEXT NOT NULL,
  storage_generation_fence TEXT NOT NULL,
  applied_through_commit_seq TEXT NOT NULL
)`;

export const deploymentQuerySyncGeneration1Catalog = Object.freeze({
  generation: 1,
  tables: Object.freeze([
    Object.freeze({
      name: "deployment_sync_scope_state",
      ddl: GENERATION_1_SCOPE_TABLE_DDL,
      withoutRowId: 0,
      strict: 0,
      columns: Object.freeze([
        Object.freeze({
          name: "singleton",
          type: "INTEGER",
          notnull: 0,
          pk: 1,
        }),
        Object.freeze({
          name: "local_schema_revision",
          type: "INTEGER",
          notnull: 1,
          pk: 0,
        }),
        Object.freeze({
          name: "scope_uuid",
          type: "TEXT",
          notnull: 1,
          pk: 0,
        }),
        Object.freeze({
          name: "epoch_uuid",
          type: "TEXT",
          notnull: 1,
          pk: 0,
        }),
        Object.freeze({
          name: "storage_generation",
          type: "TEXT",
          notnull: 1,
          pk: 0,
        }),
        Object.freeze({
          name: "storage_generation_fence",
          type: "TEXT",
          notnull: 1,
          pk: 0,
        }),
        Object.freeze({
          name: "applied_through_commit_seq",
          type: "TEXT",
          notnull: 1,
          pk: 0,
        }),
      ]),
    }),
  ]),
  indexes: Object.freeze([]),
} as const satisfies DeploymentQuerySyncStorageCatalogDefinition);

type EncodedGeneration1ScopeRow = Readonly<{
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
  readonly local_schema_revision: number;
  readonly scope_uuid: string;
  readonly epoch_uuid: string;
  readonly storage_generation: string;
  readonly storage_generation_fence: string;
  readonly applied_through_commit_seq: string;
}>;

class DeploymentQuerySyncStorageContractIssue extends Data.TaggedError(
  "DeploymentQuerySyncStorageContractIssue",
)<{
  readonly reason:
    | "legacyRowDuplicate"
    | "legacyRevisionUnsupported"
    | "legacyRowInvalid"
    | "legacyRouteScopeMismatch"
    | "legacyBootstrapBindingMismatch"
    | "legacyPortableProjectionRejected";
  readonly expected: unknown;
  readonly observed: unknown;
  readonly cause: unknown | null;
}> {}

function issue(
  reason: DeploymentQuerySyncStorageContractIssue["reason"],
  input: Readonly<{
    readonly expected?: unknown;
    readonly observed?: unknown;
    readonly cause?: unknown;
  }> = {},
): DeploymentQuerySyncStorageContractIssue {
  return new DeploymentQuerySyncStorageContractIssue({
    reason,
    expected: input.expected ?? null,
    observed: input.observed ?? null,
    cause: input.cause ?? null,
  });
}

function corrupt(
  reason: QuerySyncStoredStateCorruptError<
    typeof STORAGE_READINESS_OPERATION
  >["reason"],
  cause: unknown,
): QuerySyncStoredStateCorruptError<typeof STORAGE_READINESS_OPERATION> {
  return new QuerySyncStoredStateCorruptError({
    operation: STORAGE_READINESS_OPERATION,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

function incompatible(
  reason: "unsupportedStoredContract" | "bootstrapBindingMismatch",
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<
  typeof STORAGE_READINESS_OPERATION
> {
  return new QuerySyncStoredStateIncompatibleError({
    operation: STORAGE_READINESS_OPERATION,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

export function readDeploymentQuerySyncGeneration1Scope(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<
  DeploymentSyncGeneration1ScopeState | null,
  | QuerySyncStoredStateCorruptError<typeof STORAGE_READINESS_OPERATION>
  | QuerySyncStoredStateIncompatibleError<typeof STORAGE_READINESS_OPERATION>
> {
  const rows = sql.exec<EncodedGeneration1ScopeRow>(`SELECT
    singleton,
    local_schema_revision,
    scope_uuid,
    epoch_uuid,
    storage_generation,
    storage_generation_fence,
    applied_through_commit_seq
  FROM main.deployment_sync_scope_state
  ORDER BY singleton
  LIMIT 2`).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(corrupt(
      "storedAggregateInvalid",
      issue("legacyRowDuplicate", { observed: rows.length }),
    ));
  }
  return decodeDeploymentSyncGeneration1ScopeRowResult(rows[0]).pipe(
    Result.mapError(cause => cause.reason === "unsupportedLegacyRevision"
      ? incompatible(
        "unsupportedStoredContract",
        issue("legacyRevisionUnsupported", { cause }),
      )
      : corrupt(
        "storedAggregateInvalid",
        issue("legacyRowInvalid", { cause }),
      )),
  );
}

export function authenticateDeploymentQuerySyncGeneration1Scope(
  legacy: DeploymentSyncGeneration1ScopeState,
  binding: DeploymentQuerySyncBinding,
): Result.Result<
  ReturnType<typeof makeEmptyQuerySyncScopeFacts>,
  | QuerySyncStoredStateCorruptError<typeof STORAGE_READINESS_OPERATION>
  | QuerySyncStoredStateIncompatibleError<typeof STORAGE_READINESS_OPERATION>
> {
  if (legacy.scopeUuid !== binding.scopeUuid) {
    return Result.fail(corrupt(
      "namespaceBindingMismatch",
      issue("legacyRouteScopeMismatch", {
        expected: binding.scopeUuid,
        observed: legacy.scopeUuid,
      }),
    ));
  }
  if (
    legacy.storageGeneration !== binding.storageGeneration
    || legacy.storageGenerationFence !== binding.storageGenerationFence
    || legacy.appliedThroughCommitSeq > binding.observedAtCommitSeq
  ) {
    return Result.fail(incompatible(
      "bootstrapBindingMismatch",
      issue("legacyBootstrapBindingMismatch", {
        expected: Object.freeze({
          storageGeneration: binding.storageGeneration,
          storageGenerationFence: binding.storageGenerationFence.toString(),
          maximumAppliedThroughCommitSeq:
            binding.observedAtCommitSeq.toString(),
        }),
        observed: Object.freeze({
          storageGeneration: legacy.storageGeneration,
          storageGenerationFence: legacy.storageGenerationFence.toString(),
          appliedThroughCommitSeq: legacy.appliedThroughCommitSeq.toString(),
        }),
      }),
    ));
  }
  return Result.gen(function* () {
    const sourceEpoch = yield* captureScopeSyncSourceEpochV1(
      legacy.epochUuid,
    ).pipe(Result.mapError(cause => corrupt(
      "storedAggregateInvalid",
      issue("legacyPortableProjectionRejected", { cause }),
    )));
    const appliedThroughSequence = yield* captureScopeSyncSourceSequenceV1(
      legacy.appliedThroughCommitSeq,
    ).pipe(Result.mapError(cause => corrupt(
      "storedAggregateInvalid",
      issue("legacyPortableProjectionRejected", { cause }),
    )));
    return makeEmptyQuerySyncScopeFacts({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch,
      appliedThroughSequence,
    });
  });
}

export type DeploymentQuerySyncGeneration1ScopeState =
  DeploymentSyncGeneration1ScopeState;
