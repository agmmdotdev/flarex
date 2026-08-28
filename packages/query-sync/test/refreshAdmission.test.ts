import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  admitGenerationRefreshEvidence,
  makeAdmittedChangeSource,
  MAX_MODEL_SEMANTIC_BYTES,
  MAX_MODEL_SEMANTIC_WORK_UNITS,
  MAX_PROJECTED_CANONICAL_BYTES,
  MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  MAX_SOURCE_PAGE_BATCHES,
  MAX_SOURCE_TRANSPORT_BYTES,
} from "@flarex/query-sync/internal/change";
import type {
  CaughtUpChangeAuthority,
  ChangeReadBudget,
} from "@flarex/query-sync/internal/change";
import { InvalidRefreshEvidenceError } from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  captureKeyValueAuthorityObservation,
  captureKeyValueChangeDependencyKey,
  captureKeyValueCommittedPayload,
  makeKeyValueInvalidationProjector,
  makeReferenceReplayableChangeSource,
} from "@flarex/query-sync/testing/conformance";

import { cursor, evaluation, getSuccess } from "./fixtures.js";
import { runEffect } from "./effectBoundary.js";

const HARD_BUDGET: ChangeReadBudget = Object.freeze({
  committedBatches: MAX_SOURCE_PAGE_BATCHES,
  sourceTransportBytes: MAX_SOURCE_TRANSPORT_BYTES,
  modelSemanticWorkUnits: MAX_MODEL_SEMANTIC_WORK_UNITS,
  modelSemanticBytes: MAX_MODEL_SEMANTIC_BYTES,
  dependencyKeyExaminations: MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  canonicalDependencyBytes: MAX_PROJECTED_CANONICAL_BYTES,
});

function sequence(value: bigint): SyncSequence {
  return cursor({ sequence: value }).appliedThroughSequence;
}

async function admittedInterval() {
  const binding = cursor();
  const source = await runEffect(makeReferenceReplayableChangeSource({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    replayableAfterSequenceExclusive: sequence(0n),
    observedLatestSequence: sequence(2n),
    batches: [
      {
        sourceSequence: sequence(1n),
        payload: { changes: [{ key: "unrelated", kind: "set" as const }] },
        transportBytes: 4,
      },
      {
        sourceSequence: sequence(2n),
        payload: { changes: [{ key: "relevant", kind: "set" as const }] },
        transportBytes: 4,
      },
    ],
    authorityObservation: { revision: 2, partitions: ["primary"] },
    authorityTransportBytes: 2,
  }, {
    capturePayload: captureKeyValueCommittedPayload,
    captureAuthorityObservation: captureKeyValueAuthorityObservation,
  }));
  const admittedSource = makeAdmittedChangeSource(
    source,
    makeKeyValueInvalidationProjector(binding.syncModelId),
  );
  const read = await runEffect(admittedSource.readAfter({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    requestedAfterSequenceExclusive: sequence(0n),
  }, HARD_BUDGET));
  if (read._tag !== "page" || read.caughtUpAuthority === null) {
    throw new Error("Expected one complete admitted source interval.");
  }
  return Object.freeze({
    binding,
    batches: read.batches,
    authority: read.caughtUpAuthority,
  });
}

function proveCaughtUpAuthorityIsNominal(
  binding: NamespaceCursor,
): void {
  type StructuralAuthority = Readonly<{
    readonly namespaceId: NamespaceCursor["namespaceId"];
    readonly syncModelId: NamespaceCursor["syncModelId"];
    readonly sourceEpoch: NamespaceCursor["sourceEpoch"];
    readonly readThroughSequence: NamespaceCursor["appliedThroughSequence"];
    readonly authorityWitness: ReturnType<typeof evaluation>["authorityWitness"];
  }>;
  type StructuralObjectCanForgeAuthority = StructuralAuthority extends
    CaughtUpChangeAuthority ? true : false;
  const cannotForge: StructuralObjectCanForgeAuthority = false;
  expect(cannotForge).toBe(false);
  void binding;
}

describe("query-sync refresh admission", () => {
  it("derives a complete refresh only from the exact caught-up authority", async () => {
    const { authority, batches, binding } = await admittedInterval();
    proveCaughtUpAuthorityIsNominal(binding);
    const relevant = getSuccess(captureKeyValueChangeDependencyKey(
      "relevant",
    ));
    const capturedEvaluation = evaluation({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      generation: 1n,
      snapshot: 0n,
      dependencies: [relevant],
    });

    const refresh = getSuccess(admitGenerationRefreshEvidence(
      capturedEvaluation,
      batches,
      authority,
    ));
    expect(refresh).toMatchObject({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      evaluationSnapshotSequence: 0n,
      refreshedThroughSequence: 2n,
      relevantThroughSequence: 2n,
      authorityWitness: authority.authorityWitness,
    });
    expect(Object.isFrozen(refresh)).toBe(true);
    expect(Object.isFrozen(refresh.evaluationDependencyKeys)).toBe(true);
  });

  it("rejects a missing commit in the authority-bound refresh interval", async () => {
    const { authority, batches, binding } = await admittedInterval();
    const capturedEvaluation = evaluation({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      generation: 1n,
      snapshot: 0n,
    });
    const result = admitGenerationRefreshEvidence(
      capturedEvaluation,
      batches.slice(0, 1),
      authority,
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) return;
    expect(result.failure).toBeInstanceOf(InvalidRefreshEvidenceError);
    expect(result.failure).toMatchObject({
      operation: "admitGenerationRefreshEvidence",
      reason: "missingBatch",
      expectedSequence: 2n,
      observedSequence: null,
    });
  });
});
