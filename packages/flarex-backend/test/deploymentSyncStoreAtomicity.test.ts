import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  captureAdmittedInvalidationBatch,
  captureCanonicalDependencyKey,
  captureNamespaceCursor,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryOperationTarget,
  captureQueryPublicationArtifact,
  captureSyncEpoch,
  captureSyncModelId,
  createEmptyQuerySyncState,
  type BeginQueryEvaluationRequest,
  type QueryDescriptor,
  type QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  createReferenceModel,
  deriveGenerationRefreshEvidence,
  reduceReferenceModel,
} from "@flarex/query-sync/testing/reference-model";
import { isNonArrayRecord } from "@flarex/utils/records";
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
  type ScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
  type ScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";

import {
  captureDeploymentQuerySyncBinding,
  makeDeploymentQuerySyncFreshInitializationCapabilityForTest,
  type DeploymentQuerySyncBinding,
  type DeploymentQuerySyncBindingInput,
} from "../src/deploymentSync/Binding";
import {
  encodeDeploymentQuerySyncDependencyRow,
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
  type DeploymentQuerySyncStoredScopeState,
  type EncodedDeploymentQuerySyncDependencyRow,
  type EncodedDeploymentQuerySyncQueryRow,
  type EncodedDeploymentQuerySyncScopeRow,
} from "../src/deploymentSync/RowCodec";
import {
  makeDeploymentQuerySyncStateC1,
  type DeploymentQuerySyncStateC1,
  type DeploymentQuerySyncStateC1Input,
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
const staleEpochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000003",
);

interface SqlEvent {
  readonly sql: string;
  readonly isWrite: boolean;
  readonly rowsWritten: number;
}

type SqlFault =
  | Readonly<{
    readonly _tag: "throwAfter";
    readonly fragment: string;
    readonly defect: Error;
  }>
  | Readonly<{
    readonly _tag: "mutateAfter";
    readonly fragment: string;
    readonly mutate: (database: DatabaseSync) => void;
  }>;

interface SqliteHarness {
  readonly database: DatabaseSync;
  readonly storage: DeploymentQuerySyncStorage;
  readonly events: SqlEvent[];
  readonly resetEvents: () => void;
  readonly armSqlFault: (fault: SqlFault) => void;
  readonly loseNextTransactionResponse: (defect: Error) => void;
  readonly readLostTransactionResponse: () => unknown;
}

class InjectedSqlDefect extends Error {}
class InjectedResponseLossDefect extends Error {}

describe("deployment query-sync C1 SQLite atomicity", () => {
  it("rejects bootstrap cursors both ahead of and behind trusted sequence while preserving the fresh capability", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareState(harness, true);
      for (const delta of [-1n, 1n]) {
        const untrusted = success(captureNamespaceCursor({
          ...prepared.binding.bootstrapCursor,
          appliedThroughSequence:
            prepared.binding.bootstrapCursor.appliedThroughSequence + delta,
        }));
        const exit = await runNoEnvironmentExit(
          prepared.state.initializeOrInspectNamespace(untrusted),
        );

        expectTypedFailure(exit, {
          _tag: "QuerySyncStoredStateIncompatibleError",
          operation: "initializeOrInspectNamespace",
          reason: "bootstrapBindingMismatch",
        });
        expect(readScopeCount(harness.database)).toBe(0);
        expect(readInitializedHistory(harness.database)).toBe(0);
      }

      await expect(Effect.runPromise(
        prepared.state.initializeOrInspectNamespace(
          prepared.binding.bootstrapCursor,
        ),
      )).resolves.toMatchObject({ _tag: "initialized" });
      expect(readScopeCount(harness.database)).toBe(1);
      expect(readInitializedHistory(harness.database)).toBe(1);
    } finally {
      harness.database.close();
    }
  });

  it("returns existing, modelReplaced, and epochReplaced without semantic writes", async () => {
    const cases = [
      {
        expectedTag: "existing",
        makeCursor: (binding: DeploymentQuerySyncBinding) =>
          binding.bootstrapCursor,
        storedEpoch: epochUuid,
      },
      {
        expectedTag: "modelReplaced",
        makeCursor: (binding: DeploymentQuerySyncBinding) => success(
          captureNamespaceCursor({
            ...binding.bootstrapCursor,
            syncModelId: success(captureSyncModelId("retired-model")),
          }),
        ),
        storedEpoch: epochUuid,
      },
      {
        expectedTag: "epochReplaced",
        makeCursor: (binding: DeploymentQuerySyncBinding) => success(
          captureNamespaceCursor({
            ...binding.bootstrapCursor,
            sourceEpoch: success(captureSyncEpoch(staleEpochUuid)),
          }),
        ),
        storedEpoch: staleEpochUuid,
      },
    ] as const;

    for (const scenario of cases) {
      const harness = makeSqliteHarness();
      try {
        const prepared = await prepareState(harness, false);
        const stored = success(createEmptyQuerySyncState(
          scenario.makeCursor(prepared.binding),
        ));
        seedC1ReadableState(
          harness.database,
          prepared.binding,
          stored,
          scenario.storedEpoch,
        );
        harness.resetEvents();

        const receipt = await Effect.runPromise(
          prepared.state.initializeOrInspectNamespace(
            prepared.binding.bootstrapCursor,
          ),
        );

        expect(receipt._tag).toBe(scenario.expectedTag);
        expect(writeEvents(harness)).toEqual([]);
      } finally {
        harness.database.close();
      }
    }
  });

  it("reports a missing scope after durable initialization history as typed corruption", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareState(harness, false);
      harness.database.prepare(`UPDATE deployment_sync_contract_state
        SET durable_initialized_history = 1
        WHERE singleton = 1`).run();
      harness.resetEvents();

      const exit = await runNoEnvironmentExit(
        prepared.state.initializeOrInspectNamespace(
          prepared.binding.bootstrapCursor,
        ),
      );

      expectTypedFailure(exit, {
        _tag: "QuerySyncStoredStateCorruptError",
        operation: "initializeOrInspectNamespace",
        reason: "aggregateMissing",
      });
      expect(writeEvents(harness)).toEqual([]);
    } finally {
      harness.database.close();
    }
  });

  it("preserves the first query when a second identity collides on its key", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareInitializedState(harness);
      const original = queryDescriptor(1, "query-original");
      const collision = queryDescriptor(1, "query-collision");
      const originalRequest = beginRequest(prepared.binding, original);
      await expect(Effect.runPromise(
        prepared.state.beginQueryEvaluation(originalRequest),
      )).resolves.toMatchObject({ _tag: "created" });
      const before = semanticSnapshot(harness.database);
      harness.resetEvents();

      const exit = await runNoEnvironmentExit(
        prepared.state.beginQueryEvaluation(
          beginRequest(prepared.binding, collision),
        ),
      );

      expectTypedFailure(exit, {
        _tag: "QueryKeyCollisionError",
        operation: "beginQueryEvaluation",
        queryKey: original.queryKey,
      });
      expect(semanticSnapshot(harness.database)).toEqual(before);
      expect(writeEvents(harness)).toEqual([]);
    } finally {
      harness.database.close();
    }
  });

  it("rolls back begin after query DML and after a real scope CAS miss", async () => {
    const scenarios = ["afterQueryDml", "scopeCasMiss"] as const;
    for (const scenario of scenarios) {
      const harness = makeSqliteHarness();
      try {
        const prepared = await prepareInitializedState(harness);
        const request = beginRequest(
          prepared.binding,
          queryDescriptor(scenario === "afterQueryDml" ? 2 : 3, scenario),
        );
        const before = semanticSnapshot(harness.database);
        harness.resetEvents();
        if (scenario === "afterQueryDml") {
          harness.armSqlFault({
            _tag: "throwAfter",
            fragment: "insert into main.deployment_sync_queries",
            defect: new InjectedSqlDefect("after query DML"),
          });
        } else {
          harness.armSqlFault({
            _tag: "mutateAfter",
            fragment: "insert into main.deployment_sync_queries",
            mutate: database => {
              database.prepare(`UPDATE deployment_sync_scope_state
                SET evaluation_work_revision = '99'
                WHERE singleton = 1`).run();
            },
          });
        }

        const exit = await runNoEnvironmentExit(
          prepared.state.beginQueryEvaluation(request),
        );

        expectDefect(exit);
        expect(semanticSnapshot(harness.database)).toEqual(before);
        expect(harness.events.some(event => event.sql.includes(
          "insert into main.deployment_sync_queries",
        ))).toBe(true);
        if (scenario === "scopeCasMiss") {
          expect(harness.events).toContainEqual(expect.objectContaining({
            sql: expect.stringContaining(
              "update main.deployment_sync_scope_state set",
            ),
            rowsWritten: 0,
          }));
        }

        await expect(Effect.runPromise(
          prepared.state.beginQueryEvaluation(request),
        )).resolves.toMatchObject({ _tag: "created" });
      } finally {
        harness.database.close();
      }
    }
  });

  it("returns duplicate, gap, and reset without dependency-table reads or writes", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareInitializedState(harness);
      const scenarios = [
        {
          expectedTag: "duplicate",
          batch: admittedBatch(prepared.binding, 11n, []),
        },
        {
          expectedTag: "gap",
          batch: admittedBatch(prepared.binding, 13n, []),
        },
        {
          expectedTag: "resetRequired",
          batch: admittedBatch(
            prepared.binding,
            12n,
            [],
            success(captureSyncEpoch(staleEpochUuid)),
          ),
        },
      ] as const;

      for (const scenario of scenarios) {
        harness.resetEvents();
        const receipt = await Effect.runPromise(
          prepared.state.applyAdmittedBatchAndAdvance(scenario.batch),
        );
        expect(receipt._tag).toBe(scenario.expectedTag);
        expect(harness.events.some(event => event.sql.includes(
          "deployment_sync_query_dependencies",
        ))).toBe(false);
        expect(writeEvents(harness)).toEqual([]);
      }
    } finally {
      harness.database.close();
    }
  });

  it("rolls back an exact-next zero-target apply before exposing its receipt", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareInitializedState(harness);
      const batch = admittedBatch(
        prepared.binding,
        12n,
        [dependencyKey("unmatched")],
      );
      const before = semanticSnapshot(harness.database);
      harness.resetEvents();
      harness.armSqlFault({
        _tag: "throwAfter",
        fragment: "update main.deployment_sync_scope_state set",
        defect: new InjectedSqlDefect("after zero-target scope DML"),
      });

      const exit = await runNoEnvironmentExit(
        prepared.state.applyAdmittedBatchAndAdvance(batch),
      );

      expectDefect(exit);
      expect(semanticSnapshot(harness.database)).toEqual(before);
      expect(harness.events.some(event => event.sql.includes(
        "deployment_sync_query_dependencies",
      ))).toBe(true);

      await expect(Effect.runPromise(
        prepared.state.applyAdmittedBatchAndAdvance(batch),
      )).resolves.toMatchObject({
        _tag: "applied",
        appliedSequence: 12n,
        affectedQueryKeys: [],
      });
    } finally {
      harness.database.close();
    }
  });

  it("rolls back an active-target apply after target DML and retries atomically", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareState(harness, false);
      const descriptor = queryDescriptor(4, "active-query");
      const dependency = dependencyKey("active-target");
      const reference = makeActiveReferenceState(
        prepared.binding,
        descriptor,
        dependency,
      );
      seedC1ReadableState(
        harness.database,
        prepared.binding,
        reference,
        prepared.binding.epochUuid,
      );
      const batch = admittedBatch(
        prepared.binding,
        12n,
        [dependency],
      );
      const before = semanticSnapshot(harness.database);
      harness.resetEvents();
      harness.armSqlFault({
        _tag: "throwAfter",
        fragment:
          "update main.deployment_sync_queries set active_dirty_through_sequence",
        defect: new InjectedSqlDefect("after affected-target DML"),
      });

      const exit = await runNoEnvironmentExit(
        prepared.state.applyAdmittedBatchAndAdvance(batch),
      );

      expectDefect(exit);
      expect(semanticSnapshot(harness.database)).toEqual(before);
      expect(harness.events.some(event => event.sql.includes(
        "update main.deployment_sync_scope_state set",
      ))).toBe(false);

      const retried = await Effect.runPromise(
        prepared.state.applyAdmittedBatchAndAdvance(batch),
      );
      expect(retried).toMatchObject({
        _tag: "applied",
        appliedSequence: 12n,
        affectedQueryKeys: [descriptor.queryKey],
      });
      expect(harness.database.prepare(`SELECT
        active_dirty_through_sequence AS dirty
        FROM deployment_sync_queries
        WHERE query_key = ?`).get(descriptor.queryKey)).toEqual({
        dirty: "12",
      });
      expect(readAppliedSequence(harness.database)).toBe("12");
    } finally {
      harness.database.close();
    }
  });

  it("replays a committed begin after response loss without another write", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareInitializedState(harness);
      const request = beginRequest(
        prepared.binding,
        queryDescriptor(5, "response-loss"),
      );
      harness.resetEvents();
      harness.loseNextTransactionResponse(
        new InjectedResponseLossDefect("committed response lost"),
      );

      const lostExit = await runNoEnvironmentExit(
        prepared.state.beginQueryEvaluation(request),
      );

      expectDefect(lostExit);
      const lostResponse = harness.readLostTransactionResponse();
      if (
        !isNonArrayRecord(lostResponse)
        || lostResponse._tag !== "created"
        || !isNonArrayRecord(lostResponse.attempt)
      ) {
        throw new Error("Expected the committed created receipt to be captured.");
      }
      expect(writeEvents(harness)).toHaveLength(2);
      expect(readQueryCount(harness.database)).toBe(1);

      harness.resetEvents();
      const replayed = await Effect.runPromise(
        prepared.state.beginQueryEvaluation(request),
      );
      if (replayed._tag !== "replayed") {
        throw new Error(`Expected replayed receipt, received ${replayed._tag}.`);
      }
      expect(replayed.attempt).toEqual(lostResponse.attempt);
      expect(writeEvents(harness)).toEqual([]);
      expect(readQueryCount(harness.database)).toBe(1);
    } finally {
      harness.database.close();
    }
  });

  it("keeps expected failures typed, foreign SQLite faults defective, and requires no Effect environment", async () => {
    const harness = makeSqliteHarness();
    try {
      const prepared = await prepareState(harness, false);
      const typed = await runNoEnvironmentExit(
        prepared.state.initializeOrInspectNamespace(
          prepared.binding.bootstrapCursor,
        ),
      );
      expectTypedFailure(typed, {
        _tag: "QuerySyncStoredStateIncompatibleError",
        operation: "initializeOrInspectNamespace",
        reason: "bootstrapBindingMismatch",
      });

      harness.armSqlFault({
        _tag: "throwAfter",
        fragment: "from main.deployment_sync_contract_state",
        defect: new InjectedSqlDefect("foreign SQLite failure"),
      });
      const defective = await runNoEnvironmentExit(
        prepared.state.initializeOrInspectNamespace(
          prepared.binding.bootstrapCursor,
        ),
      );
      expectDefect(defective);
    } finally {
      harness.database.close();
    }
  });
});

function observation(
  selectedEpoch: ScopeEpochUuidV1 = epochUuid,
): ScopeSyncActiveHeadObservationV1 {
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid: selectedEpoch,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(7n),
    observedAtCommitSeq: CommitSeqSchema.make(11n),
    activationSequence: ApplicationActivationSequenceV1Schema.make(1n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "ab".repeat(32),
    ),
  });
}

function bindingInput(): DeploymentQuerySyncBindingInput {
  return Object.freeze({
    objectId: Object.freeze({ name: `deployment-sync:${scopeUuid}` }),
    observation: observation(),
  });
}

async function prepareState(
  harness: SqliteHarness,
  authorizedFresh: boolean,
): Promise<Readonly<{
  readonly state: DeploymentQuerySyncStateC1;
  readonly binding: DeploymentQuerySyncBinding;
}>> {
  const inputBinding = bindingInput();
  const binding = success(captureDeploymentQuerySyncBinding(inputBinding));
  const capability = authorizedFresh
    ? makeDeploymentQuerySyncFreshInitializationCapabilityForTest(binding)
    : undefined;
  const base = Object.freeze({
    binding: inputBinding,
    storage: harness.storage,
  });
  const input: DeploymentQuerySyncStateC1Input = capability === undefined
    ? base
    : Object.freeze({
      ...base,
      freshInitializationCapability: capability,
    });
  const state = await Effect.runPromise(makeDeploymentQuerySyncStateC1(input));
  return Object.freeze({ state, binding });
}

async function prepareInitializedState(
  harness: SqliteHarness,
): Promise<Readonly<{
  readonly state: DeploymentQuerySyncStateC1;
  readonly binding: DeploymentQuerySyncBinding;
}>> {
  const prepared = await prepareState(harness, true);
  const receipt = await Effect.runPromise(
    prepared.state.initializeOrInspectNamespace(
      prepared.binding.bootstrapCursor,
    ),
  );
  if (receipt._tag !== "initialized") {
    throw new Error(`Expected initialized receipt, received ${receipt._tag}.`);
  }
  return prepared;
}

function queryDescriptor(seed: number, identity: string): QueryDescriptor {
  return success(captureQueryDescriptor({
    queryKey: canonicalKey(seed),
    queryIdentity: Encoding.encodeBase64Url(identity),
  }));
}

function canonicalKey(seed: number): string {
  return Encoding.encodeBase64Url(Uint8Array.from(
    { length: 32 },
    (_value, index) => (seed + index) % 256,
  ));
}

function dependencyKey(label: string) {
  return success(captureCanonicalDependencyKey(
    Encoding.encodeBase64Url(`dependency:${label}`),
  ));
}

function beginRequest(
  binding: DeploymentQuerySyncBinding,
  descriptor: QueryDescriptor,
): BeginQueryEvaluationRequest {
  return Object.freeze({
    target: success(captureQueryOperationTarget({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      descriptor,
    })),
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  });
}

function admittedBatch(
  binding: DeploymentQuerySyncBinding,
  sequence: bigint,
  dependencies: readonly string[],
  sourceEpoch = binding.sourceEpoch,
) {
  return success(captureAdmittedInvalidationBatch({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch,
    sourceSequence: sequence,
    dependencyKeys: dependencies,
  }));
}

function makeActiveReferenceState(
  binding: DeploymentQuerySyncBinding,
  descriptor: QueryDescriptor,
  dependency: ReturnType<typeof dependencyKey>,
): QuerySyncState {
  const initial = success(createReferenceModel(binding.bootstrapCursor));
  const begun = success(reduceReferenceModel(initial, Object.freeze({
    _tag: "beginQueryEvaluation",
    request: beginRequest(binding, descriptor),
  })));
  if (begun.decision._tag !== "created") {
    throw new Error("Expected the reference query to be created.");
  }
  const attempt = begun.decision.attempt;
  const evaluation = success(captureQueryEvaluationEvidence({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    descriptor,
    generation: attempt.generation,
    snapshotSequence: attempt.registrationCursor.appliedThroughSequence,
    resultDigest: canonicalKey(80),
    authorityWitness: canonicalKey(90),
    dependencyKeys: [dependency],
  }));
  const refresh = success(deriveGenerationRefreshEvidence(
    evaluation,
    attempt.registrationCursor,
    [],
    evaluation.authorityWitness,
  ));
  const completed = success(reduceReferenceModel(
    begun.model,
    Object.freeze({
      _tag: "completeQueryEvaluation",
      attempt,
      evaluation,
      refresh,
      publication: success(captureQueryPublicationArtifact({
        content: Encoding.encodeBase64Url("active-result"),
      })),
    }),
  ));
  if (completed.decision._tag !== "completed") {
    throw new Error("Expected the reference query to become active.");
  }
  return completed.model.state;
}

function seedC1ReadableState(
  database: DatabaseSync,
  binding: DeploymentQuerySyncBinding,
  state: QuerySyncState,
  storedEpochUuid: ScopeEpochUuidV1,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM deployment_sync_query_dependencies");
    database.exec("DELETE FROM deployment_sync_queries");
    database.exec("DELETE FROM deployment_sync_scope_state");
    database.prepare(`UPDATE deployment_sync_contract_state
      SET durable_initialized_history = 1
      WHERE singleton = 1`).run();
    const storedScope: DeploymentQuerySyncStoredScopeState = Object.freeze({
      scopeUuid: binding.scopeUuid,
      epochUuid: storedEpochUuid,
      storageGeneration: binding.storageGeneration,
      storageGenerationFence: binding.storageGenerationFence,
      syncModelId: state.cursor.syncModelId,
      facts: Object.freeze({
        cursor: state.cursor,
        evaluationWork: state.evaluationWork,
        metrics: state.metrics,
      }),
    });
    insertEncodedRow(
      database,
      "deployment_sync_scope_state",
      encodeDeploymentQuerySyncScopeRow(storedScope),
    );
    for (const query of state.queries) {
      insertEncodedRow(
        database,
        "deployment_sync_queries",
        encodeDeploymentQuerySyncQueryRow(Object.freeze({
          descriptor: query.descriptor,
          active: query.active,
          provisional: query.provisional,
        })),
      );
      if (query.active === null) continue;
      for (const dependency of query.active.dependencyKeys) {
        insertEncodedRow(
          database,
          "deployment_sync_query_dependencies",
          encodeDeploymentQuerySyncDependencyRow(Object.freeze({
            role: "active",
            queryKey: query.descriptor.queryKey,
            generation: query.active.generation,
            dependencyKey: dependency,
          })),
        );
      }
    }
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
}

type SeedTable =
  | "deployment_sync_scope_state"
  | "deployment_sync_queries"
  | "deployment_sync_query_dependencies";

type DeploymentQuerySyncSeedRow =
  | EncodedDeploymentQuerySyncScopeRow
  | EncodedDeploymentQuerySyncQueryRow
  | EncodedDeploymentQuerySyncDependencyRow;

function insertEncodedRow(
  database: DatabaseSync,
  table: SeedTable,
  row: DeploymentQuerySyncSeedRow,
): void {
  const columns = Object.keys(row);
  const values = Object.values(row).map(sqlInputValue);
  database.prepare(`INSERT INTO ${table} (
    ${columns.join(", ")}
  ) VALUES (${columns.map(() => "?").join(", ")})`).run(...values);
}

function sqlInputValue(value: unknown): SQLInputValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "bigint"
    || value instanceof Uint8Array
  ) {
    return value;
  }
  throw new Error("Fixture encoder produced an unsupported SQLite value.");
}

function makeSqliteHarness(): SqliteHarness {
  const database = new DatabaseSync(":memory:");
  const events: SqlEvent[] = [];
  let sqlFault: SqlFault | null = null;
  let responseLossDefect: Error | null = null;
  let lostTransactionResponse: unknown;
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    Row extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<Row> => {
    const normalized = normalizeSql(query);
    const write = /^(?:insert|update|delete)\b/.test(normalized);
    // SAFETY: the production contract deliberately exposes a caller-selected
    // row generic. Production codecs validate every value after this Node-only
    // test adapter restores that generic from SQLite's unknown row boundary.
    const rows = database.prepare(query).all(...bindings) as Row[];
    const rowsWritten = write ? rows.length : 0;
    events.push(Object.freeze({
      sql: normalized,
      isWrite: write,
      rowsWritten,
    }));
    const fault = sqlFault;
    if (fault !== null && normalized.includes(fault.fragment)) {
      sqlFault = null;
      if (fault._tag === "throwAfter") throw fault.defect;
      fault.mutate(database);
    }
    return cursorFor(rows, rowsWritten);
  };
  const storage: DeploymentQuerySyncStorage = Object.freeze({
    sql: Object.freeze({ exec }),
    transactionSync: <A>(closure: () => A): A => {
      database.exec("BEGIN IMMEDIATE");
      let committed = false;
      try {
        const value = closure();
        database.exec("COMMIT");
        committed = true;
        if (responseLossDefect !== null) {
          const defect = responseLossDefect;
          responseLossDefect = null;
          lostTransactionResponse = value;
          throw defect;
        }
        return value;
      } catch (cause) {
        if (!committed) database.exec("ROLLBACK");
        throw cause;
      }
    },
  });
  return {
    database,
    storage,
    events,
    resetEvents: () => {
      events.length = 0;
    },
    armSqlFault: fault => {
      if (sqlFault !== null) throw new Error("A SQL fault is already armed.");
      sqlFault = Object.freeze({
        ...fault,
        fragment: normalizeSql(fault.fragment),
      });
    },
    loseNextTransactionResponse: defect => {
      if (responseLossDefect !== null) {
        throw new Error("A response-loss fault is already armed.");
      }
      responseLossDefect = defect;
    },
    readLostTransactionResponse: () => lostTransactionResponse,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function emptyRawRows<Row extends SqlStorageValue[]>(): IterableIterator<Row> {
  return (function* () {})();
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

function semanticSnapshot(database: DatabaseSync) {
  return Object.freeze({
    contract: database.prepare(`SELECT *
      FROM deployment_sync_contract_state
      ORDER BY singleton`).all(),
    scope: database.prepare(`SELECT *
      FROM deployment_sync_scope_state
      ORDER BY singleton`).all(),
    queries: database.prepare(`SELECT *
      FROM deployment_sync_queries
      ORDER BY query_key`).all(),
    dependencies: database.prepare(`SELECT *
      FROM deployment_sync_query_dependencies
      ORDER BY query_key, role, generation, dependency_key`).all(),
  });
}

function writeEvents(harness: SqliteHarness): readonly SqlEvent[] {
  return harness.events.filter(event => event.isWrite);
}

function readScopeCount(database: DatabaseSync): number {
  const row = database.prepare(`SELECT count(*) AS value
    FROM deployment_sync_scope_state`).get();
  return Number(row?.value);
}

function readQueryCount(database: DatabaseSync): number {
  const row = database.prepare(`SELECT count(*) AS value
    FROM deployment_sync_queries`).get();
  return Number(row?.value);
}

function readInitializedHistory(database: DatabaseSync): number {
  const row = database.prepare(`SELECT durable_initialized_history AS value
    FROM deployment_sync_contract_state
    WHERE singleton = 1`).get();
  return Number(row?.value);
}

function readAppliedSequence(database: DatabaseSync): string {
  const row = database.prepare(`SELECT applied_through_sequence AS value
    FROM deployment_sync_scope_state
    WHERE singleton = 1`).get();
  return String(row?.value);
}

function runNoEnvironmentExit<A, E>(
  effect: Effect.Effect<A, E, never>,
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  shape: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected typed Effect failure.");
  }
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject(
    shape,
  );
}

function expectDefect<A, E>(exit: Exit.Exit<A, E>): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(Cause.findErrorOption(exit.cause)).toEqual(Option.none());
}

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}
