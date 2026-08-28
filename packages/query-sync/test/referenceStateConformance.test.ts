import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
} from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  makeReferenceQuerySyncStateHarness,
  runStateConformanceCommands,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceStateBinding,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  canonicalText,
  cursor,
  evaluation,
  getSuccess,
  target,
} from "./fixtures.js";
import { runEffect } from "./effectBoundary.js";

function bindingFor(
  physicalNamespaceId: string,
  namespaceCursor: NamespaceCursor,
): ReferenceStateBinding {
  return Object.freeze({
    physicalNamespaceId,
    namespaceId: namespaceCursor.namespaceId,
    syncModelId: namespaceCursor.syncModelId,
    sourceEpoch: namespaceCursor.sourceEpoch,
  });
}

function requireState(state: QuerySyncState | null): QuerySyncState {
  if (state === null) {
    throw new Error("Expected an initialized reference state");
  }
  return state;
}

describe("reference transition-state conformance", () => {
  it("matches the pure reducer after every command without exposing aggregate state in receipts", async () => {
    const bootstrapCursor = cursor();
    const queryTarget = target();
    const unrelatedDependency = canonicalText("record:unrelated");
    const evaluatedDependency = canonicalText("record:evaluated");
    const admittedBatch = batch({
      sequence: 1n,
      dependencies: [unrelatedDependency],
    });
    const queryEvaluation = evaluation({
      generation: 1n,
      snapshot: 0n,
      dependencies: [evaluatedDependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      cursor({ sequence: 1n }),
      [admittedBatch],
      queryEvaluation.authorityWitness,
    ));

    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-conformance",
      bootstrapCursor,
    ));
    const steps = await runEffect(runStateConformanceCommands(
      transitionState,
      {
        initialExpectedState: null,
        commands: [
          {
            _tag: "initializeOrInspectNamespace",
            bootstrapCursor,
          },
          {
            _tag: "beginQueryGeneration",
            target: queryTarget,
          },
          {
            _tag: "applyAdmittedBatchAndAdvance",
            batch: admittedBatch,
          },
          {
            _tag: "completeQueryGeneration",
            evaluation: queryEvaluation,
            refresh,
          },
        ],
      },
    ));

    expect(steps.map((step) => getSuccess(step.outcome)._tag)).toEqual([
      "initialized",
      "created",
      "applied",
      "completed",
    ]);
    for (const step of steps) {
      expect(step.outcome).toEqual(step.expectedOutcome);
      expect(step.snapshot).toEqual(step.expectedSnapshot);
      expect("state" in getSuccess(step.outcome)).toBe(false);
    }
  });

  it("treats the bootstrap cursor as create-if-absent data and reports authorized binding replacement", async () => {
    const bootstrapCursor = cursor({ sequence: 4n });
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const binding = bindingFor(
      "physical-namespace-bootstrap",
      bootstrapCursor,
    );
    const transitionState = harness.bind(binding);

    const initialized = await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    expect(initialized).toMatchObject({
      _tag: "initialized",
      cursor: bootstrapCursor,
    });

    const advanced = await runEffect(
      transitionState.applyAdmittedBatchAndAdvance(batch({ sequence: 5n })),
    );
    expect(advanced).toMatchObject({
      _tag: "applied",
      appliedSequence: 5n,
    });

    const behindBootstrap = await runEffect(
      transitionState.initializeOrInspectNamespace(cursor({ sequence: 0n })),
    );
    const aheadBootstrap = await runEffect(
      transitionState.initializeOrInspectNamespace(cursor({ sequence: 99n })),
    );
    expect(behindBootstrap).toMatchObject({
      _tag: "existing",
      cursor: { appliedThroughSequence: 5n },
    });
    expect(aheadBootstrap).toMatchObject({
      _tag: "existing",
      cursor: { appliedThroughSequence: 5n },
    });

    const replacementModelCursor = cursor({
      syncModelId: "graph",
      sequence: 0n,
    });
    const replacementModel = harness.bind(bindingFor(
      binding.physicalNamespaceId,
      replacementModelCursor,
    ));
    expect(await runEffect(
      replacementModel.initializeOrInspectNamespace(replacementModelCursor),
    )).toMatchObject({
      _tag: "modelReplaced",
      existingCursor: { appliedThroughSequence: 5n },
      requestedSyncModelId: replacementModelCursor.syncModelId,
    });

    const replacementEpochCursor = cursor({
      sourceEpoch: "epoch-b",
      sequence: 0n,
    });
    const replacementEpoch = harness.bind(bindingFor(
      binding.physicalNamespaceId,
      replacementEpochCursor,
    ));
    expect(await runEffect(
      replacementEpoch.initializeOrInspectNamespace(replacementEpochCursor),
    )).toMatchObject({
      _tag: "epochReplaced",
      existingCursor: { appliedThroughSequence: 5n },
      requestedSourceEpoch: replacementEpochCursor.sourceEpoch,
    });

    expect(requireState(
      await runEffect(transitionState.snapshotForConformance()),
    ).cursor.appliedThroughSequence).toBe(5n);
  });

  it("serializes identical concurrent initialize, begin, and exact-next apply operations", async () => {
    const bootstrapCursor = cursor();
    const queryTarget = target();
    const admittedBatch = batch({ sequence: 1n });
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-concurrency",
      bootstrapCursor,
    ));

    const initializeReceipts = await runEffect(Effect.all([
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    ], { concurrency: "unbounded" }));
    expect(initializeReceipts.filter(
      (receipt) => receipt._tag === "initialized",
    )).toHaveLength(1);
    expect(initializeReceipts.filter(
      (receipt) => receipt._tag === "existing",
    )).toHaveLength(1);

    const beginReceipts = await runEffect(Effect.all([
      transitionState.beginQueryGeneration(queryTarget),
      transitionState.beginQueryGeneration(queryTarget),
    ], { concurrency: "unbounded" }));
    expect(beginReceipts.filter(
      (receipt) => receipt._tag === "created",
    )).toHaveLength(1);
    expect(beginReceipts.filter(
      (receipt) => receipt._tag === "replayed",
    )).toHaveLength(1);
    expect(beginReceipts[0]?.generation).toBe(1n);
    expect(beginReceipts[1]?.generation).toBe(1n);
    expect(beginReceipts[0]?.registrationCursor).toEqual(
      beginReceipts[1]?.registrationCursor,
    );

    const stateAfterBegin = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    const expectedApplied = getSuccess(applyAdmittedInvalidations(
      stateAfterBegin,
      admittedBatch,
    ));
    const applyReceipts = await runEffect(Effect.all([
      transitionState.applyAdmittedBatchAndAdvance(admittedBatch),
      transitionState.applyAdmittedBatchAndAdvance(admittedBatch),
    ], { concurrency: "unbounded" }));
    expect(applyReceipts.filter(
      (receipt) => receipt._tag === "applied",
    )).toHaveLength(1);
    expect(applyReceipts.filter(
      (receipt) => receipt._tag === "duplicate",
    )).toHaveLength(1);
    expect(requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ))).toEqual(expectedApplied.state);
  });
});
