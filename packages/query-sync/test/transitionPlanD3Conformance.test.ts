import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  QueryDescriptor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  applyClaimEvaluationWorkTransition,
} from "../src/kernel/TransitionPlanAggregate.js";
import {
  executeNormalizedClaimEvaluationWork,
  normalizeQuerySyncState,
} from "../src/testing/conformance/NormalizedTransitionPlan.js";
import {
  batch,
  canonicalText,
  cursor,
  descriptor,
  evaluation,
  firstEvaluationRequest,
  getSuccess,
  publicationArtifact,
  target,
} from "./fixtures.js";

function emptyState(): QuerySyncState {
  return getSuccess(createEmptyQuerySyncState(cursor()));
}

function readyState(queryDescriptor = descriptor()): QuerySyncState {
  return getSuccess(beginQueryEvaluation(
    emptyState(),
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  )).state;
}

function cleanState(
  queryDescriptor: QueryDescriptor,
  dependency: string,
): QuerySyncState {
  const begun = getSuccess(beginQueryEvaluation(
    emptyState(),
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  ));
  if (begun._tag !== "created") {
    throw new Error("Expected an initial evaluation attempt.");
  }
  const queryEvaluation = evaluation({
    descriptor: begun.attempt.descriptor,
    generation: begun.attempt.generation,
    snapshot: begun.attempt.registrationCursor.appliedThroughSequence,
    dependencies: [dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    begun.state.cursor,
    [],
    queryEvaluation.authorityWitness,
  ));
  return getSuccess(completeQueryEvaluation(
    begun.state,
    begun.attempt,
    queryEvaluation,
    refresh,
    publicationArtifact("d3-claim-conformance"),
  )).state;
}

function expectClaimConformance(state: QuerySyncState) {
  const request = Object.freeze({
    maximumQueryInspections: 1,
    continuation: null,
  });
  const aggregate = getSuccess(applyClaimEvaluationWorkTransition(
    state,
    request,
  ));
  const normalized = getSuccess(executeNormalizedClaimEvaluationWork(
    normalizeQuerySyncState(state),
    request,
  ));
  expect(normalized.receipt).toEqual(aggregate.plan.receipt);
  expect(normalized.plan).toEqual(aggregate.plan);
  expect(normalized.disposition).toBe(aggregate.disposition);
  expect(normalized.state).toEqual(aggregate.decision.state);
  return Object.freeze({ aggregate, normalized });
}

describe("QSYNC01-D3 independent claim interpretation", () => {
  it("matches the aggregate adapter for a fairness-only ready claim", () => {
    const state = readyState(descriptor({
      keySeed: 81,
      identity: "d3-ready-conformance",
    }));
    const result = expectClaimConformance(state);
    expect(result.aggregate.disposition).toBe("write");
    expect(result.aggregate.plan).toMatchObject({
      _tag: "write",
      change: { _tag: "claimReadyEvaluationWork" },
      receipt: { _tag: "claimed", attempt: { generation: 1n } },
      nextScope: {
        evaluationWork: { revision: state.evaluationWork.revision },
      },
    });
  });

  it("matches the aggregate adapter for a successor dirty claim", () => {
    const dependency = canonicalText("d3-dirty-conformance");
    const clean = cleanState(descriptor({
      keySeed: 82,
      identity: "d3-dirty-conformance",
    }), dependency);
    const dirty = getSuccess(applyAdmittedInvalidations(clean, batch({
      sequence: 1n,
      dependencies: [dependency],
    }))).state;
    const result = expectClaimConformance(dirty);
    expect(result.aggregate.disposition).toBe("write");
    expect(result.aggregate.plan).toMatchObject({
      _tag: "write",
      change: {
        _tag: "claimDirtyEvaluationWork",
        provisional: {
          generation: 2n,
          expectedActiveGeneration: 1n,
          requestedDirtyThroughSequence: 1n,
        },
      },
      nextScope: {
        evaluationWork: {
          revision: dirty.evaluationWork.revision + 1n,
        },
      },
    });
  });
});
