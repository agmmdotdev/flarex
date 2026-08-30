import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import {
  buildQuerySyncState,
  captureAdmittedInvalidationBatch,
  captureCanonicalDependencyKey,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  compareCanonicalBase64Url,
  createEmptyQuerySyncState,
  makeQueryPublicationIdentity,
  unchangedPublicationDisposition,
  type AdmittedInvalidationBatch,
  type CanonicalDependencyKey,
  type NamespaceCursor,
  type QueryState,
  type QuerySyncState,
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
  encodeDeploymentQuerySyncDependencyRow,
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
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
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);
const bootstrapSequence = 11n;
const firstAppliedSequence = bootstrapSequence + 1n;
const maximumDependencyLookups = 65_536;
const maximumAffectedQueries = 4_096;
const sqlDataKeyChunkSize = 96;

type StoredRow = Record<string, unknown>;

interface SqlInvocation {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly bindings: readonly SQLInputValue[];
}

interface ReadFault {
  readonly matches: (invocation: SqlInvocation) => boolean;
  readonly transform: (
    rows: readonly StoredRow[],
    invocation: SqlInvocation,
  ) => readonly StoredRow[];
}

interface WriteFault {
  readonly matches: (invocation: SqlInvocation) => boolean;
  readonly occurrence: number;
  readonly mode: "skip" | "zeroRowsWritten";
}

interface SqliteHarness {
  readonly database: DatabaseSync;
  readonly storage: DeploymentQuerySyncStorage;
  readonly dependencyReadBindingCounts: number[];
  readonly activeReadBindingCounts: number[];
  readonly resetReadReceipts: () => void;
  readonly setReadFault: (fault: ReadFault | null) => void;
  readonly setWriteFault: (fault: WriteFault | null) => void;
}

interface InitializedFixture {
  readonly harness: SqliteHarness;
  readonly state: DeploymentQuerySyncStateC1;
  readonly binding: DeploymentQuerySyncBinding;
}

describe("deployment query-sync C1 adapter limits and corruption", () => {
  it("uses exact 96-key dependency chunks at 97 and 65,536 and rejects 65,537 before reads", async () => {
    const fixture = await makeInitializedFixture();
    try {
      const rawKeys = makeCanonicalDependencyInputs(
        maximumDependencyLookups + 1,
      );

      fixture.harness.resetReadReceipts();
      const first = await Effect.runPromise(
        fixture.state.applyAdmittedBatchAndAdvance(makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence,
          rawKeys.slice(0, sqlDataKeyChunkSize + 1),
        )),
      );
      expect(first).toMatchObject({
        _tag: "applied",
        appliedSequence: firstAppliedSequence,
        affectedQueryKeys: [],
      });
      expect(fixture.harness.dependencyReadBindingCounts).toEqual([96, 1]);
      expect(fixture.harness.activeReadBindingCounts).toEqual([]);

      fixture.harness.resetReadReceipts();
      const maximumBatch = makeAdmittedBatch(
        fixture.binding,
        firstAppliedSequence + 1n,
        rawKeys.slice(0, maximumDependencyLookups),
      );
      const maximum = await Effect.runPromise(
        fixture.state.applyAdmittedBatchAndAdvance(maximumBatch),
      );
      expect(maximum).toMatchObject({
        _tag: "applied",
        appliedSequence: firstAppliedSequence + 1n,
        affectedQueryKeys: [],
      });
      expect(fixture.harness.dependencyReadBindingCounts).toHaveLength(683);
      expect(fixture.harness.dependencyReadBindingCounts.slice(0, -1).every(
        count => count === sqlDataKeyChunkSize,
      )).toBe(true);
      expect(fixture.harness.dependencyReadBindingCounts.at(-1)).toBe(64);
      expect(sum(fixture.harness.dependencyReadBindingCounts)).toBe(
        maximumDependencyLookups,
      );
      expect(fixture.harness.activeReadBindingCounts).toEqual([]);

      const finalDependencyKey = success(captureCanonicalDependencyKey(
        requiredAt(rawKeys, maximumDependencyLookups),
      ));
      const oversizedBatch: AdmittedInvalidationBatch = Object.freeze({
        ...makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence + 2n,
          [],
        ),
        dependencyKeys: Object.freeze([
          ...maximumBatch.dependencyKeys,
          finalDependencyKey,
        ]),
      });
      fixture.harness.resetReadReceipts();
      const oversized = await Effect.runPromiseExit(
        fixture.state.applyAdmittedBatchAndAdvance(oversizedBatch),
      );
      expect(failureError(oversized)).toMatchObject({
        _tag: "QuerySyncWorkLimitError",
        operation: "applyAdmittedInvalidations",
        dimension: "dependencyLookups",
        maximum: maximumDependencyLookups,
        observed: maximumDependencyLookups + 1,
      });
      expect(fixture.harness.dependencyReadBindingCounts).toEqual([]);
      expect(fixture.harness.activeReadBindingCounts).toEqual([]);
      expect(readScopeSequence(fixture.harness.database)).toBe(
        (firstAppliedSequence + 1n).toString(),
      );
    } finally {
      fixture.harness.database.close();
    }
  }, 120_000);

  it("applies exactly 4,096 affected targets in canonical order and rejects the 4,097 sentinel", async () => {
    const dependencyKey = canonicalDependency("shared-limit-dependency");
    const fixture = await makeInitializedFixture();
    try {
      const reference = makeReferenceState(
        fixture.binding.bootstrapCursor,
        maximumAffectedQueries,
        Object.freeze([dependencyKey]),
      );
      seedReferenceState(fixture.harness.database, fixture.binding, reference);
      const expectedOrder = reference.queries.map(query =>
        query.descriptor.queryKey
      );
      expect(expectedOrder).toEqual([...expectedOrder].toSorted(
        compareCanonicalBase64Url,
      ));

      fixture.harness.resetReadReceipts();
      const applied = await Effect.runPromise(
        fixture.state.applyAdmittedBatchAndAdvance(makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence,
          [dependencyKey],
        )),
      );
      expect(applied).toMatchObject({
        _tag: "applied",
        appliedSequence: firstAppliedSequence,
      });
      if (applied._tag !== "applied") {
        throw new Error("Expected the exact affected-target batch to apply.");
      }
      expect(applied.affectedQueryKeys).toEqual(expectedOrder);
      expect(fixture.harness.dependencyReadBindingCounts).toEqual([1]);
      expect(fixture.harness.activeReadBindingCounts).toHaveLength(43);
      expect(fixture.harness.activeReadBindingCounts.slice(0, -1).every(
        count => count === sqlDataKeyChunkSize,
      )).toBe(true);
      expect(fixture.harness.activeReadBindingCounts.at(-1)).toBe(64);

      insertOrphanDependency(
        fixture.harness.database,
        makeCanonicalQueryKey(maximumAffectedQueries),
        dependencyKey,
      );
      fixture.harness.resetReadReceipts();
      const sentinel = await Effect.runPromiseExit(
        fixture.state.applyAdmittedBatchAndAdvance(makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence + 1n,
          [dependencyKey],
        )),
      );
      expect(failureError(sentinel)).toMatchObject({
        _tag: "QuerySyncWorkLimitError",
        operation: "applyAdmittedInvalidations",
        dimension: "affectedQueries",
        maximum: maximumAffectedQueries,
        observed: maximumAffectedQueries + 1,
      });
      expect(fixture.harness.dependencyReadBindingCounts).toEqual([1]);
      expect(fixture.harness.activeReadBindingCounts).toEqual([]);
      expect(readScopeSequence(fixture.harness.database)).toBe(
        firstAppliedSequence.toString(),
      );
    } finally {
      fixture.harness.database.close();
    }
  }, 120_000);

  it.each([
    {
      name: "malformed affected-target shape",
      configure: (fixture: InitializedFixture) => {
        fixture.harness.setReadFault({
          matches: isAffectedTargetRead,
          transform: rows => rows.map(row => withoutField(
            row,
            "active_generation",
          )),
        });
      },
      causeReason: "rowInvalid",
    },
    {
      name: "noncanonical affected-target generation",
      configure: (fixture: InitializedFixture) => {
        fixture.harness.setReadFault({
          matches: isAffectedTargetRead,
          transform: rows => rows.map(row => ({
            ...row,
            active_generation: "01",
          })),
        });
      },
      causeReason: "rowInvalid",
    },
    {
      name: "duplicate affected active facts",
      configure: (fixture: InitializedFixture) => {
        fixture.harness.setReadFault({
          matches: isAffectedActiveRead,
          transform: rows => Object.freeze([...rows, ...rows]),
        });
      },
      causeReason: "rowDuplicate",
    },
    {
      name: "missing affected active facts",
      configure: (fixture: InitializedFixture) => {
        fixture.harness.setReadFault({
          matches: isAffectedActiveRead,
          transform: () => Object.freeze([]),
        });
      },
      causeReason: "transitionFactsRejected",
    },
  ])("maps $name to stored corruption without advancing", async scenario => {
    const dependencyKey = canonicalDependency(`fault-${scenario.name}`);
    const fixture = await makeInitializedFixture();
    try {
      seedReferenceState(
        fixture.harness.database,
        fixture.binding,
        makeReferenceState(
          fixture.binding.bootstrapCursor,
          1,
          Object.freeze([dependencyKey]),
        ),
      );
      scenario.configure(fixture);

      const exit = await Effect.runPromiseExit(
        fixture.state.applyAdmittedBatchAndAdvance(makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence,
          [dependencyKey],
        )),
      );
      expectStoredCorruption(exit, scenario.causeReason);
      expect(readScopeSequence(fixture.harness.database)).toBe(
        bootstrapSequence.toString(),
      );
      expect(readDirtyFrontiers(fixture.harness.database)).toEqual([null]);
    } finally {
      fixture.harness.database.close();
    }
  });

  it.each([
    {
      name: "wrong dependency role",
      causeReason: "rowInvalid",
      corrupt: (
        database: DatabaseSync,
        queryKey: string,
        dependencyKey: CanonicalDependencyKey,
      ) => {
        database.exec("PRAGMA ignore_check_constraints = ON");
        try {
          database.prepare(`UPDATE deployment_sync_query_dependencies
            SET role = 'completion'
            WHERE query_key = ? AND dependency_key = ?`).run(
              queryKey,
              dependencyKey,
            );
        } finally {
          database.exec("PRAGMA ignore_check_constraints = OFF");
        }
      },
    },
    {
      name: "orphan dependency target",
      causeReason: "transitionFactsRejected",
      corrupt: (
        database: DatabaseSync,
        queryKey: string,
        dependencyKey: CanonicalDependencyKey,
      ) => {
        const orphanKey = makeCanonicalQueryKey(9_999);
        database.prepare(`UPDATE deployment_sync_query_dependencies
          SET query_key = ?
          WHERE query_key = ? AND dependency_key = ?`).run(
            orphanKey,
            queryKey,
            dependencyKey,
          );
      },
    },
    {
      name: "wrong dependency generation",
      causeReason: "transitionFactsRejected",
      corrupt: (
        database: DatabaseSync,
        queryKey: string,
        dependencyKey: CanonicalDependencyKey,
      ) => {
        database.prepare(`UPDATE deployment_sync_query_dependencies
          SET generation = '2'
          WHERE query_key = ? AND dependency_key = ?`).run(
            queryKey,
            dependencyKey,
          );
      },
    },
  ])("rejects a touched $name as stored corruption", async scenario => {
    const dependencyKey = canonicalDependency(`stored-${scenario.name}`);
    const fixture = await makeInitializedFixture();
    try {
      const reference = makeReferenceState(
        fixture.binding.bootstrapCursor,
        1,
        Object.freeze([dependencyKey]),
      );
      seedReferenceState(fixture.harness.database, fixture.binding, reference);
      const queryKey = requiredAt(reference.queries, 0).descriptor.queryKey;
      scenario.corrupt(fixture.harness.database, queryKey, dependencyKey);

      const exit = await Effect.runPromiseExit(
        fixture.state.applyAdmittedBatchAndAdvance(makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence,
          [dependencyKey],
        )),
      );
      expectStoredCorruption(exit, scenario.causeReason);
      expect(readScopeSequence(fixture.harness.database)).toBe(
        bootstrapSequence.toString(),
      );
      expect(readDirtyFrontiers(fixture.harness.database)).toEqual([null]);
    } finally {
      fixture.harness.database.close();
    }
  });

  it.each([
    {
      name: "zero dependency-membership counter with an affected target",
      update: "dependency_memberships = 0",
      counter: "dependencyMemberships",
      queryCount: 1,
    },
    {
      name: "dependency-membership counter below the affected-target count",
      update: "dependency_memberships = 1",
      counter: "dependencyMemberships",
      queryCount: 2,
    },
    {
      name: "query counter below the affected-target count",
      update: "query_count = 1",
      counter: "queryCount",
      queryCount: 2,
    },
  ])("rejects $name as stored corruption", async scenario => {
    const dependencyKey = canonicalDependency(`counter-${scenario.counter}`);
    const fixture = await makeInitializedFixture();
    try {
      seedReferenceState(
        fixture.harness.database,
        fixture.binding,
        makeReferenceState(
          fixture.binding.bootstrapCursor,
          scenario.queryCount,
          Object.freeze([dependencyKey]),
        ),
      );
      fixture.harness.database.exec(`UPDATE deployment_sync_scope_state
        SET ${scenario.update}`);

      const exit = await Effect.runPromiseExit(
        fixture.state.applyAdmittedBatchAndAdvance(makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence,
          [dependencyKey],
        )),
      );
      expectStoredCorruption(exit, "scopeCounterMismatch");
      expect(errorCause(failureError(exit))).toMatchObject({
        evidence: { counter: scenario.counter },
      });
      expect(readScopeSequence(fixture.harness.database)).toBe(
        bootstrapSequence.toString(),
      );
      expect(readDirtyFrontiers(fixture.harness.database)).toEqual(
        Array.from({ length: scenario.queryCount }, () => null),
      );
    } finally {
      fixture.harness.database.close();
    }
  });

  it.each([
    {
      name: "affected-row write count mismatch",
      fault: {
        matches: isAffectedActiveWrite,
        occurrence: 2,
        mode: "zeroRowsWritten" as const,
      },
      queryCount: 2,
    },
    {
      name: "scope CAS miss after affected-row writes",
      fault: {
        matches: isScopeCasWrite,
        occurrence: 1,
        mode: "skip" as const,
      },
      queryCount: 1,
    },
  ])("rolls back every staged write on $name", async scenario => {
    const dependencyKey = canonicalDependency(`rollback-${scenario.name}`);
    const fixture = await makeInitializedFixture();
    try {
      seedReferenceState(
        fixture.harness.database,
        fixture.binding,
        makeReferenceState(
          fixture.binding.bootstrapCursor,
          scenario.queryCount,
          Object.freeze([dependencyKey]),
        ),
      );
      const before = semanticRows(fixture.harness.database);
      fixture.harness.setWriteFault(scenario.fault);

      const exit = await Effect.runPromiseExit(
        fixture.state.applyAdmittedBatchAndAdvance(makeAdmittedBatch(
          fixture.binding,
          firstAppliedSequence,
          [dependencyKey],
        )),
      );
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(semanticRows(fixture.harness.database)).toEqual(before);
    } finally {
      fixture.harness.database.close();
    }
  });
});

async function makeInitializedFixture(): Promise<InitializedFixture> {
  const harness = makeSqliteHarness();
  const input = stateInput(harness);
  const binding = success(captureDeploymentQuerySyncBinding(input.binding));
  const state = await Effect.runPromise(makeDeploymentQuerySyncStateC1(input));
  await Effect.runPromise(
    state.initializeOrInspectNamespace(binding.bootstrapCursor),
  );
  return Object.freeze({ harness, state, binding });
}

function observation() {
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(7n),
    observedAtCommitSeq: CommitSeqSchema.make(bootstrapSequence),
    activationSequence: ApplicationActivationSequenceV1Schema.make(1n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "ab".repeat(32),
    ),
  });
}

function stateInput(
  harness: SqliteHarness,
): DeploymentQuerySyncStateC1Input {
  const binding = Object.freeze({
    objectId: Object.freeze({ name: `deployment-sync:${scopeUuid}` }),
    observation: observation(),
  });
  const capability =
    makeDeploymentQuerySyncFreshInitializationCapabilityForTest(
      success(captureDeploymentQuerySyncBinding(binding)),
    );
  return Object.freeze({
    binding,
    storage: harness.storage,
    freshInitializationCapability: capability,
  });
}

function makeAdmittedBatch(
  binding: DeploymentQuerySyncBinding,
  sourceSequence: bigint,
  dependencyKeys: readonly string[],
): AdmittedInvalidationBatch {
  return success(captureAdmittedInvalidationBatch({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    sourceSequence,
    dependencyKeys,
  }));
}

function canonicalDependency(value: string): CanonicalDependencyKey {
  return success(captureCanonicalDependencyKey(
    Encoding.encodeBase64Url(value),
  ));
}

function makeCanonicalDependencyInputs(count: number): readonly string[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, index);
    return Encoding.encodeBase64Url(bytes);
  }));
}

function makeCanonicalQueryKey(index: number): string {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(28, index);
  return Encoding.encodeBase64Url(bytes);
}

function makeReferenceState(
  cursor: NamespaceCursor,
  queryCount: number,
  dependencyKeys: readonly CanonicalDependencyKey[],
): QuerySyncState {
  const empty = success(createEmptyQuerySyncState(cursor));
  const queries = Array.from(
    { length: queryCount },
    (_, index) => makeActiveQuery(cursor, index, dependencyKeys),
  );
  return success(buildQuerySyncState({
    cursor,
    queries,
    evaluationWork: empty.evaluationWork,
    publicationWork: empty.publicationWork,
  }));
}

function makeActiveQuery(
  cursor: NamespaceCursor,
  index: number,
  dependencyKeys: readonly CanonicalDependencyKey[],
): QueryState {
  const descriptor = success(captureQueryDescriptor({
    queryKey: makeCanonicalQueryKey(index),
    queryIdentity: Encoding.encodeBase64Url(`query-${index}`),
  }));
  const evaluation = success(captureQueryEvaluationEvidence({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    descriptor,
    generation: 1n,
    snapshotSequence: cursor.appliedThroughSequence,
    resultDigest: Encoding.encodeBase64Url(new Uint8Array(32).fill(31)),
    authorityWitness: Encoding.encodeBase64Url(new Uint8Array(32).fill(47)),
    dependencyKeys,
  }));
  const identity = makeQueryPublicationIdentity({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    queryKey: descriptor.queryKey,
    generation: evaluation.generation,
  });
  return Object.freeze({
    descriptor,
    active: Object.freeze({
      generation: evaluation.generation,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      freshThroughSequence: cursor.appliedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest: evaluation.resultDigest,
      authorityWitness: evaluation.authorityWitness,
      dependencyKeys: evaluation.dependencyKeys,
    }),
    provisional: null,
    currentCompletion: Object.freeze({
      identity,
      queryIdentity: descriptor.queryIdentity,
      expectedActiveGeneration: null,
      registrationCursor: cursor,
      requestedDirtyThroughSequence: null,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      evaluationDependencyKeys: evaluation.dependencyKeys,
      evaluationAuthorityWitness: evaluation.authorityWitness,
      refreshedThroughSequence: cursor.appliedThroughSequence,
      relevantThroughSequence: null,
      refreshAuthorityWitness: evaluation.authorityWitness,
      resultDigest: evaluation.resultDigest,
      publicationDisposition: unchangedPublicationDisposition(),
    }),
    precedingCompletionIdentity: null,
  });
}

function seedReferenceState(
  database: DatabaseSync,
  binding: DeploymentQuerySyncBinding,
  state: QuerySyncState,
): void {
  const scopeRow = encodeDeploymentQuerySyncScopeRow({
    scopeUuid: binding.scopeUuid,
    epochUuid: binding.epochUuid,
    storageGeneration: binding.storageGeneration,
    storageGenerationFence: binding.storageGenerationFence,
    syncModelId: binding.syncModelId,
    facts: Object.freeze({
      cursor: state.cursor,
      evaluationWork: state.evaluationWork,
      metrics: state.metrics,
    }),
  });
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM deployment_sync_query_dependencies");
    database.exec("DELETE FROM deployment_sync_queries");
    database.exec("DELETE FROM deployment_sync_scope_state");
    database.prepare(`INSERT INTO deployment_sync_scope_state (
      singleton,
      scope_uuid,
      epoch_uuid,
      storage_generation,
      storage_generation_fence,
      sync_model_id,
      applied_through_sequence,
      evaluation_work_revision,
      fairness_anchor,
      query_count,
      retained_identity_bytes,
      dependency_memberships,
      pending_publication_count,
      in_flight_publication_count,
      retained_publication_content_bytes,
      settlement_envelope_bytes,
      counted_canonical_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...scopeRowValues(scopeRow));

    const insertQuery = database.prepare(`INSERT INTO deployment_sync_queries (
      query_key,
      query_identity,
      active_generation,
      active_evaluation_snapshot_sequence,
      active_fresh_through_sequence,
      active_dirty_through_sequence,
      active_result_digest,
      active_authority_witness,
      provisional_generation,
      provisional_expected_active_generation,
      provisional_registration_sequence,
      provisional_requested_dirty_through_sequence,
      provisional_disposition
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertDependency = database.prepare(
      `INSERT INTO deployment_sync_query_dependencies (
        role,
        query_key,
        generation,
        dependency_key
      ) VALUES (?, ?, ?, ?)`,
    );
    for (const query of state.queries.toReversed()) {
      const queryRow = encodeDeploymentQuerySyncQueryRow({
        descriptor: query.descriptor,
        active: query.active,
        provisional: query.provisional,
      });
      insertQuery.run(...queryRowValues(queryRow));
      if (query.active === null) continue;
      for (const dependencyKey of query.active.dependencyKeys) {
        const dependencyRow = encodeDeploymentQuerySyncDependencyRow({
          role: "active",
          queryKey: query.descriptor.queryKey,
          generation: query.active.generation,
          dependencyKey,
        });
        insertDependency.run(...dependencyRowValues(dependencyRow));
      }
    }
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
}

function insertOrphanDependency(
  database: DatabaseSync,
  queryKey: string,
  dependencyKey: CanonicalDependencyKey,
): void {
  database.prepare(`INSERT INTO deployment_sync_query_dependencies (
    role,
    query_key,
    generation,
    dependency_key
  ) VALUES ('active', ?, '1', ?)`).run(queryKey, dependencyKey);
}

function scopeRowValues(
  row: EncodedDeploymentQuerySyncScopeRow,
): SQLInputValue[] {
  return [
    row.singleton,
    row.scope_uuid,
    row.epoch_uuid,
    row.storage_generation,
    row.storage_generation_fence,
    row.sync_model_id,
    row.applied_through_sequence,
    row.evaluation_work_revision,
    row.fairness_anchor,
    row.query_count,
    row.retained_identity_bytes,
    row.dependency_memberships,
    row.pending_publication_count,
    row.in_flight_publication_count,
    row.retained_publication_content_bytes,
    row.settlement_envelope_bytes,
    row.counted_canonical_bytes,
  ];
}

function queryRowValues(
  row: EncodedDeploymentQuerySyncQueryRow,
): SQLInputValue[] {
  return [
    row.query_key,
    row.query_identity,
    row.active_generation,
    row.active_evaluation_snapshot_sequence,
    row.active_fresh_through_sequence,
    row.active_dirty_through_sequence,
    row.active_result_digest,
    row.active_authority_witness,
    row.provisional_generation,
    row.provisional_expected_active_generation,
    row.provisional_registration_sequence,
    row.provisional_requested_dirty_through_sequence,
    row.provisional_disposition,
  ];
}

function dependencyRowValues(
  row: EncodedDeploymentQuerySyncDependencyRow,
): SQLInputValue[] {
  return [row.role, row.query_key, row.generation, row.dependency_key];
}

function normalizeSql(query: string): string {
  return query.replaceAll(/\s+/g, " ").trim();
}

function isAffectedTargetRead(invocation: SqlInvocation): boolean {
  return invocation.normalizedQuery.includes(
    "FROM main.deployment_sync_query_dependencies",
  ) && invocation.normalizedQuery.includes("dependency_key IN (");
}

function isAffectedActiveRead(invocation: SqlInvocation): boolean {
  return invocation.normalizedQuery.includes(
    "FROM main.deployment_sync_queries",
  ) && invocation.normalizedQuery.includes("WHERE query_key IN (");
}

function isAffectedActiveWrite(invocation: SqlInvocation): boolean {
  return invocation.normalizedQuery.startsWith(
    "UPDATE main.deployment_sync_queries SET active_dirty_through_sequence",
  );
}

function isScopeCasWrite(invocation: SqlInvocation): boolean {
  return invocation.normalizedQuery.startsWith(
    "UPDATE main.deployment_sync_scope_state SET scope_uuid",
  );
}

function withoutField(row: StoredRow, field: string) {
  const copy = { ...row };
  Reflect.deleteProperty(copy, field);
  return copy;
}

function emptyRawRows<Row extends SqlStorageValue[]>(): IterableIterator<Row> {
  return (function* () {})();
}

function cursorFor<T extends Record<string, SqlStorageValue>>(
  rows: readonly T[],
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
  const dependencyReadBindingCounts: number[] = [];
  const activeReadBindingCounts: number[] = [];
  let readFault: ReadFault | null = null;
  let writeFault: WriteFault | null = null;
  let matchingWriteCount = 0;

  const exec: DeploymentQuerySyncStorage["sql"]["exec"] = <
    T extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<T> => {
    const invocation = Object.freeze({
      query,
      normalizedQuery: normalizeSql(query),
      bindings: Object.freeze([...bindings]),
    });
    if (isAffectedTargetRead(invocation)) {
      dependencyReadBindingCounts.push(bindings.length);
    }
    if (isAffectedActiveRead(invocation)) {
      activeReadBindingCounts.push(bindings.length);
    }

    const matchedWriteFault = writeFault?.matches(invocation) === true;
    if (matchedWriteFault) matchingWriteCount += 1;
    const activeWriteFault = matchedWriteFault
      && writeFault !== null
      && matchingWriteCount === writeFault.occurrence
      ? writeFault
      : null;
    if (activeWriteFault?.mode === "skip") {
      writeFault = null;
      return cursorFor([], 0);
    }

    const sqliteRows = database.prepare(query).all(...bindings);
    let rows: readonly StoredRow[] = sqliteRows;
    if (readFault?.matches(invocation) === true) {
      rows = readFault.transform(rows, invocation);
      readFault = null;
    }
    const isWrite = /^(?:INSERT|UPDATE|DELETE)\b/i.test(query.trimStart());
    let rowsWritten = isWrite ? sqliteRows.length : 0;
    if (activeWriteFault?.mode === "zeroRowsWritten") {
      rowsWritten = 0;
      writeFault = null;
    }
    // SAFETY: production row codecs validate the SQLite values. This test
    // adapter only restores the caller-selected SqlStorage cursor generic.
    return cursorFor(rows as readonly T[], rowsWritten);
  };
  const storage: DeploymentQuerySyncStorage = {
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
  };
  return {
    database,
    storage,
    dependencyReadBindingCounts,
    activeReadBindingCounts,
    resetReadReceipts: () => {
      dependencyReadBindingCounts.length = 0;
      activeReadBindingCounts.length = 0;
    },
    setReadFault: fault => {
      readFault = fault;
    },
    setWriteFault: fault => {
      writeFault = fault;
      matchingWriteCount = 0;
    },
  };
}

function semanticRows(database: DatabaseSync): readonly unknown[] {
  return Object.freeze([
    database.prepare(`SELECT * FROM deployment_sync_scope_state
      ORDER BY singleton`).all(),
    database.prepare(`SELECT * FROM deployment_sync_queries
      ORDER BY query_key`).all(),
    database.prepare(`SELECT * FROM deployment_sync_query_dependencies
      ORDER BY query_key, role, generation, dependency_key`).all(),
  ]);
}

function readScopeSequence(database: DatabaseSync): string {
  const row = database.prepare(`SELECT applied_through_sequence AS sequence
    FROM deployment_sync_scope_state`).get();
  const sequence = row?.sequence;
  if (typeof sequence !== "string") {
    throw new Error("Expected a stored deployment query-sync sequence.");
  }
  return sequence;
}

function readDirtyFrontiers(database: DatabaseSync): readonly unknown[] {
  return database.prepare(`SELECT active_dirty_through_sequence AS dirty
    FROM deployment_sync_queries ORDER BY query_key`).all()
    .map(row => row.dirty);
}

function expectStoredCorruption(
  exit: Exit.Exit<unknown, unknown>,
  causeReason: string,
): void {
  const error = failureError(exit);
  expect(error).toMatchObject({
    _tag: "QuerySyncStoredStateCorruptError",
    operation: "applyAdmittedBatchAndAdvance",
    commitCertainty: "notCommitted",
    reason: "storedAggregateInvalid",
  });
  expect(errorCause(error)).toMatchObject({
    _tag: "DeploymentQuerySyncStoredStateIssue",
    reason: causeReason,
  });
}

function errorCause(error: unknown): unknown {
  if (!(error instanceof Error)) {
    throw new Error("Expected a deployment query-sync Error value.");
  }
  return error.cause;
}

function failureError(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected an Effect failure.");
  }
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
}

function requiredAt<A>(values: readonly A[], index: number): A {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing test fixture value at index ${index}.`);
  }
  return value;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}
