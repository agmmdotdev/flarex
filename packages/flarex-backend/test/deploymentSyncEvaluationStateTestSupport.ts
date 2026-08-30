import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  captureCanonicalDependencyKey,
  captureQueryAuthorityWitness,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryOperationTarget,
  captureQueryPublicationArtifact,
  type BeginQueryEvaluationRequest,
  type QueryDescriptor,
  type QueryEvaluationAttempt,
  type QueryEvaluationEvidence,
  type GenerationRefreshEvidence,
  type QueryGeneration,
  type QueryPublicationArtifact,
  type SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { Effect, Encoding, Result } from "effect";

import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";

import {
  captureDeploymentQuerySyncBinding,
  makeDeploymentQuerySyncFreshInitializationCapabilityForTest,
  type DeploymentQuerySyncBinding,
} from "../src/deploymentSync/Binding";
import {
  makeDeploymentQuerySyncEvaluationState,
  type DeploymentQuerySyncEvaluationState,
} from "../src/deploymentSync/Store";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000201",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000202",
);

export interface PreparedEvaluationState {
  readonly database: DatabaseSync;
  readonly state: DeploymentQuerySyncEvaluationState;
  readonly binding: DeploymentQuerySyncBinding;
}

export interface EvaluationSqlInvocation {
  readonly query: string;
  readonly bindings: readonly SQLInputValue[];
  readonly isWrite: boolean;
}

export interface EvaluationSqlCompletion extends EvaluationSqlInvocation {
  readonly rowsWritten: number;
}

export interface EvaluationSqlHooks {
  readonly beforeExecute?: (invocation: EvaluationSqlInvocation) => void;
  readonly afterExecute?: (completion: EvaluationSqlCompletion) => void;
}

export async function prepareEvaluationState(
  hooks: EvaluationSqlHooks = {},
): Promise<PreparedEvaluationState> {
  const database = new DatabaseSync(":memory:");
  const storage = makeSqliteStorage(database, hooks);
  const bindingInput = Object.freeze({
    objectId: Object.freeze({ name: `deployment-sync:${scopeUuid}` }),
    observation: captureScopeSyncActiveHeadObservationV1({
      format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid,
      epochUuid,
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(7n),
      observedAtCommitSeq: CommitSeqSchema.make(11n),
      activationSequence: ApplicationActivationSequenceV1Schema.make(1n),
      activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
        "ab".repeat(32),
      ),
    }),
  });
  const binding = success(captureDeploymentQuerySyncBinding(bindingInput));
  const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState({
    binding: bindingInput,
    storage,
    freshInitializationCapability:
      makeDeploymentQuerySyncFreshInitializationCapabilityForTest(binding),
  }));
  await Effect.runPromise(
    state.initializeOrInspectNamespace(binding.bootstrapCursor),
  );
  return Object.freeze({ database, state, binding });
}

export function queryDescriptor(seed: number): QueryDescriptor {
  return success(captureQueryDescriptor({
    queryKey: canonicalKey(seed),
    queryIdentity: Encoding.encodeBase64Url(`evaluation-query-${seed}`),
  }));
}

export function beginRequest(
  binding: DeploymentQuerySyncBinding,
  descriptor: QueryDescriptor,
  options: Readonly<{
    readonly expectedActiveGeneration?: QueryGeneration;
    readonly requestedDirtyThroughSequence?: SyncSequence;
  }> = {},
): BeginQueryEvaluationRequest {
  return Object.freeze({
    target: success(captureQueryOperationTarget({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      descriptor,
    })),
    expectedActiveGeneration: options.expectedActiveGeneration ?? null,
    requestedDirtyThroughSequence:
      options.requestedDirtyThroughSequence ?? null,
  });
}

export async function beginEvaluation(
  prepared: PreparedEvaluationState,
  descriptor: QueryDescriptor,
  options: Parameters<typeof beginRequest>[2] = {},
): Promise<QueryEvaluationAttempt> {
  const receipt = await Effect.runPromise(
    prepared.state.beginQueryEvaluation(
      beginRequest(prepared.binding, descriptor, options),
    ),
  );
  if (receipt._tag !== "created") {
    throw new Error(`Expected created evaluation, received ${receipt._tag}.`);
  }
  return receipt.attempt;
}

export function completionInput(
  prepared: PreparedEvaluationState,
  attempt: QueryEvaluationAttempt,
  dependencyLabel = "primary",
): Readonly<{
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
}> {
  const dependency = success(captureCanonicalDependencyKey(
    Encoding.encodeBase64Url(`dependency:${dependencyLabel}`),
  ));
  const authorityWitness = success(captureQueryAuthorityWitness(
    canonicalKey(90),
  ));
  const evaluation = success(captureQueryEvaluationEvidence({
    namespaceId: prepared.binding.namespaceId,
    syncModelId: prepared.binding.syncModelId,
    sourceEpoch: prepared.binding.sourceEpoch,
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshotSequence: attempt.registrationCursor.appliedThroughSequence,
    resultDigest: canonicalKey(80),
    authorityWitness,
    dependencyKeys: [dependency],
  }));
  const refresh = success(deriveGenerationRefreshEvidence(
    evaluation,
    attempt.registrationCursor,
    [],
    authorityWitness,
  ));
  const publication = success(captureQueryPublicationArtifact({
    content: Encoding.encodeBase64Url(`result:${dependencyLabel}`),
  }));
  return Object.freeze({ evaluation, refresh, publication });
}

export function canonicalKey(seed: number) {
  return Encoding.encodeBase64Url(Uint8Array.from(
    { length: 32 },
    (_value, index) => (seed + index) % 256,
  ));
}

export function snapshotEvaluationState(database: DatabaseSync) {
  return Object.freeze({
    scope: database.prepare(
      "SELECT * FROM deployment_sync_scope_state",
    ).all(),
    queries: database.prepare(
      "SELECT * FROM deployment_sync_queries ORDER BY query_key",
    ).all(),
    dependencies: database.prepare(
      `SELECT * FROM deployment_sync_query_dependencies
       ORDER BY query_key, role, generation, dependency_key`,
    ).all(),
    pending: database.prepare(
      "SELECT * FROM deployment_sync_pending_publications ORDER BY query_key",
    ).all(),
  });
}

function makeSqliteStorage(
  database: DatabaseSync,
  hooks: EvaluationSqlHooks,
): DeploymentQuerySyncStorage {
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    Row extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<Row> => {
    const isWrite = /^(?:insert|update|delete)\b/i.test(query.trimStart());
    const invocation: EvaluationSqlInvocation = Object.freeze({
      query,
      bindings: Object.freeze([...bindings]),
      isWrite,
    });
    hooks.beforeExecute?.(invocation);
    // SAFETY: production codecs validate every row after this test-only
    // adapter restores the caller-selected generic from SQLite's row edge.
    const rows = database.prepare(query).all(...bindings) as Row[];
    const rowsWritten = isWrite ? rows.length : 0;
    hooks.afterExecute?.(Object.freeze({
      ...invocation,
      rowsWritten,
    }));
    return cursorFor(rows, rowsWritten);
  };
  return Object.freeze({
    sql: Object.freeze({ exec }),
    transactionSync: <A>(closure: () => A): A => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const value = closure();
        database.exec("COMMIT");
        return value;
      } catch (cause) {
        database.exec("ROLLBACK");
        throw cause;
      }
    },
  });
}

function cursorFor<Row extends Record<string, SqlStorageValue>>(
  rows: Row[],
  rowsWritten: number,
): SqlStorageCursor<Row> {
  let nextIndex = 0;
  return {
    next() {
      const value = rows[nextIndex];
      if (value === undefined) return { done: true };
      nextIndex += 1;
      return { done: false, value };
    },
    toArray: () => [...rows],
    one() {
      if (rows.length !== 1 || rows[0] === undefined) {
        throw new Error("Expected exactly one SQLite test row.");
      }
      return rows[0];
    },
    raw: emptyRawRows,
    columnNames: rows[0] === undefined ? [] : Object.keys(rows[0]),
    get rowsRead() {
      return rows.length;
    },
    get rowsWritten() {
      return rowsWritten;
    },
    [Symbol.iterator]: () => [...rows][Symbol.iterator](),
  };
}

function emptyRawRows<Row extends SqlStorageValue[]>(): IterableIterator<Row> {
  return (function* () {})();
}

export function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}
