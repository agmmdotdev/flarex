import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import { Data, Effect, Option, Result, Schema } from "effect";

import {
  SCOPE_SYNC_CURSOR_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncCursorV1,
  type ScopeSyncActiveHeadObservationV1,
  type ScopeSyncCursorV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import {
  advanceScopeSyncCursorV1,
} from "./Policy";
import type {
  ScopeSyncAdvanceCommitDecision,
  ScopeSyncAdvanceCommitError,
} from "./Model";

const DEPLOYMENT_SYNC_LOCAL_SCHEMA_REVISION = 1 as const;

type DeploymentSyncStoreOperation =
  | "initializeSchema"
  | "initialize"
  | "read"
  | "advance";

type DeploymentSyncInitializationConflictField =
  | "scopeUuid"
  | "epochUuid"
  | "storageGeneration"
  | "storageGenerationFence"
  | "appliedThroughCommitSeq";

export class DeploymentSyncInitializationConflictError extends Data.TaggedError(
  "DeploymentSyncInitializationConflictError",
)<{
  readonly field: DeploymentSyncInitializationConflictField;
  readonly expected: string;
  readonly observed: string;
}> {}

export class DeploymentSyncUninitializedError extends Data.TaggedError(
  "DeploymentSyncUninitializedError",
)<{ readonly scopeUuid: ScopeUuidV1 }> {}

export class DeploymentSyncActorIdentityConflictError extends Data.TaggedError(
  "DeploymentSyncActorIdentityConflictError",
)<{
  readonly operation: Exclude<DeploymentSyncStoreOperation, "initializeSchema">;
  readonly expectedScopeUuid: ScopeUuidV1;
  readonly observedScopeUuid: ScopeUuidV1;
}> {}

export class DeploymentSyncCursorStateConflictError extends Data.TaggedError(
  "DeploymentSyncCursorStateConflictError",
)<{
  readonly scopeUuid: ScopeUuidV1;
  readonly expectedAppliedThroughCommitSeq: CommitSeq;
  readonly candidateAppliedThroughCommitSeq: CommitSeq;
}> {}

export class DeploymentSyncStateCorruptionError extends Data.TaggedError(
  "DeploymentSyncStateCorruptionError",
)<{
  readonly operation: Exclude<DeploymentSyncStoreOperation, "initializeSchema">;
  readonly detail: "duplicateStateRows" | "invalidStateRow";
  readonly cause?: unknown;
}> {}

export class DeploymentSyncStorageError extends Data.TaggedError(
  "DeploymentSyncStorageError",
)<{
  readonly operation: DeploymentSyncStoreOperation;
  readonly cause: unknown;
}> {}

export interface DeploymentSyncScopeState {
  readonly localSchemaRevision: typeof DEPLOYMENT_SYNC_LOCAL_SCHEMA_REVISION;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly appliedThroughCommitSeq: CommitSeq;
}

export type DeploymentSyncReadError =
  | DeploymentSyncActorIdentityConflictError
  | DeploymentSyncStateCorruptionError
  | DeploymentSyncStorageError;

export type DeploymentSyncInitializeError =
  | DeploymentSyncInitializationConflictError
  | DeploymentSyncStateCorruptionError
  | DeploymentSyncStorageError;

export type DeploymentSyncAdvanceError =
  | DeploymentSyncActorIdentityConflictError
  | DeploymentSyncCursorStateConflictError
  | DeploymentSyncStateCorruptionError
  | DeploymentSyncStorageError
  | DeploymentSyncUninitializedError
  | ScopeSyncAdvanceCommitError;

export interface DeploymentSyncCursorStore {
  readonly initialize: (
    observation: ScopeSyncActiveHeadObservationV1,
  ) => Effect.Effect<DeploymentSyncScopeState, DeploymentSyncInitializeError>;
  readonly read: (
    scopeUuid: ScopeUuidV1,
  ) => Effect.Effect<Option.Option<DeploymentSyncScopeState>, DeploymentSyncReadError>;
  readonly advance: (
    scopeUuid: ScopeUuidV1,
    commit: CommitFeedCommitV1,
  ) => Effect.Effect<ScopeSyncAdvanceCommitDecision, DeploymentSyncAdvanceError>;
}

export interface DeploymentSyncTransactionStorage {
  readonly transactionSync: <A>(closure: () => A) => A;
}

type DeploymentSyncScopeStateRow = Readonly<{
  readonly singleton: 1;
  readonly local_schema_revision: 1;
  readonly scope_uuid: ScopeUuidV1;
  readonly epoch_uuid: ScopeEpochUuidV1;
  readonly storage_generation: FlarexDbV1StorageGeneration;
  readonly storage_generation_fence: StorageGenerationFence;
  readonly applied_through_commit_seq: CommitSeq;
}>;

interface EncodedDeploymentSyncScopeStateRow {
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
  readonly local_schema_revision: number;
  readonly scope_uuid: string;
  readonly epoch_uuid: string;
  readonly storage_generation: string;
  readonly storage_generation_fence: string;
  readonly applied_through_commit_seq: string;
}

const DeploymentSyncScopeStateRowSchema = Schema.Struct({
  singleton: Schema.Literal(1),
  local_schema_revision: Schema.Literal(DEPLOYMENT_SYNC_LOCAL_SCHEMA_REVISION),
  scope_uuid: ScopeUuidV1Schema,
  epoch_uuid: ScopeEpochUuidV1Schema,
  storage_generation: FlarexDbV1StorageGenerationSchema,
  storage_generation_fence: StorageGenerationFenceSchema,
  applied_through_commit_seq: CommitSeqSchema,
});

const decodeDeploymentSyncScopeStateRow = Schema.decodeUnknownResult(
  DeploymentSyncScopeStateRowSchema,
  { onExcessProperty: "error" },
);

export function initializeDeploymentSyncStorage(
  sql: SqlStorage,
): Result.Result<void, DeploymentSyncStorageError> {
  return Result.try({
    try: () => {
      sql.exec(`CREATE TABLE IF NOT EXISTS deployment_sync_scope_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        local_schema_revision INTEGER NOT NULL,
        scope_uuid TEXT NOT NULL,
        epoch_uuid TEXT NOT NULL,
        storage_generation TEXT NOT NULL,
        storage_generation_fence TEXT NOT NULL,
        applied_through_commit_seq TEXT NOT NULL
      )`);
    },
    catch: cause => new DeploymentSyncStorageError({
      operation: "initializeSchema",
      cause,
    }),
  });
}

export function makeDeploymentSyncCursorStore(
  storage: DeploymentSyncTransactionStorage,
  sql: SqlStorage,
): DeploymentSyncCursorStore {
  const initialize = Effect.fn("DeploymentSyncCursorStore.initialize")(
    (observation: ScopeSyncActiveHeadObservationV1) =>
      runTransaction(storage, "initialize", () =>
        readStateResult(sql, "initialize").pipe(
          Result.flatMap(current => initializeCurrentStateResult(
            sql,
            current,
            observation,
          )),
        )),
  );

  const read = Effect.fn("DeploymentSyncCursorStore.read")(
    (scopeUuid: ScopeUuidV1) =>
      readStateEffect(sql, "read").pipe(
        Effect.flatMap(state => Option.match(state, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: current => current.scopeUuid === scopeUuid
            ? Effect.succeed(Option.some(current))
            : Effect.fail(new DeploymentSyncActorIdentityConflictError({
              operation: "read",
              expectedScopeUuid: scopeUuid,
              observedScopeUuid: current.scopeUuid,
            })),
        })),
      ),
  );

  const advance = Effect.fn("DeploymentSyncCursorStore.advance")(
    (scopeUuid: ScopeUuidV1, commit: CommitFeedCommitV1) =>
      runTransaction(storage, "advance", () =>
        readStateResult(sql, "advance").pipe(
          Result.flatMap(state => Option.match(state, {
            onNone: () => Result.fail(new DeploymentSyncUninitializedError({
              scopeUuid,
            })),
            onSome: current => advanceCurrentStateResult(
              sql,
              scopeUuid,
              current,
              commit,
            ),
          })),
        )),
  );

  return Object.freeze({ initialize, read, advance });
}

function runTransaction<A, E>(
  storage: DeploymentSyncTransactionStorage,
  operation: "initialize" | "advance",
  transaction: () => Result.Result<A, E | DeploymentSyncStorageError>,
): Effect.Effect<A, E | DeploymentSyncStorageError> {
  class TransactionRollback extends Error {
    constructor(readonly failure: E | DeploymentSyncStorageError) {
      super("Deployment sync SQLite transaction rolled back.");
    }
  }

  class TransactionCallbackDefect extends Error {
    constructor(readonly defect: unknown) {
      super("Deployment sync SQLite transaction callback defected.");
    }
  }

  return Effect.suspend(() => {
    try {
      const value = storage.transactionSync(() => {
        try {
          return Result.match(transaction(), {
            onFailure: failure => {
              throw new TransactionRollback(failure);
            },
            onSuccess: success => success,
          });
        } catch (cause) {
          if (cause instanceof TransactionRollback) throw cause;
          throw new TransactionCallbackDefect(cause);
        }
      });
      return Effect.succeed(value);
    } catch (cause) {
      if (cause instanceof TransactionRollback) {
        return Effect.fail(cause.failure);
      }
      if (cause instanceof TransactionCallbackDefect) {
        return Effect.die(cause.defect);
      }
      return Effect.fail(new DeploymentSyncStorageError({ operation, cause }));
    }
  });
}

function readStateEffect(
  sql: SqlStorage,
  operation: "read",
): Effect.Effect<
  Option.Option<DeploymentSyncScopeState>,
  DeploymentSyncStateCorruptionError | DeploymentSyncStorageError
> {
  return Effect.fromResult(readStateResult(sql, operation));
}

function readStateResult(
  sql: SqlStorage,
  operation: "initialize" | "read" | "advance",
): Result.Result<
  Option.Option<DeploymentSyncScopeState>,
  DeploymentSyncStateCorruptionError | DeploymentSyncStorageError
> {
  return Result.try({
    try: () => sql.exec<EncodedDeploymentSyncScopeStateRow>(`
      SELECT
        singleton,
        local_schema_revision,
        scope_uuid,
        epoch_uuid,
        storage_generation,
        storage_generation_fence,
        applied_through_commit_seq
      FROM deployment_sync_scope_state
      ORDER BY singleton
      LIMIT 2
    `).toArray(),
    catch: cause => new DeploymentSyncStorageError({ operation, cause }),
  }).pipe(
    Result.flatMap(rows => {
      if (rows.length === 0) return Result.succeed(Option.none());
      if (rows.length !== 1) {
        return Result.fail(new DeploymentSyncStateCorruptionError({
          operation,
          detail: "duplicateStateRows",
        }));
      }
      return decodeDeploymentSyncScopeStateRow(rows[0]).pipe(
        Result.map(toScopeState),
        Result.map(Option.some),
        Result.mapError(cause => new DeploymentSyncStateCorruptionError({
          operation,
          detail: "invalidStateRow",
          cause,
        })),
      );
    }),
  );
}

function insertInitialStateResult(
  sql: SqlStorage,
  observation: ScopeSyncActiveHeadObservationV1,
): Result.Result<DeploymentSyncScopeState, DeploymentSyncStorageError> {
  return Result.try({
    try: () => {
      sql.exec(
        `INSERT INTO deployment_sync_scope_state (
          singleton,
          local_schema_revision,
          scope_uuid,
          epoch_uuid,
          storage_generation,
          storage_generation_fence,
          applied_through_commit_seq
        ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
        DEPLOYMENT_SYNC_LOCAL_SCHEMA_REVISION,
        observation.scopeUuid,
        observation.epochUuid,
        observation.storageGeneration,
        observation.storageGenerationFence.toString(),
        observation.observedAtCommitSeq.toString(),
      );
      return stateFromObservation(observation);
    },
    catch: cause => new DeploymentSyncStorageError({
      operation: "initialize",
      cause,
    }),
  });
}

function initializeCurrentStateResult(
  sql: SqlStorage,
  current: Option.Option<DeploymentSyncScopeState>,
  observation: ScopeSyncActiveHeadObservationV1,
): Result.Result<DeploymentSyncScopeState, DeploymentSyncInitializeError> {
  return Option.match(current, {
    onNone: () => insertInitialStateResult(sql, observation),
    onSome: state => requireExactInitialization(state, observation),
  });
}

function requireExactInitialization(
  current: DeploymentSyncScopeState,
  observation: ScopeSyncActiveHeadObservationV1,
): Result.Result<
  DeploymentSyncScopeState,
  DeploymentSyncInitializationConflictError
> {
  const comparisons = [
    ["scopeUuid", current.scopeUuid, observation.scopeUuid],
    ["epochUuid", current.epochUuid, observation.epochUuid],
    ["storageGeneration", current.storageGeneration, observation.storageGeneration],
    [
      "storageGenerationFence",
      current.storageGenerationFence.toString(),
      observation.storageGenerationFence.toString(),
    ],
    [
      "appliedThroughCommitSeq",
      current.appliedThroughCommitSeq.toString(),
      observation.observedAtCommitSeq.toString(),
    ],
  ] as const satisfies ReadonlyArray<readonly [
    DeploymentSyncInitializationConflictField,
    string,
    string,
  ]>;
  for (const [field, expected, observed] of comparisons) {
    if (expected !== observed) {
      return Result.fail(new DeploymentSyncInitializationConflictError({
        field,
        expected,
        observed,
      }));
    }
  }
  return Result.succeed(current);
}

function advanceCurrentStateResult(
  sql: SqlStorage,
  scopeUuid: ScopeUuidV1,
  current: DeploymentSyncScopeState,
  commit: CommitFeedCommitV1,
): Result.Result<
  ScopeSyncAdvanceCommitDecision,
  DeploymentSyncAdvanceError
> {
  if (current.scopeUuid !== scopeUuid) {
    return Result.fail(new DeploymentSyncActorIdentityConflictError({
      operation: "advance",
      expectedScopeUuid: scopeUuid,
      observedScopeUuid: current.scopeUuid,
    }));
  }
  const cursor = cursorFromState(current);
  return advanceScopeSyncCursorV1(cursor, commit).pipe(
    Result.flatMap(decision => persistAdvanceDecisionResult(
      sql,
      cursor,
      decision,
    )),
  );
}

function persistAdvanceDecisionResult(
  sql: SqlStorage,
  cursor: ScopeSyncCursorV1,
  decision: ScopeSyncAdvanceCommitDecision,
): Result.Result<
  ScopeSyncAdvanceCommitDecision,
  DeploymentSyncCursorStateConflictError | DeploymentSyncStorageError
> {
  if (decision.kind === "duplicate") return Result.succeed(decision);
  return compareAndSwapCursorResult(sql, cursor, decision.nextCursor).pipe(
    Result.map((): ScopeSyncAdvanceCommitDecision => decision),
  );
}

function compareAndSwapCursorResult(
  sql: SqlStorage,
  expected: ScopeSyncCursorV1,
  candidate: ScopeSyncCursorV1,
): Result.Result<
  void,
  DeploymentSyncCursorStateConflictError | DeploymentSyncStorageError
> {
  return Result.try({
    try: () => sql.exec<EncodedDeploymentSyncScopeStateRow>(
      `UPDATE deployment_sync_scope_state
       SET applied_through_commit_seq = ?
       WHERE singleton = 1
         AND scope_uuid = ?
         AND epoch_uuid = ?
         AND applied_through_commit_seq = ?
       RETURNING
         singleton,
         local_schema_revision,
         scope_uuid,
         epoch_uuid,
         storage_generation,
         storage_generation_fence,
         applied_through_commit_seq`,
      candidate.appliedThroughCommitSeq.toString(),
      expected.scopeUuid,
      expected.epochUuid,
      expected.appliedThroughCommitSeq.toString(),
    ).toArray(),
    catch: cause => new DeploymentSyncStorageError({
      operation: "advance",
      cause,
    }),
  }).pipe(
    Result.flatMap(rows => rows.length === 1
      ? Result.succeed(undefined)
      : Result.fail(new DeploymentSyncCursorStateConflictError({
        scopeUuid: expected.scopeUuid,
        expectedAppliedThroughCommitSeq: expected.appliedThroughCommitSeq,
        candidateAppliedThroughCommitSeq: candidate.appliedThroughCommitSeq,
      }))),
  );
}

function toScopeState(
  row: DeploymentSyncScopeStateRow,
): DeploymentSyncScopeState {
  return Object.freeze({
    localSchemaRevision: row.local_schema_revision,
    scopeUuid: row.scope_uuid,
    epochUuid: row.epoch_uuid,
    storageGeneration: row.storage_generation,
    storageGenerationFence: row.storage_generation_fence,
    appliedThroughCommitSeq: row.applied_through_commit_seq,
  });
}

function stateFromObservation(
  observation: ScopeSyncActiveHeadObservationV1,
): DeploymentSyncScopeState {
  return Object.freeze({
    localSchemaRevision: DEPLOYMENT_SYNC_LOCAL_SCHEMA_REVISION,
    scopeUuid: observation.scopeUuid,
    epochUuid: observation.epochUuid,
    storageGeneration: observation.storageGeneration,
    storageGenerationFence: observation.storageGenerationFence,
    appliedThroughCommitSeq: observation.observedAtCommitSeq,
  });
}

function cursorFromState(
  state: DeploymentSyncScopeState,
): ScopeSyncCursorV1 {
  return captureScopeSyncCursorV1({
    format: SCOPE_SYNC_CURSOR_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: state.scopeUuid,
    epochUuid: state.epochUuid,
    appliedThroughCommitSeq: state.appliedThroughCommitSeq,
  });
}
