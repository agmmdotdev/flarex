import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  captureAdmittedInvalidationBatch,
  captureNamespaceCursor,
  captureQueryDescriptor,
  captureQueryOperationTarget,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Encoding, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

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
  type DeploymentQuerySyncEvaluationStateInput,
} from "../src/deploymentSync/Store";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);

interface SqliteHarness {
  readonly database: DatabaseSync;
  readonly storage: DeploymentQuerySyncStorage;
}

describe("deployment query-sync C1 state", () => {
  it("validates the named binding before storage readiness", async () => {
    let transactions = 0;
    let statements = 0;
    const exit = await Effect.runPromiseExit(makeDeploymentQuerySyncEvaluationState({
      binding: { objectId: Object.freeze({}), observation: observation() },
      storage: {
        sql: {
          exec: () => {
            statements += 1;
            throw new Error("Storage must not be inspected.");
          },
        },
        transactionSync: <A>(closure: () => A): A => {
          transactions += 1;
          return closure();
        },
      },
    }));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(transactions).toBe(0);
    expect(statements).toBe(0);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
        _tag: "DeploymentQuerySyncBindingError",
        reason: "objectNameMissing",
      });
    }
  });

  it("initializes, begins idempotently, and advances an empty exact batch", async () => {
    const harness = makeSqliteHarness();
    try {
      const input = stateInput(harness, true);
      const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState(input));
      const binding = success(captureDeploymentQuerySyncBinding(input.binding));

      const initialized = await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      expect(initialized._tag).toBe("initialized");
      expect(Object.isFrozen(initialized)).toBe(true);

      const request = Object.freeze({
        target: success(captureQueryOperationTarget({
          namespaceId: binding.namespaceId,
          syncModelId: binding.syncModelId,
          sourceEpoch: binding.sourceEpoch,
          descriptor: success(captureQueryDescriptor({
            queryKey: Encoding.encodeBase64Url(new Uint8Array(32).fill(7)),
            queryIdentity: Encoding.encodeBase64Url("query-a"),
          })),
        })),
        expectedActiveGeneration: null,
        requestedDirtyThroughSequence: null,
      });
      const created = await Effect.runPromise(state.beginQueryEvaluation(request));
      const replayed = await Effect.runPromise(state.beginQueryEvaluation(request));
      expect(created._tag).toBe("created");
      expect(replayed._tag).toBe("replayed");

      const applied = await Effect.runPromise(
        state.applyAdmittedBatchAndAdvance(success(
          captureAdmittedInvalidationBatch({
            namespaceId: binding.namespaceId,
            syncModelId: binding.syncModelId,
            sourceEpoch: binding.sourceEpoch,
            sourceSequence: 12n,
            dependencyKeys: [],
          }),
        )),
      );
      expect(applied).toMatchObject({
        _tag: "applied",
        appliedSequence: 12n,
        affectedQueryKeys: [],
      });
      expect(harness.database.prepare(`SELECT
        applied_through_sequence AS sequence,
        query_count AS queryCount
        FROM deployment_sync_scope_state`).get()).toEqual({
        sequence: "12",
        queryCount: 1,
      });
    } finally {
      harness.database.close();
    }
  });

  it("rejects an unauthenticated bootstrap frontier and preserves fresh authority", async () => {
    const harness = makeSqliteHarness();
    try {
      const input = stateInput(harness, true);
      const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState(input));
      const binding = success(captureDeploymentQuerySyncBinding(input.binding));
      const untrustedCursor = success(captureNamespaceCursor({
        ...binding.bootstrapCursor,
        appliedThroughSequence:
          binding.bootstrapCursor.appliedThroughSequence + 1n,
      }));

      const rejected = await Effect.runPromiseExit(
        state.initializeOrInspectNamespace(untrustedCursor),
      );
      expect(Exit.isFailure(rejected)).toBe(true);
      if (Exit.isFailure(rejected)) {
        expect(Option.getOrThrow(
          Cause.findErrorOption(rejected.cause),
        )).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          operation: "initializeOrInspectNamespace",
          reason: "bootstrapBindingMismatch",
        });
      }
      expect(harness.database.prepare(`SELECT
        durable_initialized_history AS history
        FROM deployment_sync_contract_state`).get()).toEqual({ history: 0 });
      expect(harness.database.prepare(`SELECT count(*) AS count
        FROM deployment_sync_scope_state`).get()).toEqual({ count: 0 });

      await expect(Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      )).resolves.toMatchObject({ _tag: "initialized" });
    } finally {
      harness.database.close();
    }
  });

  it("releases a fresh capability after rollback and consumes it after commit", async () => {
    const harness = makeSqliteHarness();
    try {
      const input = stateInput(harness, true);
      const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState(input));
      const binding = success(captureDeploymentQuerySyncBinding(input.binding));
      harness.database.exec(`CREATE TRIGGER deployment_sync_test_reject_scope
        BEFORE INSERT ON deployment_sync_scope_state
        BEGIN
          SELECT RAISE(FAIL, 'forced rollback');
        END`);

      const failed = await Effect.runPromiseExit(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      expect(Exit.isFailure(failed) && Cause.hasDies(failed.cause)).toBe(true);
      harness.database.exec("DROP TRIGGER deployment_sync_test_reject_scope");

      const retried = await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      const existing = await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      expect(retried._tag).toBe("initialized");
      expect(existing._tag).toBe("existing");
    } finally {
      harness.database.close();
    }
  });

  it("snapshots the owned SQL handle once and preserves the transaction receiver", async () => {
    const harness = makeSqliteHarness();
    try {
      const input = stateInput(harness, true);
      let sqlReads = 0;
      const transactionReceivers: unknown[] = [];
      const storage: DeploymentQuerySyncStorage = {
        get sql() {
          sqlReads += 1;
          return harness.storage.sql;
        },
        transactionSync<A>(
          this: DeploymentQuerySyncStorage,
          closure: () => A,
        ): A {
          transactionReceivers.push(this);
          return harness.storage.transactionSync(closure);
        },
      };
      const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState({
        ...input,
        storage,
      }));
      const binding = success(captureDeploymentQuerySyncBinding(input.binding));

      await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );

      expect(sqlReads).toBe(1);
      expect(transactionReceivers.length).toBe(3);
      expect(transactionReceivers.every(receiver => receiver === storage)).toBe(
        true,
      );
    } finally {
      harness.database.close();
    }
  });

  it("rejects a present query row when the scope query count is zero", async () => {
    const harness = makeSqliteHarness();
    try {
      const input = stateInput(harness, true);
      const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState(input));
      const binding = success(captureDeploymentQuerySyncBinding(input.binding));
      await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      const request = beginRequest(binding, 7);
      await Effect.runPromise(state.beginQueryEvaluation(request));
      harness.database.exec(`UPDATE deployment_sync_scope_state
        SET query_count = 0
        WHERE singleton = 1`);

      const exit = await Effect.runPromiseExit(
        state.beginQueryEvaluation(request),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Option.getOrThrow(
          Cause.findErrorOption(exit.cause),
        );
        expect(error).toMatchObject({
          _tag: "QuerySyncStoredStateCorruptError",
          operation: "beginQueryEvaluation",
          reason: "storedAggregateInvalid",
        });
        expect(errorCause(error)).toMatchObject({
          _tag: "DeploymentQuerySyncStoredStateIssue",
          reason: "scopeCounterMismatch",
          evidence: {
            counter: "queryCount",
            expected: "positiveWhenQueryRowPresent",
            observed: 0,
          },
        });
      }
    } finally {
      harness.database.close();
    }
  });

  it("rejects affected targets when the dependency-membership count is zero", async () => {
    const harness = makeSqliteHarness();
    try {
      const input = stateInput(harness, true);
      const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState(input));
      const binding = success(captureDeploymentQuerySyncBinding(input.binding));
      await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      const dependencyKey = Encoding.encodeBase64Url("dependency-a");
      const queryKey = Encoding.encodeBase64Url(new Uint8Array(32).fill(8));
      harness.database.exec(`UPDATE deployment_sync_scope_state
        SET query_count = 1
        WHERE singleton = 1`);
      harness.database.prepare(`INSERT INTO
        deployment_sync_query_dependencies (
          role,
          query_key,
          generation,
          dependency_key
        ) VALUES ('active', ?, '1', ?)`).run(queryKey, dependencyKey);

      const exit = await Effect.runPromiseExit(
        state.applyAdmittedBatchAndAdvance(
          admittedBatch(binding, [dependencyKey]),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Option.getOrThrow(
          Cause.findErrorOption(exit.cause),
        );
        expect(error).toMatchObject({
          _tag: "QuerySyncStoredStateCorruptError",
          operation: "applyAdmittedBatchAndAdvance",
          reason: "storedAggregateInvalid",
        });
        expect(errorCause(error)).toMatchObject({
          _tag: "DeploymentQuerySyncStoredStateIssue",
          reason: "scopeCounterMismatch",
          evidence: {
            counter: "dependencyMemberships",
            expectedAtLeast: 1,
            observed: 0,
            distinctAffectedTargets: 1,
          },
        });
      }
    } finally {
      harness.database.close();
    }
  });

  it("rejects more distinct affected targets than the scope query count", async () => {
    const harness = makeSqliteHarness();
    try {
      const input = stateInput(harness, true);
      const state = await Effect.runPromise(makeDeploymentQuerySyncEvaluationState(input));
      const binding = success(captureDeploymentQuerySyncBinding(input.binding));
      await Effect.runPromise(
        state.initializeOrInspectNamespace(binding.bootstrapCursor),
      );
      const dependencyKey = Encoding.encodeBase64Url("dependency-b");
      const queryKeys = [
        Encoding.encodeBase64Url(new Uint8Array(32).fill(9)),
        Encoding.encodeBase64Url(new Uint8Array(32).fill(10)),
      ] as const;
      harness.database.exec(`UPDATE deployment_sync_scope_state
        SET query_count = 1, dependency_memberships = 2
        WHERE singleton = 1`);
      const insert = harness.database.prepare(`INSERT INTO
        deployment_sync_query_dependencies (
          role,
          query_key,
          generation,
          dependency_key
        ) VALUES ('active', ?, '1', ?)`);
      for (const queryKey of queryKeys) insert.run(queryKey, dependencyKey);

      const exit = await Effect.runPromiseExit(
        state.applyAdmittedBatchAndAdvance(
          admittedBatch(binding, [dependencyKey]),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Option.getOrThrow(
          Cause.findErrorOption(exit.cause),
        );
        expect(error).toMatchObject({
          _tag: "QuerySyncStoredStateCorruptError",
          operation: "applyAdmittedBatchAndAdvance",
          reason: "storedAggregateInvalid",
        });
        expect(errorCause(error)).toMatchObject({
          _tag: "DeploymentQuerySyncStoredStateIssue",
          reason: "scopeCounterMismatch",
          evidence: {
            counter: "queryCount",
            expectedAtLeast: 2,
            observed: 1,
            distinctAffectedTargets: 2,
          },
        });
      }
    } finally {
      harness.database.close();
    }
  });
});

function observation() {
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(7n),
    observedAtCommitSeq: CommitSeqSchema.make(11n),
    activationSequence: ApplicationActivationSequenceV1Schema.make(1n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "ab".repeat(32),
    ),
  });
}

function beginRequest(binding: DeploymentQuerySyncBinding, fill: number) {
  return Object.freeze({
    target: success(captureQueryOperationTarget({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      descriptor: success(captureQueryDescriptor({
        queryKey: Encoding.encodeBase64Url(new Uint8Array(32).fill(fill)),
        queryIdentity: Encoding.encodeBase64Url(`query-${fill}`),
      })),
    })),
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  });
}

function admittedBatch(
  binding: DeploymentQuerySyncBinding,
  dependencyKeys: readonly string[],
) {
  return success(captureAdmittedInvalidationBatch({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    sourceSequence: 12n,
    dependencyKeys,
  }));
}

function stateInput(
  harness: SqliteHarness,
  authorizedFresh: boolean,
): DeploymentQuerySyncEvaluationStateInput {
  const binding = Object.freeze({
    objectId: Object.freeze({ name: `deployment-sync:${scopeUuid}` }),
    observation: observation(),
  });
  const capability = authorizedFresh
    ? makeDeploymentQuerySyncFreshInitializationCapabilityForTest(
      success(captureDeploymentQuerySyncBinding(binding)),
    )
    : undefined;
  return capability === undefined
    ? Object.freeze({ binding, storage: harness.storage })
    : Object.freeze({
      binding,
      storage: harness.storage,
      freshInitializationCapability: capability,
    });
}

function emptyRawRows<Row extends SqlStorageValue[]>(): IterableIterator<Row> {
  return (function* () {})();
}

function cursorFor<T extends Record<string, SqlStorageValue>>(
  rows: T[],
  rowsWritten: number,
): SqlStorageCursor<T> {
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

function makeSqliteHarness(): SqliteHarness {
  const database = new DatabaseSync(":memory:");
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    T extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<T> => {
    // SAFETY: production row codecs validate the unknown SQLite values; this
    // test adapter only restores the caller-selected cursor row generic.
    const rows = database.prepare(query).all(...bindings) as T[];
    const writes = /^(?:INSERT|UPDATE|DELETE)\b/i.test(query.trimStart())
      ? rows.length
      : 0;
    return cursorFor(rows, writes);
  };
  return {
    database,
    storage: {
      sql: { exec },
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
    },
  };
}

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}

function errorCause(error: unknown): unknown {
  if (!(error instanceof Error)) {
    throw new Error("Expected a deployment query-sync Error value.");
  }
  return error.cause;
}
