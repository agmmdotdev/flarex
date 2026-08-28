import { Cause, Clock, Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  capturePublicationAttemptInstant,
  captureQueryPublicationArtifact,
  claimEvaluationWork,
  claimPublication,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  QuerySyncInvariantDefect,
} from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  makeReferenceQuerySyncStateHarness,
  makeAcceptedQueryPublicationEvidenceForTesting,
  makeQueryEvaluationAttemptForTesting,
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
  it("defects when the state clock cannot be captured as a publication instant", async () => {
    const bootstrapCursor = cursor();
    const invalidClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => Number.NaN,
      currentTimeMillis: Effect.succeed(Number.NaN),
      currentTimeNanosUnsafe: () => 0n,
      currentTimeNanos: Effect.succeed(0n),
      sleep: () => Effect.void,
    };
    const exit = await runEffect(Effect.gen(function* () {
      const harness = yield* makeReferenceQuerySyncStateHarness();
      const transitionState = harness.bind(bindingFor(
        "physical-namespace-invalid-clock",
        bootstrapCursor,
      ));
      yield* transitionState.initializeOrInspectNamespace(bootstrapCursor);
      return yield* Effect.exit(transitionState.claimPublication());
    }).pipe(Effect.provideService(Clock.Clock, invalidClock)));

    if (exit._tag !== "Failure") {
      throw new Error("Expected invalid state clock to defect");
    }
    const defect = Cause.findDefect(exit.cause);
    Result.match(defect, {
      onFailure: () => expect.unreachable("Expected a retained defect"),
      onSuccess: (observedDefect) => expect(observedDefect).toMatchObject({
        _tag: "QuerySyncInvariantDefect",
        operation: "claimPublication",
        invariant: "stateClockInstantInvalid",
      } satisfies Partial<QuerySyncInvariantDefect>),
    });
  });

  it("matches one mixed evaluation and publication work history under the state-owned clock", async () => {
    const bootstrapCursor = cursor();
    const queryTarget = target();
    const beginRequest = Object.freeze({
      target: queryTarget,
      expectedActiveGeneration: null,
      requestedDirtyThroughSequence: null,
    });
    const initial = getSuccess(createEmptyQuerySyncState(bootstrapCursor));
    const begun = getSuccess(beginQueryEvaluation(initial, beginRequest));
    const evaluationClaim = getSuccess(claimEvaluationWork(begun.state, {
      maximumQueryInspections: 1,
      continuation: null,
    }));
    if (evaluationClaim._tag !== "claimed") {
      throw new Error("Expected preparatory evaluation work claim");
    }
    const queryEvaluation = evaluation({
      descriptor: queryTarget.descriptor,
      generation: evaluationClaim.attempt.generation,
      snapshot: 0n,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      bootstrapCursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const publication = getSuccess(captureQueryPublicationArtifact({
      content: canonicalText("mixed-c1-c2-publication"),
    }));
    const completed = getSuccess(completeQueryEvaluation(
      evaluationClaim.state,
      evaluationClaim.attempt,
      queryEvaluation,
      refresh,
      publication,
    ));
    if (completed._tag !== "completed") {
      throw new Error("Expected preparatory evaluation completion");
    }
    const capturedNow = getSuccess(capturePublicationAttemptInstant(1_000));
    const publicationClaim = getSuccess(claimPublication(
      completed.state,
      capturedNow,
    ));
    if (publicationClaim._tag !== "claimed") {
      throw new Error("Expected preparatory publication claim");
    }
    const acceptance = makeAcceptedQueryPublicationEvidenceForTesting({
      identity: publicationClaim.attempt.publication.identity,
      resultDigest: publicationClaim.attempt.publication.resultDigest,
    });

    const steps = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(1_000);
      const harness = yield* makeReferenceQuerySyncStateHarness();
      const transitionState = harness.bind(bindingFor(
        "physical-namespace-mixed-c1-c2",
        bootstrapCursor,
      ));
      return yield* runStateConformanceCommands(transitionState, {
        initialExpectedState: null,
        commands: [
          { _tag: "initializeOrInspectNamespace", bootstrapCursor },
          { _tag: "beginQueryEvaluation", request: beginRequest },
          {
            _tag: "claimEvaluationWork",
            request: {
              maximumQueryInspections: 1,
              continuation: null,
            },
          },
          {
            _tag: "recordEvaluationAttemptOutcome",
            attempt: evaluationClaim.attempt,
            outcome: "transientExhausted",
          },
          {
            _tag: "completeQueryEvaluation",
            attempt: evaluationClaim.attempt,
            evaluation: queryEvaluation,
            refresh,
            publication,
          },
          { _tag: "claimPublication" },
          {
            _tag: "recordPublicationAttemptOutcome",
            attempt: publicationClaim.attempt,
            outcome: "knownNotAppended",
          },
          { _tag: "completePublication", evidence: acceptance },
        ],
      });
    }).pipe(Effect.provide(TestClock.layer())));

    expect(steps.map((step) => getSuccess(step.outcome)._tag)).toEqual([
      "initialized",
      "created",
      "claimed",
      "eligible",
      "completed",
      "claimed",
      "recorded",
      "completed",
    ]);
    for (const step of steps) {
      expect(step.outcome).toEqual(step.expectedOutcome);
      expect(step.snapshot).toEqual(step.expectedSnapshot);
    }
  });

  it("preserves state-issued opaque work values through receipt projection", async () => {
    const bootstrapCursor = cursor();
    await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(2_000);
      const harness = yield* makeReferenceQuerySyncStateHarness();
      const transitionState = harness.bind(bindingFor(
        "physical-namespace-issued-work",
        bootstrapCursor,
      ));
      yield* transitionState.initializeOrInspectNamespace(bootstrapCursor);
      yield* transitionState.beginQueryEvaluation({
        target: target(),
        expectedActiveGeneration: null,
        requestedDirtyThroughSequence: null,
      });
      const evaluationClaim = yield* transitionState.claimEvaluationWork({
        maximumQueryInspections: 1,
        continuation: null,
      });
      if (evaluationClaim._tag !== "claimed") {
        return yield* Effect.die(new Error(
          "Expected state-issued evaluation work",
        ));
      }
      expect(Object.isFrozen(evaluationClaim.attempt)).toBe(true);
      expect(Object.isFrozen(evaluationClaim.continuation)).toBe(true);
      expect((yield* transitionState.recordEvaluationAttemptOutcome(
        evaluationClaim.attempt,
        "transientExhausted",
      ))._tag).toBe("eligible");

      const queryEvaluation = evaluation({
        descriptor: evaluationClaim.attempt.descriptor,
        generation: evaluationClaim.attempt.generation,
        snapshot: 0n,
      });
      const refresh = getSuccess(deriveGenerationRefreshEvidence(
        queryEvaluation,
        bootstrapCursor,
        [],
        queryEvaluation.authorityWitness,
      ));
      expect((yield* transitionState.completeQueryEvaluation(
        evaluationClaim.attempt,
        queryEvaluation,
        refresh,
        getSuccess(captureQueryPublicationArtifact({
          content: canonicalText("issued-work-publication"),
        })),
      ))._tag).toBe("completed");

      const publicationClaim = yield* transitionState.claimPublication();
      if (publicationClaim._tag !== "claimed") {
        return yield* Effect.die(new Error(
          "Expected state-issued publication work",
        ));
      }
      expect(Object.isFrozen(publicationClaim.attempt)).toBe(true);
      expect((yield* transitionState.recordPublicationAttemptOutcome(
        publicationClaim.attempt,
        "knownNotAppended",
      ))._tag).toBe("recorded");
      const acceptance = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: publicationClaim.attempt.publication.identity,
        resultDigest: publicationClaim.attempt.publication.resultDigest,
      });
      expect((yield* transitionState.completePublication(acceptance))._tag)
        .toBe("completed");
    }).pipe(Effect.provide(TestClock.layer())));
  });

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
    const beginRequest = Object.freeze({
      target: queryTarget,
      expectedActiveGeneration: null,
      requestedDirtyThroughSequence: null,
    });
    const attempt = makeQueryEvaluationAttemptForTesting({
      namespaceId: bootstrapCursor.namespaceId,
      syncModelId: bootstrapCursor.syncModelId,
      sourceEpoch: bootstrapCursor.sourceEpoch,
      descriptor: queryTarget.descriptor,
      generation: queryEvaluation.generation,
      expectedActiveGeneration: null,
      registrationCursor: bootstrapCursor,
      requestedDirtyThroughSequence: null,
    });
    const publication = getSuccess(captureQueryPublicationArtifact({
      content: canonicalText("conformance-publication"),
    }));
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
            _tag: "beginQueryEvaluation",
            request: beginRequest,
          },
          {
            _tag: "applyAdmittedBatchAndAdvance",
            batch: admittedBatch,
          },
          {
            _tag: "completeQueryEvaluation",
            attempt,
            evaluation: queryEvaluation,
            refresh,
            publication,
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
    const beginRequest = Object.freeze({
      target: queryTarget,
      expectedActiveGeneration: null,
      requestedDirtyThroughSequence: null,
    });
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
      transitionState.beginQueryEvaluation(beginRequest),
      transitionState.beginQueryEvaluation(beginRequest),
    ], { concurrency: "unbounded" }));
    expect(beginReceipts.filter(
      (receipt) => receipt._tag === "created",
    )).toHaveLength(1);
    expect(beginReceipts.filter(
      (receipt) => receipt._tag === "replayed",
    )).toHaveLength(1);
    const firstBegin = beginReceipts[0];
    const secondBegin = beginReceipts[1];
    if (
      firstBegin === undefined
      || secondBegin === undefined
      || !("attempt" in firstBegin)
      || !("attempt" in secondBegin)
    ) {
      throw new Error("Expected created and replayed evaluation attempts");
    }
    expect(firstBegin.attempt.generation).toBe(1n);
    expect(secondBegin.attempt.generation).toBe(1n);
    expect(firstBegin.attempt.registrationCursor).toEqual(
      secondBegin.attempt.registrationCursor,
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
