import {
  Encoding,
  Result,
} from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeDeploymentQuerySyncAffectedActiveRowResult,
  decodeDeploymentQuerySyncAffectedTargetRowResult,
  decodeDeploymentQuerySyncContractRowResult,
  decodeDeploymentQuerySyncGeneration2ContractRowResult,
  decodeDeploymentQuerySyncGeneration3ScopeRowResult,
  decodeDeploymentQuerySyncQueryRowResult,
  decodeDeploymentQuerySyncScopeRowResult,
  decodeDeploymentSyncGeneration1ScopeRowResult,
  encodeDeploymentQuerySyncAffectedActiveRow,
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
} from "../src/deploymentSync/RowCodec";
import {
  decodeDeploymentQuerySyncDependencyRowResult,
  decodeDeploymentQuerySyncGeneration2DependencyRowResult,
  encodeDeploymentQuerySyncDependencyRow,
} from "../src/deploymentSync/DependencyRowCodec";

const scopeUuid = "00000000-0000-4000-8000-000000000001";
const epochUuid = "00000000-0000-4000-8000-000000000002";
const syncModelId = "flarex.scope-sync.application-query-model.v1";
const queryKey = Encoding.encodeBase64Url(
  Uint8Array.from({ length: 32 }, (_, index) => index),
);
const queryIdentity = Encoding.encodeBase64Url(
  Uint8Array.from([1, 2, 3, 4]),
);
const resultDigest = Encoding.encodeBase64Url(
  Uint8Array.from({ length: 32 }, () => 0x44),
);
const authorityWitness = Encoding.encodeBase64Url(
  Uint8Array.from({ length: 32 }, () => 0x55),
);
const dependencyKey = Encoding.encodeBase64Url(
  Uint8Array.from([6, 7, 8]),
);

function scopeRow() {
  return {
    singleton: 1,
    scope_uuid: scopeUuid,
    epoch_uuid: epochUuid,
    storage_generation: "flarexdb_v1",
    storage_generation_fence: "9",
    sync_model_id: syncModelId,
    applied_through_sequence: "3",
    evaluation_work_revision: "2",
    fairness_anchor: queryKey,
    query_count: 1,
    retained_identity_bytes: 4,
    dependency_memberships: 1,
    pending_publication_count: 0,
    in_flight_publication_count: 0,
    retained_publication_content_bytes: 0,
    settlement_envelope_bytes: 0,
    counted_canonical_bytes: 100,
  };
}

function queryRow() {
  return {
    query_key: queryKey,
    query_identity: queryIdentity,
    active_generation: "1",
    active_evaluation_snapshot_sequence: "1",
    active_fresh_through_sequence: "2",
    active_dirty_through_sequence: "3",
    active_result_digest: resultDigest,
    active_authority_witness: authorityWitness,
    provisional_generation: "2",
    provisional_expected_active_generation: "1",
    provisional_registration_sequence: "2",
    provisional_requested_dirty_through_sequence: "3",
    provisional_disposition: "blocked",
  };
}

describe("deployment query-sync SQLite row codecs", () => {
  it("decodes generation-1 and generation-2 predecessors plus generation 3", () => {
    const legacy = success(decodeDeploymentSyncGeneration1ScopeRowResult({
      singleton: 1,
      local_schema_revision: 1,
      scope_uuid: scopeUuid,
      epoch_uuid: epochUuid,
      storage_generation: "flarexdb_v1",
      storage_generation_fence: "9",
      applied_through_commit_seq: "3",
    }));
    const predecessor = success(
      decodeDeploymentQuerySyncGeneration2ContractRowResult({
        singleton: 1,
        local_contract_generation: 2,
        durable_initialized_history: 1,
      }),
    );
    const contract = success(decodeDeploymentQuerySyncContractRowResult({
      singleton: 1,
      local_contract_generation: 3,
      durable_initialized_history: 1,
    }));

    expect(legacy).toMatchObject({
      localSchemaRevision: 1,
      scopeUuid,
      epochUuid,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9n,
      appliedThroughCommitSeq: 3n,
    });
    expect(predecessor).toEqual({
      localContractGeneration: 2,
      durableInitializedHistory: true,
    });
    expect(contract).toEqual({
      localContractGeneration: 3,
      durableInitializedHistory: true,
    });
    expect(Object.isFrozen(legacy)).toBe(true);
    expect(Object.isFrozen(contract)).toBe(true);

    expect(failure(decodeDeploymentSyncGeneration1ScopeRowResult({
      singleton: 1,
      local_schema_revision: 2,
      scope_uuid: scopeUuid,
      epoch_uuid: epochUuid,
      storage_generation: "flarexdb_v1",
      storage_generation_fence: "9",
      applied_through_commit_seq: "3",
    }))).toMatchObject({
      reason: "unsupportedLegacyRevision",
      field: "local_schema_revision",
    });
    expect(failure(decodeDeploymentQuerySyncContractRowResult({
      singleton: 1,
      local_contract_generation: 2,
      durable_initialized_history: 1,
    }))).toMatchObject({
      reason: "unsupportedContractGeneration",
      field: "local_contract_generation",
    });
  });

  it("captures exact host authority and portable scope facts", () => {
    const state = success(decodeDeploymentQuerySyncScopeRowResult(scopeRow()));

    expect(state).toMatchObject({
      scopeUuid,
      epochUuid,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9n,
      syncModelId,
      facts: {
        cursor: {
          namespaceId: scopeUuid,
          syncModelId,
          sourceEpoch: epochUuid,
          appliedThroughSequence: 3n,
        },
        evaluationWork: {
          revision: 2n,
          fairnessAnchor: queryKey,
        },
      },
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.facts)).toBe(true);
    expect(Object.isFrozen(state.facts.cursor)).toBe(true);
    expect(Object.isFrozen(state.facts.evaluationWork)).toBe(true);
    expect(Object.isFrozen(state.facts.metrics)).toBe(true);
    expect(encodeDeploymentQuerySyncScopeRow(state)).toEqual(scopeRow());
  });

  it("refines generation-3 scope lifecycle counters to zero", () => {
    expect(success(decodeDeploymentQuerySyncGeneration3ScopeRowResult(
      scopeRow(),
    )).facts.metrics).toMatchObject({
      inFlightPublicationCount: 0,
      settlementEnvelopeBytes: 0,
    });
    expect(failure(decodeDeploymentQuerySyncGeneration3ScopeRowResult({
      ...scopeRow(),
      in_flight_publication_count: 1,
    }))).toMatchObject({
      reason: "generation3ScopeInvalid",
      field: "in_flight_publication_count",
    });
    expect(failure(decodeDeploymentQuerySyncGeneration3ScopeRowResult({
      ...scopeRow(),
      settlement_envelope_bytes: 1,
    }))).toMatchObject({
      reason: "generation3ScopeInvalid",
      field: "settlement_envelope_bytes",
    });
  });

  it("rejects excess columns, noncanonical integers, and metric overflow", () => {
    expect(failure(decodeDeploymentQuerySyncScopeRowResult({
      ...scopeRow(),
      extra_column: 1,
    }))).toMatchObject({ rowKind: "scope", reason: "shapeInvalid" });
    expect(failure(decodeDeploymentQuerySyncScopeRowResult({
      ...scopeRow(),
      evaluation_work_revision: "02",
    }))).toMatchObject({
      rowKind: "scope",
      reason: "valueInvalid",
      field: "evaluation_work_revision",
    });
    expect(failure(decodeDeploymentQuerySyncScopeRowResult({
      ...scopeRow(),
      counted_canonical_bytes: 67_108_865,
    }))).toMatchObject({
      rowKind: "scope",
      reason: "limitExceeded",
      field: "counted_canonical_bytes",
    });
  });

  it("decodes and re-encodes exact active and provisional query facts", () => {
    const scope = success(
      decodeDeploymentQuerySyncScopeRowResult(scopeRow()),
    ).facts;
    const facts = success(decodeDeploymentQuerySyncQueryRowResult(
      queryRow(),
      scope,
    ));

    expect(facts).toMatchObject({
      descriptor: { queryKey, queryIdentity },
      active: {
        generation: 1n,
        evaluationSnapshotSequence: 1n,
        freshThroughSequence: 2n,
        dirtyThroughSequence: 3n,
        resultDigest,
        authorityWitness,
      },
      provisional: {
        generation: 2n,
        expectedActiveGeneration: 1n,
        registrationCursor: { appliedThroughSequence: 2n },
        requestedDirtyThroughSequence: 3n,
        evaluationDisposition: {
          _tag: "blocked",
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      },
    });
    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.active)).toBe(true);
    expect(Object.isFrozen(facts.provisional)).toBe(true);
    expect(Object.isFrozen(facts.provisional?.registrationCursor)).toBe(true);
    expect(Object.isFrozen(facts.provisional?.evaluationDisposition)).toBe(
      true,
    );
    expect(encodeDeploymentQuerySyncQueryRow(facts)).toEqual(queryRow());
  });

  it("rejects nullable-group and scope-relative query invariant violations", () => {
    const scope = success(
      decodeDeploymentQuerySyncScopeRowResult(scopeRow()),
    ).facts;

    expect(failure(decodeDeploymentQuerySyncQueryRowResult({
      ...queryRow(),
      active_generation: null,
    }, scope))).toMatchObject({ reason: "activeGroupInvalid" });
    expect(failure(decodeDeploymentQuerySyncQueryRowResult({
      ...queryRow(),
      active_evaluation_snapshot_sequence: "3",
      active_fresh_through_sequence: "2",
    }, scope))).toMatchObject({ reason: "activeGroupInvalid" });
    expect(failure(decodeDeploymentQuerySyncQueryRowResult({
      ...queryRow(),
      provisional_expected_active_generation: null,
    }, scope))).toMatchObject({ reason: "provisionalGroupInvalid" });
    expect(failure(decodeDeploymentQuerySyncQueryRowResult({
      ...queryRow(),
      provisional_disposition: "paused",
    }, scope))).toMatchObject({ reason: "provisionalGroupInvalid" });
  });

  it("decodes target, active, and dependency projections without assertions", () => {
    const scope = success(
      decodeDeploymentQuerySyncScopeRowResult(scopeRow()),
    ).facts;
    const target = success(decodeDeploymentQuerySyncAffectedTargetRowResult({
      query_key: queryKey,
      active_generation: "1",
    }));
    const active = success(decodeDeploymentQuerySyncAffectedActiveRowResult({
      query_key: queryKey,
      active_generation: "1",
      active_evaluation_snapshot_sequence: "1",
      active_fresh_through_sequence: "2",
      active_dirty_through_sequence: "3",
      active_result_digest: resultDigest,
      active_authority_witness: authorityWitness,
    }, scope));
    const dependency = success(decodeDeploymentQuerySyncDependencyRowResult({
      role: "active",
      query_key: queryKey,
      generation: "1",
      dependency_key: dependencyKey,
    }));

    expect(target).toEqual({ queryKey, activeGeneration: 1n });
    expect(active).toMatchObject({
      queryKey,
      generation: 1n,
      freshThroughSequence: 2n,
      dirtyThroughSequence: 3n,
    });
    expect(dependency).toEqual({
      role: "active",
      queryKey,
      generation: 1n,
      dependencyKey,
    });
    expect(encodeDeploymentQuerySyncAffectedActiveRow(active)).toEqual({
      query_key: queryKey,
      active_generation: "1",
      active_evaluation_snapshot_sequence: "1",
      active_fresh_through_sequence: "2",
      active_dirty_through_sequence: "3",
      active_result_digest: resultDigest,
      active_authority_witness: authorityWitness,
    });
    expect(encodeDeploymentQuerySyncDependencyRow(dependency)).toEqual({
      role: "active",
      query_key: queryKey,
      generation: "1",
      dependency_key: dependencyKey,
    });

    expect(success(decodeDeploymentQuerySyncDependencyRowResult({
      role: "completion",
      query_key: queryKey,
      generation: "1",
      dependency_key: dependencyKey,
    }))).toEqual({
      role: "completion",
      queryKey,
      generation: 1n,
      dependencyKey,
    });
    expect(failure(decodeDeploymentQuerySyncGeneration2DependencyRowResult({
      role: "completion",
      query_key: queryKey,
      generation: "1",
      dependency_key: dependencyKey,
    }))).toMatchObject({ reason: "valueInvalid", field: "role" });
  });
});

function success<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: (error) => {
      throw error;
    },
    onSuccess: value => value,
  });
}

function failure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: error => error,
    onSuccess: () => {
      throw new Error("Expected Result failure.");
    },
  });
}
