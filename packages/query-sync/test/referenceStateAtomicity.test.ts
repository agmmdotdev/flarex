import { describe, expect, it } from "vitest";

import {
  QueryGenerationMismatchError,
} from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStateCommitOutcomeUnknownError,
  QuerySyncStateUnavailableError,
  QuerySyncStoredStateCorruptError,
} from "@flarex/query-sync/internal/state";
import {
  makeReferenceQuerySyncStateHarness,
  ReferenceStateSnapshotBindingError,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceStateBinding,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  cursor,
  evaluation,
  getSuccess,
  target,
} from "./fixtures.js";
import { runEffect, runEffectFailure } from "./effectBoundary.js";

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

describe("reference transition-state atomicity", () => {
  it("captures only declared binding and fault fields", async () => {
    const bootstrapCursor = cursor();
    let extraGetterReads = 0;
    const poison = <A extends object>(value: A): A => Object.defineProperty(
      value,
      "unmeasured",
      {
        enumerable: true,
        get: () => {
          extraGetterReads += 1;
          throw new Error("Undeclared reference-state field was traversed.");
        },
      },
    );
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(poison({
      physicalNamespaceId: "physical-exact-fields",
      namespaceId: bootstrapCursor.namespaceId,
      syncModelId: bootstrapCursor.syncModelId,
      sourceEpoch: bootstrapCursor.sourceEpoch,
    }));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    await runEffect(transitionState.injectNextFault(poison({
      operation: "beginQueryGeneration" as const,
      timing: "beforeSwap" as const,
    })));

    expect(extraGetterReads).toBe(0);
    const failure = await runEffectFailure(
      transitionState.beginQueryGeneration(target()),
    );
    expect(failure).toBeInstanceOf(QuerySyncStateUnavailableError);
    expect(failure).toMatchObject({
      operation: "beginQueryGeneration",
      commitCertainty: "notCommitted",
    });
    expect(extraGetterReads).toBe(0);
  });

  it("leaves state unchanged on a before-swap failure and classifies a safe retry", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-before-swap",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    const before = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));

    await runEffect(transitionState.injectNextFault({
      operation: "beginQueryGeneration",
      timing: "beforeSwap",
    }));
    const failure = await runEffectFailure(
      transitionState.beginQueryGeneration(target()),
    );
    expect(failure).toBeInstanceOf(QuerySyncStateUnavailableError);
    expect(failure).toMatchObject({
      operation: "beginQueryGeneration",
      commitCertainty: "notCommitted",
      reason: "temporarilyUnavailable",
    });
    expect(await runEffect(
      transitionState.snapshotForConformance(),
    )).toBe(before);

    expect(await runEffect(
      transitionState.beginQueryGeneration(target()),
    )).toMatchObject({
      _tag: "created",
      generation: 1n,
    });
  });

  it("preserves an after-swap begin and demonstrates why an unknown begin cannot be blindly retried", async () => {
    const bootstrapCursor = cursor();
    const queryTarget = target();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-unknown-begin",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    await runEffect(transitionState.injectNextFault({
      operation: "beginQueryGeneration",
      timing: "afterSwap",
    }));

    const failure = await runEffectFailure(
      transitionState.beginQueryGeneration(queryTarget),
    );
    expect(failure).toBeInstanceOf(
      QuerySyncStateCommitOutcomeUnknownError,
    );
    expect(failure).toMatchObject({
      operation: "beginQueryGeneration",
      commitCertainty: "unknown",
      reason: "responseLostAfterCommit",
    });

    const committedBegin = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(committedBegin.queries[0]?.provisional).toMatchObject({
      generation: 1n,
      registrationCursor: bootstrapCursor,
    });

    const queryEvaluation = evaluation({
      generation: 1n,
      snapshot: 0n,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      committedBegin.cursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    expect(await runEffect(transitionState.completeQueryGeneration(
      queryEvaluation,
      refresh,
    ))).toMatchObject({
      _tag: "completed",
      generation: 1n,
    });

    expect(await runEffect(
      transitionState.beginQueryGeneration(queryTarget),
    )).toMatchObject({
      _tag: "created",
      generation: 2n,
    });
  });

  it("preserves an after-swap completion and makes replay ambiguity observable", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-unknown-complete",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    const begun = await runEffect(
      transitionState.beginQueryGeneration(target()),
    );
    const queryEvaluation = evaluation({
      descriptor: begun.descriptor,
      generation: begun.generation,
      snapshot: begun.registrationCursor.appliedThroughSequence,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      begun.registrationCursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    await runEffect(transitionState.injectNextFault({
      operation: "completeQueryGeneration",
      timing: "afterSwap",
    }));

    const failure = await runEffectFailure(
      transitionState.completeQueryGeneration(queryEvaluation, refresh),
    );
    expect(failure).toBeInstanceOf(
      QuerySyncStateCommitOutcomeUnknownError,
    );
    expect(failure).toMatchObject({
      operation: "completeQueryGeneration",
      commitCertainty: "unknown",
      reason: "responseLostAfterCommit",
    });

    const committedCompletion = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(committedCompletion.queries[0]?.active).toMatchObject({
      generation: 1n,
      dirtyThroughSequence: null,
    });
    expect(committedCompletion.queries[0]?.provisional).toBeNull();

    const retryFailure = await runEffectFailure(
      transitionState.completeQueryGeneration(queryEvaluation, refresh),
    );
    expect(retryFailure).toBeInstanceOf(QueryGenerationMismatchError);
    expect(retryFailure).toMatchObject({
      expectedGeneration: null,
      observedGeneration: 1n,
    });
  });

  it("refuses a different logical namespace bound to the same physical store entry", async () => {
    const victimCursor = cursor({ namespaceId: "tenant-a" });
    const attackerCursor = cursor({ namespaceId: "tenant-b" });
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const victim = harness.bind(bindingFor(
      "shared-physical-namespace",
      victimCursor,
    ));
    const attacker = harness.bind(bindingFor(
      "shared-physical-namespace",
      attackerCursor,
    ));
    await runEffect(victim.initializeOrInspectNamespace(victimCursor));
    await runEffect(victim.beginQueryGeneration(target({
      namespaceId: "tenant-a",
    })));
    const victimBeforeAttack = requireState(await runEffect(
      victim.snapshotForConformance(),
    ));

    const snapshotFailure = await runEffectFailure(
      attacker.snapshotForConformance(),
    );
    expect(snapshotFailure).toBeInstanceOf(
      ReferenceStateSnapshotBindingError,
    );
    expect(snapshotFailure).toMatchObject({
      operation: "snapshotForConformance",
      reason: "boundAuthorityMismatch",
    });

    const initializationFailure = await runEffectFailure(
      attacker.initializeOrInspectNamespace(attackerCursor),
    );
    expect(initializationFailure).toBeInstanceOf(
      QuerySyncStoredStateCorruptError,
    );
    expect(initializationFailure).toMatchObject({
      operation: "initializeOrInspectNamespace",
      commitCertainty: "notCommitted",
      reason: "namespaceBindingMismatch",
    });

    const beginFailure = await runEffectFailure(
      attacker.beginQueryGeneration(target({ namespaceId: "tenant-b" })),
    );
    expect(beginFailure).toBeInstanceOf(
      QuerySyncStoredStateCorruptError,
    );
    expect(beginFailure).toMatchObject({
      operation: "beginQueryGeneration",
      commitCertainty: "notCommitted",
      reason: "namespaceBindingMismatch",
    });
    expect(await runEffect(victim.snapshotForConformance())).toBe(
      victimBeforeAttack,
    );

    const isolatedAttacker = harness.bind(bindingFor(
      "separate-physical-namespace",
      attackerCursor,
    ));
    expect(await runEffect(
      isolatedAttacker.initializeOrInspectNamespace(attackerCursor),
    )).toMatchObject({
      _tag: "initialized",
      cursor: attackerCursor,
    });
  });

  it("reports a previously initialized aggregate that disappears as corruption", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-lost-state",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    await runEffect(transitionState.simulateAggregateLossForConformance());

    const failure = await runEffectFailure(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    expect(failure).toBeInstanceOf(QuerySyncStoredStateCorruptError);
    expect(failure).toMatchObject({
      operation: "initializeOrInspectNamespace",
      commitCertainty: "notCommitted",
      reason: "aggregateMissing",
    });
    expect(await runEffect(
      transitionState.snapshotForConformance(),
    )).toBeNull();
  });
});
