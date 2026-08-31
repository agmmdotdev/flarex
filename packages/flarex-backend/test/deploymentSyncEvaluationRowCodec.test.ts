import { Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeDeploymentQuerySyncDependencyRowResult,
  decodeDeploymentQuerySyncDependencyRowsResult,
  encodeDeploymentQuerySyncDependencyRow,
} from "../src/deploymentSync/DependencyRowCodec";
import {
  decodeDeploymentQuerySyncCompleteQueryRowResult,
  decodeDeploymentQuerySyncEvaluationAttemptOutcomeRowResult,
  decodeDeploymentQuerySyncEvaluationWorkScanRowResult,
  encodeDeploymentQuerySyncCompleteQueryRow,
} from "../src/deploymentSync/EvaluationRowCodec";
import {
  decodeDeploymentQuerySyncPendingPublicationRowResult,
  encodeDeploymentQuerySyncPendingPublicationRow,
} from "../src/deploymentSync/PublicationRowCodec";
import {
  decodeDeploymentQuerySyncGeneration3ScopeRowResult,
} from "../src/deploymentSync/RowCodec";

const scopeUuid = "00000000-0000-4000-8000-000000000001";
const epochUuid = "00000000-0000-4000-8000-000000000002";
const syncModelId = "flarex.scope-sync.application-query-model.v1";
const queryKey = Encoding.encodeBase64Url(
  Uint8Array.from({ length: 32 }, (_, index) => index),
);
const queryIdentity = Encoding.encodeBase64Url(Uint8Array.from([1, 2, 3]));
const resultDigest = Encoding.encodeBase64Url(
  Uint8Array.from({ length: 32 }, () => 0x44),
);
const authorityWitness = Encoding.encodeBase64Url(
  Uint8Array.from({ length: 32 }, () => 0x55),
);
const content = Encoding.encodeBase64Url(Uint8Array.from([7, 8, 9]));
const dependencyKey = Encoding.encodeBase64Url(Uint8Array.from([6, 7, 8]));

function scopeRow() {
  return {
    singleton: 1,
    scope_uuid: scopeUuid,
    epoch_uuid: epochUuid,
    storage_generation: "flarexdb_v1",
    storage_generation_fence: "9",
    sync_model_id: syncModelId,
    applied_through_sequence: "5",
    evaluation_work_revision: "2",
    fairness_anchor: queryKey,
    query_count: 1,
    retained_identity_bytes: 3,
    dependency_memberships: 1,
    pending_publication_count: 1,
    in_flight_publication_count: 0,
    retained_publication_content_bytes: 3,
    settlement_envelope_bytes: 0,
    counted_canonical_bytes: 200,
  };
}

function completeQueryRow() {
  return {
    query_key: queryKey,
    query_identity: queryIdentity,
    active_generation: "1",
    active_evaluation_snapshot_sequence: "1",
    active_fresh_through_sequence: "4",
    active_dirty_through_sequence: null,
    active_result_digest: resultDigest,
    active_authority_witness: authorityWitness,
    provisional_generation: null,
    provisional_expected_active_generation: null,
    provisional_registration_sequence: null,
    provisional_requested_dirty_through_sequence: null,
    provisional_disposition: null,
    completion_generation: "1",
    completion_expected_active_generation: null,
    completion_registration_sequence: "1",
    completion_requested_dirty_through_sequence: null,
    completion_evaluation_snapshot_sequence: "1",
    completion_evaluation_authority_witness: authorityWitness,
    completion_refreshed_through_sequence: "4",
    completion_relevant_through_sequence: null,
    completion_refresh_authority_witness: authorityWitness,
    completion_result_digest: resultDigest,
    completion_publication_disposition: "pending",
    preceding_completion_generation: null,
  };
}

function outcomeRow() {
  const row = completeQueryRow();
  return {
    query_key: row.query_key,
    query_identity: row.query_identity,
    active_generation: row.active_generation,
    active_evaluation_snapshot_sequence:
      row.active_evaluation_snapshot_sequence,
    active_fresh_through_sequence: row.active_fresh_through_sequence,
    active_dirty_through_sequence: row.active_dirty_through_sequence,
    active_result_digest: row.active_result_digest,
    active_authority_witness: row.active_authority_witness,
    provisional_generation: row.provisional_generation,
    provisional_expected_active_generation:
      row.provisional_expected_active_generation,
    provisional_registration_sequence: row.provisional_registration_sequence,
    provisional_requested_dirty_through_sequence:
      row.provisional_requested_dirty_through_sequence,
    provisional_disposition: row.provisional_disposition,
    completion_generation: row.completion_generation,
    completion_expected_active_generation:
      row.completion_expected_active_generation,
    completion_registration_sequence: row.completion_registration_sequence,
    completion_requested_dirty_through_sequence:
      row.completion_requested_dirty_through_sequence,
    preceding_completion_generation: row.preceding_completion_generation,
  };
}

describe("deployment query-sync generation-3 evaluation row codecs", () => {
  it("decodes, freezes, and re-encodes the full completion fingerprint", () => {
    const scope = success(
      decodeDeploymentQuerySyncGeneration3ScopeRowResult(scopeRow()),
    ).facts;
    const query = success(decodeDeploymentQuerySyncCompleteQueryRowResult(
      completeQueryRow(),
      scope,
    ));

    expect(query).toMatchObject({
      descriptor: { queryKey, queryIdentity },
      active: { generation: 1n, freshThroughSequence: 4n },
      currentCompletion: {
        identity: { queryKey, generation: 1n },
        registrationCursor: { appliedThroughSequence: 1n },
        relevantThroughSequence: null,
        publicationDisposition: { _tag: "pending" },
      },
      precedingCompletionIdentity: null,
    });
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(query.currentCompletion)).toBe(true);
    expect(Object.isFrozen(query.currentCompletion?.identity)).toBe(true);
    expect(Object.isFrozen(
      query.currentCompletion?.registrationCursor,
    )).toBe(true);
    expect(encodeDeploymentQuerySyncCompleteQueryRow(query)).toEqual(
      completeQueryRow(),
    );
  });

  it("rejects malformed groups and scalar cross-link disagreements", () => {
    const scope = success(
      decodeDeploymentQuerySyncGeneration3ScopeRowResult(scopeRow()),
    ).facts;
    expect(failure(decodeDeploymentQuerySyncCompleteQueryRowResult({
      ...completeQueryRow(),
      completion_refresh_authority_witness: null,
    }, scope))).toMatchObject({ reason: "completionGroupInvalid" });
    expect(failure(decodeDeploymentQuerySyncCompleteQueryRowResult({
      ...completeQueryRow(),
      completion_refreshed_through_sequence: "3",
    }, scope))).toMatchObject({ reason: "completionFactsInvalid" });
    expect(failure(decodeDeploymentQuerySyncCompleteQueryRowResult({
      ...completeQueryRow(),
      completion_relevant_through_sequence: "4",
    }, scope))).toMatchObject({ reason: "completionGroupInvalid" });
    const invalidProvisional = {
      provisional_generation: "2",
      provisional_expected_active_generation: "1",
      provisional_registration_sequence: "1",
      provisional_requested_dirty_through_sequence: "invalid",
      provisional_disposition: "ready",
    } as const;
    expect(failure(decodeDeploymentQuerySyncCompleteQueryRowResult({
      ...completeQueryRow(),
      ...invalidProvisional,
    }, scope))).toMatchObject({
      rowKind: "evaluationQuery",
      field: "provisional_requested_dirty_through_sequence",
    });
    expect(failure(
      decodeDeploymentQuerySyncEvaluationAttemptOutcomeRowResult({
        ...outcomeRow(),
        ...invalidProvisional,
      }, scope),
    )).toMatchObject({
      rowKind: "evaluationAttemptOutcome",
      field: "provisional_requested_dirty_through_sequence",
    });
  });

  it("decodes the bounded outcome and slim scheduling projections", () => {
    const scope = success(
      decodeDeploymentQuerySyncGeneration3ScopeRowResult(scopeRow()),
    ).facts;
    const outcome = success(
      decodeDeploymentQuerySyncEvaluationAttemptOutcomeRowResult(
        outcomeRow(),
        scope,
      ),
    );
    const scan = success(
      decodeDeploymentQuerySyncEvaluationWorkScanRowResult({
        query_key: queryKey,
        active_generation: "1",
        active_dirty_through_sequence: "5",
        provisional_generation: "2",
        provisional_disposition: "blocked",
      }, scope),
    );

    expect(outcome.currentCompletion).toMatchObject({
      identity: { generation: 1n },
      registrationCursor: { appliedThroughSequence: 1n },
    });
    expect(scan).toMatchObject({
      queryKey,
      active: { generation: 1n, dirtyThroughSequence: 5n },
      provisional: {
        generation: 2n,
        evaluationDisposition: {
          _tag: "blocked",
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      },
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(scan.provisional?.evaluationDisposition)).toBe(
      true,
    );
  });

  it("decodes pending content and enforces completion ownership", () => {
    const scope = success(
      decodeDeploymentQuerySyncGeneration3ScopeRowResult(scopeRow()),
    ).facts;
    const query = success(decodeDeploymentQuerySyncCompleteQueryRowResult(
      completeQueryRow(),
      scope,
    ));
    const row = {
      query_key: queryKey,
      generation: "1",
      query_identity: queryIdentity,
      completed_through_sequence: "4",
      result_digest: resultDigest,
      content,
    };
    const publication = success(
      decodeDeploymentQuerySyncPendingPublicationRowResult(
        row,
        scope,
        query,
      ),
    );

    expect(publication).toMatchObject({
      identity: { queryKey, generation: 1n },
      queryIdentity,
      completedThroughSequence: 4n,
      resultDigest,
      content,
    });
    expect(Object.isFrozen(publication)).toBe(true);
    expect(Object.isFrozen(publication.identity)).toBe(true);
    expect(encodeDeploymentQuerySyncPendingPublicationRow(publication)).toEqual(
      row,
    );
    expect(failure(decodeDeploymentQuerySyncPendingPublicationRowResult({
      ...row,
      completed_through_sequence: "3",
    }, scope, query))).toMatchObject({
      reason: "pendingPublicationFactsInvalid",
    });
    expect(failure(decodeDeploymentQuerySyncPendingPublicationRowResult({
      ...row,
      completed_through_sequence: "6",
    }, scope, query))).toMatchObject({
      reason: "pendingPublicationFactsInvalid",
      field: null,
    });
    expect(failure(decodeDeploymentQuerySyncPendingPublicationRowResult({
      ...row,
      completed_through_sequence: "not-a-sequence",
      query_identity: "not-an-identity",
    }, scope, query))).toMatchObject({
      reason: "valueInvalid",
      field: "completed_through_sequence",
    });
    expect(failure(decodeDeploymentQuerySyncPendingPublicationRowResult({
      ...row,
      completed_through_sequence: "6",
      result_digest: "=",
      content: "=",
    }, scope, query))).toMatchObject({
      reason: "valueInvalid",
      field: "result_digest",
    });
  });

  it("decodes ordered role-specific dependency sets with exact ownership", () => {
    const query = success(decodeDeploymentQuerySyncCompleteQueryRowResult(
      completeQueryRow(),
      success(decodeDeploymentQuerySyncGeneration3ScopeRowResult(
        scopeRow(),
      )).facts,
    ));
    const decodedDependency = success(
      decodeDeploymentQuerySyncDependencyRowResult({
        role: "completion",
        query_key: query.descriptor.queryKey,
        generation: "1",
        dependency_key: dependencyKey,
      }),
    );
    const encoded = encodeDeploymentQuerySyncDependencyRow(
      decodedDependency,
    );
    const dependencies = success(
      decodeDeploymentQuerySyncDependencyRowsResult([encoded], {
        role: "completion",
        queryKey: query.descriptor.queryKey,
        generation: decodedDependency.generation,
      }),
    );

    expect(dependencies).toEqual({
      queryKey,
      generation: 1n,
      dependencyKeys: [dependencyKey],
    });
    expect(Object.isFrozen(dependencies)).toBe(true);
    expect(Object.isFrozen(dependencies.dependencyKeys)).toBe(true);
    expect(failure(decodeDeploymentQuerySyncDependencyRowsResult(
      [encoded],
      {
        role: "active",
        queryKey: query.descriptor.queryKey,
        generation: decodedDependency.generation,
      },
    ))).toMatchObject({ reason: "queryFactsInvalid" });
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
