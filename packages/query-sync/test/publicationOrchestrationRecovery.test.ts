import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  InvalidPublicationAttemptOutcomeReplayError,
} from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  PublicationAttempt,
  PublicationAttemptOutcome,
  QueryDescriptor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  makeNamespacePublicationSync,
  ResultPublisherKnownNotAppendedError,
  ResultPublisherOutcomeUnknownError,
  ResultPublisherTerminalRefusalError,
} from "@flarex/query-sync/internal/orchestration";
import type {
  NamespacePublicationSync,
  NamespacePublicationSyncPolicy,
  PublicationTurnBudget,
  QuerySyncPublicationState,
} from "@flarex/query-sync/internal/orchestration";
import type { QuerySyncTransitionState } from "@flarex/query-sync/internal/state";
import {
  makeReferenceQuerySyncStateHarness,
  makeReferenceResultPublisherHarness,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceQuerySyncTransitionState,
  ReferenceResultDestination,
  ReferenceResultPublisher,
  ReferenceResultPublisherStep,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  cursor,
  descriptor,
  evaluation,
  firstEvaluationRequest,
  getSuccess,
  publicationArtifact,
  target,
} from "./fixtures.js";
import { runEffect } from "./effectBoundary.js";

const RETRY_DELAYS: readonly [number, number] = Object.freeze([0, 0]);
const NO_CUTOFF_RETRY_DELAYS: readonly [number, number] = Object.freeze([
  10,
  10,
]);

const POLICY: NamespacePublicationSyncPolicy = Object.freeze({
  stateAttemptsPerOperation: 3,
  retryDelayMilliseconds: RETRY_DELAYS,
  settlementReserveMilliseconds: 10,
});

const BUDGET: PublicationTurnBudget = Object.freeze({
  publisherCalls: 32,
  newWorkWindowMilliseconds: 1_000,
});

const NO_CUTOFF_RETRY_POLICY: NamespacePublicationSyncPolicy = Object.freeze({
  stateAttemptsPerOperation: 3,
  retryDelayMilliseconds: NO_CUTOFF_RETRY_DELAYS,
  settlementReserveMilliseconds: 10,
});

const SHORT_BUDGET: PublicationTurnBudget = Object.freeze({
  publisherCalls: 32,
  newWorkWindowMilliseconds: 20,
});

interface PublicationFixture {
  readonly binding: NamespaceCursor;
  readonly state: ReferenceQuerySyncTransitionState;
  readonly destination: ReferenceResultDestination;
}

function publicationBinding(binding: NamespaceCursor) {
  return Object.freeze({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
  });
}

function requireState(state: QuerySyncState | null): QuerySyncState {
  if (state === null) {
    throw new Error("Expected an initialized query-sync state");
  }
  return state;
}

const installPendingPublication = Effect.fn(
  "QuerySync.Test.installPendingPublicationForOrchestrationRecovery",
)(function*(
  state: ReferenceQuerySyncTransitionState,
  binding: NamespaceCursor,
  queryDescriptor: QueryDescriptor,
  label: string,
) {
  const begun = yield* state.beginQueryEvaluation(firstEvaluationRequest(
    target({ descriptor: queryDescriptor }),
  ));
  if (begun._tag !== "created" && begun._tag !== "replayed") {
    return yield* Effect.die(new Error(
      "Expected an evaluation attempt while preparing publication work",
    ));
  }
  const capturedEvaluation = evaluation({
    descriptor: queryDescriptor,
    generation: begun.attempt.generation,
    snapshot: binding.appliedThroughSequence,
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    capturedEvaluation,
    begun.attempt.registrationCursor,
    [],
    capturedEvaluation.authorityWitness,
  ));
  const completion = yield* state.completeQueryEvaluation(
    begun.attempt,
    capturedEvaluation,
    refresh,
    publicationArtifact(label),
  );
  if (completion._tag !== "completed") {
    return yield* Effect.die(new Error(
      "Expected a completed evaluation while preparing publication work",
    ));
  }
});

const makePublicationFixture = Effect.fn(
  "QuerySync.Test.makePublicationOrchestrationRecoveryFixture",
)(function*(physicalNamespaceId: string) {
  const binding = cursor();
  const stateHarness = yield* makeReferenceQuerySyncStateHarness();
  const state = stateHarness.bind({
    physicalNamespaceId,
    ...publicationBinding(binding),
  });
  yield* state.initializeOrInspectNamespace(binding);
  yield* installPendingPublication(
    state,
    binding,
    descriptor(),
    physicalNamespaceId,
  );
  const publisherHarness = yield* makeReferenceResultPublisherHarness();
  const destination = yield* publisherHarness.makeDestination();
  return Object.freeze({ binding, state, destination });
});

function makeSync(input: {
  readonly binding: NamespaceCursor;
  readonly state: QuerySyncPublicationState;
  readonly publisher: ReferenceResultPublisher;
  readonly policy?: NamespacePublicationSyncPolicy;
}): NamespacePublicationSync {
  return getSuccess(makeNamespacePublicationSync({
    binding: publicationBinding(input.binding),
    state: input.state,
    publisher: input.publisher,
    policy: input.policy ?? POLICY,
  }));
}

const acceptExactStep: ReferenceResultPublisherStep = (
  call,
  destination,
) => destination.acceptExact(call.publication).pipe(Effect.asVoid);

function publisherFailureStep(
  outcome: PublicationAttemptOutcome,
): ReferenceResultPublisherStep {
  switch (outcome) {
    case "knownNotAppended":
      return () => Effect.fail(new ResultPublisherKnownNotAppendedError({
        operation: "publish",
      }));
    case "outcomeUnknown":
      return () => Effect.fail(new ResultPublisherOutcomeUnknownError({
        operation: "publish",
      }));
    case "terminalRefusal":
      return () => Effect.fail(new ResultPublisherTerminalRefusalError({
        operation: "publish",
      }));
  }
}

async function snapshotState(
  state: ReferenceQuerySyncTransitionState,
): Promise<QuerySyncState> {
  return requireState(await runEffect(state.snapshotForConformance()));
}

async function publisherCallCount(
  publisher: ReferenceResultPublisher,
): Promise<number> {
  return (await runEffect(publisher.snapshotForConformance())).length;
}

async function acceptedPublicationCount(
  destination: ReferenceResultDestination,
): Promise<number> {
  return (await runEffect(destination.snapshotForConformance()))
    .acceptedPublications.length;
}

describe("publication orchestration recovery", () => {
  it.each(["beforeSwap", "afterSwap"] as const)(
    "replays %s claim uncertainty without an extra publisher call",
    async (timing) => {
      const fixture = await runEffect(makePublicationFixture(
        `publication-claim-${timing}`,
      ));
      const publisher = await runEffect(fixture.destination.makePublisher([
        acceptExactStep,
      ]));
      let claimCalls = 0;
      const countedState: QuerySyncPublicationState = Object.freeze({
        claimPublication: () => {
          claimCalls += 1;
          return fixture.state.claimPublication();
        },
        recordPublicationAttemptOutcome:
          fixture.state.recordPublicationAttemptOutcome,
        completePublication: fixture.state.completePublication,
      });
      await runEffect(fixture.state.injectNextFault({
        operation: "claimPublication",
        timing,
      }));
      const sync = makeSync({
        binding: fixture.binding,
        state: countedState,
        publisher,
      });

      const outcome = await runEffect(sync.runPublicationWork(BUDGET));

      expect(outcome).toMatchObject({ _tag: "idle" });
      expect(claimCalls).toBe(3);
      expect(await publisherCallCount(publisher)).toBe(1);
      expect(await acceptedPublicationCount(fixture.destination)).toBe(1);
      expect((await snapshotState(fixture.state)).publicationWork.inFlight)
        .toBeNull();
    },
  );

  it.each(["beforeSwap", "afterSwap"] as const)(
    "replays %s outcome settlement with the exact attempt and outcome",
    async (timing) => {
      const fixture = await runEffect(makePublicationFixture(
        `publication-outcome-${timing}`,
      ));
      const publisher = await runEffect(fixture.destination.makePublisher([
        publisherFailureStep("knownNotAppended"),
      ]));
      const calls: Array<readonly [PublicationAttempt, PublicationAttemptOutcome]> = [];
      const countedState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome: (attempt, outcome) => {
          calls.push([attempt, outcome]);
          return fixture.state.recordPublicationAttemptOutcome(
            attempt,
            outcome,
          );
        },
        completePublication: fixture.state.completePublication,
      });
      await runEffect(fixture.state.injectNextFault({
        operation: "recordPublicationAttemptOutcome",
        timing,
      }));
      const sync = makeSync({
        binding: fixture.binding,
        state: countedState,
        publisher,
      });

      const outcome = await runEffect(sync.runPublicationWork(BUDGET));

      expect(outcome).toMatchObject({
        _tag: "continuationRequired",
        reason: "publicationOutcomeRecorded",
      });
      expect(calls).toHaveLength(2);
      expect(calls[0]?.[0]).toBe(calls[1]?.[0]);
      expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
      expect(await publisherCallCount(publisher)).toBe(1);
      expect((await snapshotState(fixture.state)).publicationWork.inFlight)
        .toMatchObject({ attemptOrdinal: 2 });
    },
  );

  it.each(["beforeSwap", "afterSwap"] as const)(
    "replays %s completion settlement with the exact nominal evidence",
    async (timing) => {
      const fixture = await runEffect(makePublicationFixture(
        `publication-completion-${timing}`,
      ));
      const publisher = await runEffect(fixture.destination.makePublisher([
        acceptExactStep,
      ]));
      const evidenceCalls: Array<Parameters<
        QuerySyncTransitionState["completePublication"]
      >[0]> = [];
      const countedState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome:
          fixture.state.recordPublicationAttemptOutcome,
        completePublication: (evidence) => {
          evidenceCalls.push(evidence);
          return fixture.state.completePublication(evidence);
        },
      });
      await runEffect(fixture.state.injectNextFault({
        operation: "completePublication",
        timing,
      }));
      const sync = makeSync({
        binding: fixture.binding,
        state: countedState,
        publisher,
      });

      const outcome = await runEffect(sync.runPublicationWork(BUDGET));

      expect(outcome).toMatchObject({ _tag: "idle" });
      expect(evidenceCalls).toHaveLength(2);
      expect(evidenceCalls[0]).toBe(evidenceCalls[1]);
      expect(await publisherCallCount(publisher)).toBe(1);
      expect(await acceptedPublicationCount(fixture.destination)).toBe(1);
      expect((await snapshotState(fixture.state)).publicationWork.inFlight)
        .toBeNull();
    },
  );

  it("restarts a lost committed claim when its retry delay reaches the admission cutoff", async () => {
    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const fixture = yield* makePublicationFixture(
        "publication-no-cutoff-claim",
      );
      const firstPublisher = yield* fixture.destination.makePublisher([
        acceptExactStep,
      ]);
      yield* fixture.state.injectNextFault({
        operation: "claimPublication",
        timing: "afterSwap",
      });
      const first = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: firstPublisher,
        policy: NO_CUTOFF_RETRY_POLICY,
      });
      const lost = yield* Effect.result(
        first.runPublicationWork(SHORT_BUDGET),
      );
      const afterLostClaim = requireState(
        yield* fixture.state.snapshotForConformance(),
      );

      const restartedPublisher = yield* fixture.destination.makePublisher([
        acceptExactStep,
      ]);
      const restarted = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: restartedPublisher,
      });
      const recovered = yield* restarted.runPublicationWork(BUDGET);
      return {
        lost,
        afterLostClaim,
        recovered,
        firstCalls: yield* firstPublisher.snapshotForConformance(),
        restartedCalls: yield* restartedPublisher.snapshotForConformance(),
        destination: yield* fixture.destination.snapshotForConformance(),
      };
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Result.isFailure(result.lost)).toBe(true);
    if (Result.isFailure(result.lost)) {
      expect(result.lost.failure).toMatchObject({
        _tag: "QuerySyncStateCommitOutcomeUnknownError",
        operation: "claimPublication",
      });
    }
    expect(result.afterLostClaim.publicationWork.inFlight).toMatchObject({
      attemptOrdinal: 1,
    });
    expect(result.firstCalls).toHaveLength(0);
    expect(result.restartedCalls).toHaveLength(1);
    expect(result.recovered._tag).toBe("idle");
    expect(result.destination.acceptedPublications).toHaveLength(1);
  });

  it("restarts at the next ordinal after a committed outcome cannot retry before settlement cutoff", async () => {
    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const fixture = yield* makePublicationFixture(
        "publication-no-cutoff-outcome",
      );
      const delayedFailure: ReferenceResultPublisherStep = () =>
        TestClock.adjust("11 millis").pipe(
          Effect.andThen(Effect.fail(
            new ResultPublisherKnownNotAppendedError({
              operation: "publish",
            }),
          )),
        );
      const firstPublisher = yield* fixture.destination.makePublisher([
        delayedFailure,
      ]);
      yield* fixture.state.injectNextFault({
        operation: "recordPublicationAttemptOutcome",
        timing: "afterSwap",
      });
      const first = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: firstPublisher,
        policy: NO_CUTOFF_RETRY_POLICY,
      });
      const lost = yield* Effect.result(
        first.runPublicationWork(SHORT_BUDGET),
      );
      const afterLostOutcome = requireState(
        yield* fixture.state.snapshotForConformance(),
      );

      const restartedPublisher = yield* fixture.destination.makePublisher([
        acceptExactStep,
      ]);
      const recovered = yield* makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: restartedPublisher,
      }).runPublicationWork(BUDGET);
      return {
        lost,
        afterLostOutcome,
        recovered,
        firstCalls: yield* firstPublisher.snapshotForConformance(),
        restartedCalls: yield* restartedPublisher.snapshotForConformance(),
        destination: yield* fixture.destination.snapshotForConformance(),
      };
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Result.isFailure(result.lost)).toBe(true);
    if (Result.isFailure(result.lost)) {
      expect(result.lost.failure).toMatchObject({
        _tag: "QuerySyncStateCommitOutcomeUnknownError",
        operation: "recordPublicationAttemptOutcome",
      });
    }
    expect(result.afterLostOutcome.publicationWork.inFlight).toMatchObject({
      attemptOrdinal: 2,
      disposition: { _tag: "ready" },
    });
    expect(result.firstCalls).toHaveLength(1);
    expect(result.restartedCalls).toHaveLength(1);
    expect(result.recovered._tag).toBe("idle");
    expect(result.destination.acceptedPublications).toHaveLength(1);
  });

  it("never republishes after completion committed but its response could not retry", async () => {
    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const fixture = yield* makePublicationFixture(
        "publication-no-cutoff-completion",
      );
      const acceptThenAdvance: ReferenceResultPublisherStep = (
        call,
        destination,
      ) => destination.acceptExact(call.publication).pipe(
        Effect.andThen(TestClock.adjust("11 millis")),
        Effect.asVoid,
      );
      const firstPublisher = yield* fixture.destination.makePublisher([
        acceptThenAdvance,
      ]);
      yield* fixture.state.injectNextFault({
        operation: "completePublication",
        timing: "afterSwap",
      });
      const first = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: firstPublisher,
        policy: NO_CUTOFF_RETRY_POLICY,
      });
      const lost = yield* Effect.result(
        first.runPublicationWork(SHORT_BUDGET),
      );
      const afterLostCompletion = requireState(
        yield* fixture.state.snapshotForConformance(),
      );

      const restartedPublisher = yield* fixture.destination.makePublisher([]);
      const recovered = yield* makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: restartedPublisher,
      }).runPublicationWork(BUDGET);
      return {
        lost,
        afterLostCompletion,
        recovered,
        firstCalls: yield* firstPublisher.snapshotForConformance(),
        restartedCalls: yield* restartedPublisher.snapshotForConformance(),
        destination: yield* fixture.destination.snapshotForConformance(),
      };
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Result.isFailure(result.lost)).toBe(true);
    if (Result.isFailure(result.lost)) {
      expect(result.lost.failure).toMatchObject({
        _tag: "QuerySyncStateCommitOutcomeUnknownError",
        operation: "completePublication",
      });
    }
    expect(result.afterLostCompletion.publicationWork.inFlight).toBeNull();
    expect(result.firstCalls).toHaveLength(1);
    expect(result.restartedCalls).toHaveLength(0);
    expect(result.recovered._tag).toBe("idle");
    expect(result.destination.acceptedPublications).toHaveLength(1);
  });

  it("returns reset-required after a committed terminal block cannot retry", async () => {
    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const fixture = yield* makePublicationFixture(
        "publication-no-cutoff-terminal",
      );
      const delayedTerminal: ReferenceResultPublisherStep = () =>
        TestClock.adjust("11 millis").pipe(
          Effect.andThen(Effect.fail(
            new ResultPublisherTerminalRefusalError({
              operation: "publish",
            }),
          )),
        );
      const firstPublisher = yield* fixture.destination.makePublisher([
        delayedTerminal,
      ]);
      yield* fixture.state.injectNextFault({
        operation: "recordPublicationAttemptOutcome",
        timing: "afterSwap",
      });
      const first = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: firstPublisher,
        policy: NO_CUTOFF_RETRY_POLICY,
      });
      const lost = yield* Effect.result(
        first.runPublicationWork(SHORT_BUDGET),
      );

      const restartedPublisher = yield* fixture.destination.makePublisher([]);
      const recovered = yield* makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: restartedPublisher,
      }).runPublicationWork(BUDGET);
      return {
        lost,
        recovered,
        restartedCalls: yield* restartedPublisher.snapshotForConformance(),
        state: requireState(yield* fixture.state.snapshotForConformance()),
      };
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Result.isFailure(result.lost)).toBe(true);
    if (Result.isFailure(result.lost)) {
      expect(result.lost.failure).toMatchObject({
        _tag: "QuerySyncStateCommitOutcomeUnknownError",
        operation: "recordPublicationAttemptOutcome",
      });
    }
    expect(result.recovered).toMatchObject({
      _tag: "publicationResetRequired",
      reason: "terminalPublisherRefusal",
    });
    expect(result.restartedCalls).toHaveLength(0);
    expect(result.state.publicationWork.inFlight?.disposition).toMatchObject({
      _tag: "blocked",
      reason: "terminalPublisherRefusal",
    });
  });

  it.each([
    "defectBeforeAppend",
    "interruptionBeforeAppend",
    "appendThenInterruption",
  ] as const)(
    "preserves publisher Cause for %s and restarts the unresolved attempt",
    async (mode) => {
      const fixture = await runEffect(makePublicationFixture(
        `publication-publisher-cause-${mode}`,
      ));
      const defect = Object.freeze({
        source: "reference-result-publisher",
        mode,
      });
      const step: ReferenceResultPublisherStep = mode === "defectBeforeAppend"
        ? () => Effect.die(defect)
        : mode === "interruptionBeforeAppend"
          ? () => Effect.interrupt
          : (call, destination) =>
            destination.acceptExact(call.publication).pipe(
              Effect.andThen(Effect.interrupt),
            );
      const publisher = await runEffect(fixture.destination.makePublisher([
        step,
      ]));
      let outcomeSettlements = 0;
      let completionSettlements = 0;
      const countedState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome: (attempt, outcome) => {
          outcomeSettlements += 1;
          return fixture.state.recordPublicationAttemptOutcome(
            attempt,
            outcome,
          );
        },
        completePublication: (evidence) => {
          completionSettlements += 1;
          return fixture.state.completePublication(evidence);
        },
      });
      const exit = await runEffect(Effect.exit(makeSync({
        binding: fixture.binding,
        state: countedState,
        publisher,
      }).runPublicationWork(BUDGET)));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        if (mode === "defectBeforeAppend") {
          expect(Cause.squash(exit.cause)).toBe(defect);
        } else {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        }
      }
      expect(outcomeSettlements).toBe(0);
      expect(completionSettlements).toBe(0);
      expect((await snapshotState(fixture.state)).publicationWork.inFlight)
        .toMatchObject({ attemptOrdinal: 1 });
      expect(await acceptedPublicationCount(fixture.destination)).toBe(
        mode === "appendThenInterruption" ? 1 : 0,
      );

      const restartedPublisher = await runEffect(
        fixture.destination.makePublisher([acceptExactStep]),
      );
      const recovered = await runEffect(makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: restartedPublisher,
      }).runPublicationWork(BUDGET));
      expect(recovered._tag).toBe("idle");
      expect(await publisherCallCount(restartedPublisher)).toBe(1);
      expect(await acceptedPublicationCount(fixture.destination)).toBe(1);
      expect((await snapshotState(fixture.state)).publicationWork.inFlight)
        .toBeNull();
    },
  );

  it.each([
    ["claim", "defect", "beforeDelegate"],
    ["claim", "defect", "afterDelegate"],
    ["claim", "interruption", "beforeDelegate"],
    ["claim", "interruption", "afterDelegate"],
    ["outcome", "defect", "beforeDelegate"],
    ["outcome", "defect", "afterDelegate"],
    ["outcome", "interruption", "beforeDelegate"],
    ["outcome", "interruption", "afterDelegate"],
    ["completion", "defect", "beforeDelegate"],
    ["completion", "defect", "afterDelegate"],
    ["completion", "interruption", "beforeDelegate"],
    ["completion", "interruption", "afterDelegate"],
  ] as const)(
    "preserves a state %s %s at %s and reconciles on restart",
    async (stage, failureMode, timing) => {
      const fixture = await runEffect(makePublicationFixture(
        `publication-state-cause-${stage}-${failureMode}-${timing}`,
      ));
      const defect = Object.freeze({
        source: "reference-publication-state",
        stage,
      });
      const terminate = failureMode === "defect"
        ? Effect.die(defect)
        : Effect.interrupt;
      let claimCalls = 0;
      let outcomeCalls = 0;
      let completionCalls = 0;
      const disruptedState: QuerySyncPublicationState = Object.freeze({
        claimPublication: () => {
          claimCalls += 1;
          if (stage === "claim" && timing === "beforeDelegate") {
            return terminate;
          }
          const operation = fixture.state.claimPublication();
          return stage === "claim"
            ? operation.pipe(Effect.andThen(terminate))
            : operation;
        },
        recordPublicationAttemptOutcome: (attempt, outcome) => {
          outcomeCalls += 1;
          if (stage === "outcome" && timing === "beforeDelegate") {
            return terminate;
          }
          const operation = fixture.state.recordPublicationAttemptOutcome(
            attempt,
            outcome,
          );
          return stage === "outcome"
            ? operation.pipe(Effect.andThen(terminate))
            : operation;
        },
        completePublication: (evidence) => {
          completionCalls += 1;
          if (stage === "completion" && timing === "beforeDelegate") {
            return terminate;
          }
          const operation = fixture.state.completePublication(evidence);
          return stage === "completion"
            ? operation.pipe(Effect.andThen(terminate))
            : operation;
        },
      });
      const firstPublisher = await runEffect(
        fixture.destination.makePublisher([
          stage === "outcome"
            ? publisherFailureStep("knownNotAppended")
            : acceptExactStep,
        ]),
      );
      const exit = await runEffect(Effect.exit(makeSync({
        binding: fixture.binding,
        state: disruptedState,
        publisher: firstPublisher,
      }).runPublicationWork(BUDGET)));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        if (failureMode === "defect") {
          expect(Cause.squash(exit.cause)).toBe(defect);
        } else {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        }
      }
      expect(claimCalls).toBe(1);
      expect(outcomeCalls).toBe(stage === "outcome" ? 1 : 0);
      expect(completionCalls).toBe(stage === "completion" ? 1 : 0);
      expect(await publisherCallCount(firstPublisher)).toBe(
        stage === "claim" ? 0 : 1,
      );
      const afterFailure = await snapshotState(fixture.state);
      if (stage === "claim") {
        if (timing === "beforeDelegate") {
          expect(afterFailure.publicationWork.inFlight).toBeNull();
          expect(afterFailure.publicationWork.pending).toHaveLength(1);
        } else {
          expect(afterFailure.publicationWork.inFlight).toMatchObject({
            attemptOrdinal: 1,
          });
        }
      } else if (stage === "outcome") {
        expect(afterFailure.publicationWork.inFlight).toMatchObject({
          attemptOrdinal: timing === "beforeDelegate" ? 1 : 2,
        });
      } else {
        if (timing === "beforeDelegate") {
          expect(afterFailure.publicationWork.inFlight).toMatchObject({
            attemptOrdinal: 1,
          });
        } else {
          expect(afterFailure.publicationWork.inFlight).toBeNull();
        }
      }

      const restartedPublisher = await runEffect(
        fixture.destination.makePublisher(
          stage === "completion" && timing === "afterDelegate"
            ? []
            : [acceptExactStep],
        ),
      );
      const recovered = await runEffect(makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: restartedPublisher,
      }).runPublicationWork(BUDGET));
      expect(recovered._tag).toBe("idle");
      expect(await publisherCallCount(restartedPublisher)).toBe(
        stage === "completion" && timing === "afterDelegate" ? 0 : 1,
      );
      expect(await acceptedPublicationCount(fixture.destination)).toBe(1);
      expect((await snapshotState(fixture.state)).publicationWork.inFlight)
        .toBeNull();
    },
  );

  it("deduplicates two concurrent coordinators through one shared destination", async () => {
    const result = await runEffect(Effect.gen(function* () {
      const fixture = yield* makePublicationFixture(
        "publication-concurrent-shared-destination",
      );
      const firstEntered = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const blockedAcceptance = (
        entered: Deferred.Deferred<void>,
      ): ReferenceResultPublisherStep => (call, destination) =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(destination.acceptExact(call.publication)),
          Effect.asVoid,
        );
      const firstPublisher = yield* fixture.destination.makePublisher([
        blockedAcceptance(firstEntered),
      ]);
      const secondPublisher = yield* fixture.destination.makePublisher([
        blockedAcceptance(secondEntered),
      ]);
      const first = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: firstPublisher,
      });
      const second = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: secondPublisher,
      });

      const firstFiber = yield* Effect.forkChild(
        first.runPublicationWork(BUDGET),
      );
      const secondFiber = yield* Effect.forkChild(
        second.runPublicationWork(BUDGET),
      );
      yield* Deferred.await(firstEntered);
      yield* Deferred.await(secondEntered);
      yield* Deferred.succeed(release, undefined);
      const outcomes = yield* Effect.all([
        Fiber.join(firstFiber),
        Fiber.join(secondFiber),
      ] as const, { concurrency: "unbounded" });
      return {
        outcomes,
        state: requireState(yield* fixture.state.snapshotForConformance()),
        destination: yield* fixture.destination.snapshotForConformance(),
        firstCalls: yield* firstPublisher.snapshotForConformance(),
        secondCalls: yield* secondPublisher.snapshotForConformance(),
      };
    }));

    expect(result.outcomes.map((outcome) => outcome._tag)).toEqual([
      "idle",
      "idle",
    ]);
    expect(result.outcomes.reduce(
      (total, outcome) => total + outcome.progress.publisherCalls,
      0,
    )).toBe(2);
    expect(result.outcomes.reduce(
      (total, outcome) => total + outcome.progress.completedPublications,
      0,
    )).toBe(1);
    expect(result.outcomes.reduce(
      (total, outcome) => total + outcome.progress.replayedCompletions,
      0,
    )).toBe(1);
    expect(result.firstCalls).toHaveLength(1);
    expect(result.secondCalls).toHaveLength(1);
    expect(result.destination.acceptedPublications).toHaveLength(1);
    expect(result.state.publicationWork.inFlight).toBeNull();
  });

  it.each([
    "knownNotAppended",
    "outcomeUnknown",
    "terminalRefusal",
  ] as const)(
    "allows later acceptance after %s settles first",
    async (publisherOutcome) => {
      const result = await runEffect(Effect.gen(function* () {
        const fixture = yield* makePublicationFixture(
          `publication-outcome-first-${publisherOutcome}`,
        );
        const completionEntered = yield* Deferred.make<void>();
        const releaseCompletion = yield* Deferred.make<void>();
        const delayedCompletionState: QuerySyncPublicationState = Object.freeze({
          claimPublication: fixture.state.claimPublication,
          recordPublicationAttemptOutcome:
            fixture.state.recordPublicationAttemptOutcome,
          completePublication: (evidence) =>
            Deferred.succeed(completionEntered, undefined).pipe(
              Effect.andThen(Deferred.await(releaseCompletion)),
              Effect.andThen(fixture.state.completePublication(evidence)),
            ),
        });
        const acceptingPublisher = yield* fixture.destination.makePublisher([
          acceptExactStep,
        ]);
        const failurePublisher = yield* fixture.destination.makePublisher([
          publisherFailureStep(publisherOutcome),
        ]);
        const accepting = makeSync({
          binding: fixture.binding,
          state: delayedCompletionState,
          publisher: acceptingPublisher,
        });
        const failing = makeSync({
          binding: fixture.binding,
          state: fixture.state,
          publisher: failurePublisher,
        });

        const acceptingFiber = yield* Effect.forkChild(
          accepting.runPublicationWork(BUDGET),
        );
        yield* Deferred.await(completionEntered);
        const failureOutcome = yield* failing.runPublicationWork(BUDGET);
        yield* Deferred.succeed(releaseCompletion, undefined);
        const acceptanceOutcome = yield* Fiber.join(acceptingFiber);
        return {
          failureOutcome,
          acceptanceOutcome,
          state: requireState(
            yield* fixture.state.snapshotForConformance(),
          ),
          destination: yield* fixture.destination.snapshotForConformance(),
        };
      }));

      expect(result.failureOutcome._tag).toBe(
        publisherOutcome === "terminalRefusal"
          ? "publicationResetRequired"
          : "continuationRequired",
      );
      expect(result.acceptanceOutcome).toMatchObject({
        _tag: "idle",
        progress: { completedPublications: 1 },
      });
      expect(result.destination.acceptedPublications).toHaveLength(1);
      expect(result.state.publicationWork.inFlight).toBeNull();
      expect(result.state.publicationWork.latestDelivered).not.toBeNull();
    },
  );

  it.each([
    "knownNotAppended",
    "outcomeUnknown",
    "terminalRefusal",
  ] as const)(
    "classifies delayed %s as superseded when acceptance settles first",
    async (publisherOutcome) => {
      const result = await runEffect(Effect.gen(function* () {
        const fixture = yield* makePublicationFixture(
          `publication-acceptance-first-${publisherOutcome}`,
        );
        const outcomeEntered = yield* Deferred.make<void>();
        const releaseOutcome = yield* Deferred.make<void>();
        const delayedOutcomeState: QuerySyncPublicationState = Object.freeze({
          claimPublication: fixture.state.claimPublication,
          recordPublicationAttemptOutcome: (attempt, outcome) =>
            Deferred.succeed(outcomeEntered, undefined).pipe(
              Effect.andThen(Deferred.await(releaseOutcome)),
              Effect.andThen(fixture.state.recordPublicationAttemptOutcome(
                attempt,
                outcome,
              )),
            ),
          completePublication: fixture.state.completePublication,
        });
        const failurePublisher = yield* fixture.destination.makePublisher([
          publisherFailureStep(publisherOutcome),
        ]);
        const acceptingPublisher = yield* fixture.destination.makePublisher([
          acceptExactStep,
        ]);
        const failing = makeSync({
          binding: fixture.binding,
          state: delayedOutcomeState,
          publisher: failurePublisher,
        });
        const accepting = makeSync({
          binding: fixture.binding,
          state: fixture.state,
          publisher: acceptingPublisher,
        });

        const failureFiber = yield* Effect.forkChild(
          failing.runPublicationWork(BUDGET),
        );
        yield* Deferred.await(outcomeEntered);
        const acceptanceOutcome = yield* accepting.runPublicationWork(BUDGET);
        yield* Deferred.succeed(releaseOutcome, undefined);
        const delayedOutcome = yield* Fiber.join(failureFiber);
        return {
          acceptanceOutcome,
          delayedOutcome,
          state: requireState(
            yield* fixture.state.snapshotForConformance(),
          ),
          destination: yield* fixture.destination.snapshotForConformance(),
        };
      }));

      expect(result.acceptanceOutcome).toMatchObject({
        _tag: "idle",
        progress: { completedPublications: 1 },
      });
      expect(result.delayedOutcome).toMatchObject({
        _tag: "idle",
        progress: { supersededSettlements: 1 },
      });
      expect(result.destination.acceptedPublications).toHaveLength(1);
      expect(result.state.publicationWork.inFlight).toBeNull();
    },
  );

  it("preserves conflicting non-success classifications as a C2 replay error", async () => {
    const result = await runEffect(Effect.gen(function* () {
      const fixture = yield* makePublicationFixture(
        "publication-conflicting-outcome-race",
      );
      const firstEntered = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      const firstState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome: (attempt, outcome) =>
          Deferred.succeed(firstEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst)),
            Effect.andThen(fixture.state.recordPublicationAttemptOutcome(
              attempt,
              outcome,
            )),
          ),
        completePublication: fixture.state.completePublication,
      });
      const secondState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome: (attempt, outcome) =>
          Deferred.succeed(secondEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSecond)),
            Effect.andThen(fixture.state.recordPublicationAttemptOutcome(
              attempt,
              outcome,
            )),
          ),
        completePublication: fixture.state.completePublication,
      });
      const firstPublisher = yield* fixture.destination.makePublisher([
        publisherFailureStep("knownNotAppended"),
      ]);
      const secondPublisher = yield* fixture.destination.makePublisher([
        publisherFailureStep("outcomeUnknown"),
      ]);
      const first = makeSync({
        binding: fixture.binding,
        state: firstState,
        publisher: firstPublisher,
      });
      const second = makeSync({
        binding: fixture.binding,
        state: secondState,
        publisher: secondPublisher,
      });

      const firstFiber = yield* Effect.forkChild(
        first.runPublicationWork(BUDGET),
      );
      yield* Deferred.await(firstEntered);
      const secondFiber = yield* Effect.forkChild(Effect.result(
        second.runPublicationWork(BUDGET),
      ));
      yield* Deferred.await(secondEntered);
      yield* Deferred.succeed(releaseFirst, undefined);
      const firstOutcome = yield* Fiber.join(firstFiber);
      yield* Deferred.succeed(releaseSecond, undefined);
      const secondResult = yield* Fiber.join(secondFiber);
      return {
        firstOutcome,
        secondResult,
        state: requireState(yield* fixture.state.snapshotForConformance()),
      };
    }));

    expect(result.firstOutcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "publicationOutcomeRecorded",
    });
    expect(Result.isFailure(result.secondResult)).toBe(true);
    if (Result.isFailure(result.secondResult)) {
      expect(result.secondResult.failure).toBeInstanceOf(
        InvalidPublicationAttemptOutcomeReplayError,
      );
      expect(result.secondResult.failure).toMatchObject({
        operation: "recordPublicationAttemptOutcome",
        reason: "outcomeMismatch",
        ordinal: 1,
      });
    }
    expect(result.state.publicationWork.inFlight).toMatchObject({
      attemptOrdinal: 2,
      disposition: { _tag: "ready" },
    });
  });

  it("reconciles delayed recovery-expired outcome evidence before draining newer work", async () => {
    const result = await runEffect(Effect.gen(function* () {
      const fixture = yield* makePublicationFixture(
        "publication-recovery-expired",
      );
      yield* installPendingPublication(
        fixture.state,
        fixture.binding,
        descriptor({ keySeed: 2, identity: "query-b" }),
        "publication-recovery-expired-newer",
      );
      const outcomeEntered = yield* Deferred.make<void>();
      const releaseOutcome = yield* Deferred.make<void>();
      const completionEntered = yield* Deferred.make<void>();
      const releaseCompletion = yield* Deferred.make<void>();
      const delayedOutcomeState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome: (attempt, outcome) =>
          Deferred.succeed(outcomeEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseOutcome)),
            Effect.andThen(fixture.state.recordPublicationAttemptOutcome(
              attempt,
              outcome,
            )),
          ),
        completePublication: fixture.state.completePublication,
      });
      const delayedCompletionState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome:
          fixture.state.recordPublicationAttemptOutcome,
        completePublication: (evidence) =>
          Deferred.succeed(completionEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCompletion)),
            Effect.andThen(fixture.state.completePublication(evidence)),
          ),
      });
      const delayedOutcomePublisher = yield* fixture.destination.makePublisher([
        publisherFailureStep("knownNotAppended"),
        acceptExactStep,
      ]);
      const delayedAcceptancePublisher = yield*
        fixture.destination.makePublisher([acceptExactStep]);
      const firstOrdinalReplayPublisher = yield*
        fixture.destination.makePublisher([
          publisherFailureStep("knownNotAppended"),
        ]);
      const secondOrdinalPublisher = yield*
        fixture.destination.makePublisher([
          publisherFailureStep("knownNotAppended"),
        ]);

      const delayedOutcomeSync = makeSync({
        binding: fixture.binding,
        state: delayedOutcomeState,
        publisher: delayedOutcomePublisher,
      });
      const delayedAcceptanceSync = makeSync({
        binding: fixture.binding,
        state: delayedCompletionState,
        publisher: delayedAcceptancePublisher,
      });
      const delayedOutcomeFiber = yield* Effect.forkChild(
        delayedOutcomeSync.runPublicationWork(BUDGET),
      );
      yield* Deferred.await(outcomeEntered);
      const delayedAcceptanceFiber = yield* Effect.forkChild(
        delayedAcceptanceSync.runPublicationWork({
          ...BUDGET,
          publisherCalls: 1,
        }),
      );
      yield* Deferred.await(completionEntered);

      yield* makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: firstOrdinalReplayPublisher,
      }).runPublicationWork(BUDGET);
      yield* makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: secondOrdinalPublisher,
      }).runPublicationWork(BUDGET);
      const beforeAcceptance = requireState(
        yield* fixture.state.snapshotForConformance(),
      );

      yield* Deferred.succeed(releaseCompletion, undefined);
      const delayedAcceptance = yield* Fiber.join(delayedAcceptanceFiber);
      yield* Deferred.succeed(releaseOutcome, undefined);
      const recoveredOutcome = yield* Fiber.join(delayedOutcomeFiber);
      return {
        beforeAcceptance,
        delayedAcceptance,
        recoveredOutcome,
        state: requireState(yield* fixture.state.snapshotForConformance()),
        destination: yield* fixture.destination.snapshotForConformance(),
      };
    }));

    expect(result.beforeAcceptance.publicationWork.inFlight).toMatchObject({
      attemptOrdinal: 3,
    });
    expect(result.delayedAcceptance).toMatchObject({
      _tag: "continuationRequired",
      reason: "publisherCallLimitReached",
      progress: { completedPublications: 1 },
    });
    expect(result.recoveredOutcome).toMatchObject({
      _tag: "idle",
      progress: {
        recoveryEvidenceExpiredSettlements: 1,
        publisherCalls: 2,
        completedPublications: 1,
      },
    });
    expect(result.destination.acceptedPublications).toHaveLength(2);
    expect(result.destination.acceptedPublications.map(
      (publication) => publication.identity.queryKey,
    )).toEqual([
      descriptor().queryKey,
      descriptor({ keySeed: 2, identity: "query-b" }).queryKey,
    ]);
    expect(result.state.publicationWork.inFlight).toBeNull();
    expect(result.state.publicationWork.pending).toHaveLength(0);
    expect(result.state.publicationWork.latestDelivered?.identity.queryKey)
      .toBe(descriptor({ keySeed: 2, identity: "query-b" }).queryKey);
  });

  it("classifies delayed acceptance as superseded without removing newer work", async () => {
    const result = await runEffect(Effect.gen(function* () {
      const fixture = yield* makePublicationFixture(
        "publication-delayed-acceptance-superseded",
      );
      const newerDescriptor = descriptor({
        keySeed: 2,
        identity: "query-b",
      });
      yield* installPendingPublication(
        fixture.state,
        fixture.binding,
        newerDescriptor,
        "publication-delayed-acceptance-newer",
      );
      const completionEntered = yield* Deferred.make<void>();
      const releaseCompletion = yield* Deferred.make<void>();
      const delayedCompletionState: QuerySyncPublicationState = Object.freeze({
        claimPublication: fixture.state.claimPublication,
        recordPublicationAttemptOutcome:
          fixture.state.recordPublicationAttemptOutcome,
        completePublication: (evidence) =>
          Deferred.succeed(completionEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCompletion)),
            Effect.andThen(fixture.state.completePublication(evidence)),
          ),
      });
      const delayedPublisher = yield* fixture.destination.makePublisher([
        acceptExactStep,
      ]);
      const drainingPublisher = yield* fixture.destination.makePublisher([
        acceptExactStep,
        acceptExactStep,
      ]);
      const delayed = makeSync({
        binding: fixture.binding,
        state: delayedCompletionState,
        publisher: delayedPublisher,
      });
      const draining = makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: drainingPublisher,
      });

      const delayedFiber = yield* Effect.forkChild(
        delayed.runPublicationWork(BUDGET),
      );
      yield* Deferred.await(completionEntered);
      const drained = yield* draining.runPublicationWork(BUDGET);
      yield* Deferred.succeed(releaseCompletion, undefined);
      const stale = yield* Fiber.join(delayedFiber);
      return {
        drained,
        stale,
        state: requireState(yield* fixture.state.snapshotForConformance()),
        destination: yield* fixture.destination.snapshotForConformance(),
        newerDescriptor,
      };
    }));

    expect(result.drained).toMatchObject({
      _tag: "idle",
      progress: { completedPublications: 2 },
    });
    expect(result.stale).toMatchObject({
      _tag: "idle",
      progress: { supersededSettlements: 1 },
    });
    expect(result.destination.acceptedPublications).toHaveLength(2);
    expect(result.state.publicationWork.inFlight).toBeNull();
    expect(result.state.publicationWork.pending).toHaveLength(0);
    expect(result.state.publicationWork.latestDelivered?.identity.queryKey)
      .toBe(result.newerDescriptor.queryKey);
  });

  it.each([
    { seed: 7, outcome: "knownNotAppended", appended: false },
    { seed: 19, outcome: "outcomeUnknown", appended: false },
    { seed: 31, outcome: "outcomeUnknown", appended: true },
  ] as const)(
    "restarts deterministic publication history $seed from durable state",
    async ({ seed, outcome, appended }) => {
      const fixture = await runEffect(makePublicationFixture(
        `publication-restart-seed-${seed}`,
      ));
      const firstStep: ReferenceResultPublisherStep = appended
        ? (call, destination) =>
          destination.acceptExact(call.publication).pipe(
            Effect.andThen(publisherFailureStep(outcome)(call, destination)),
          )
        : publisherFailureStep(outcome);
      const firstPublisher = await runEffect(
        fixture.destination.makePublisher([firstStep]),
      );
      const first = await runEffect(makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: firstPublisher,
      }).runPublicationWork(BUDGET));
      const afterFirst = await snapshotState(fixture.state);

      const restartedPublisher = await runEffect(
        fixture.destination.makePublisher([acceptExactStep]),
      );
      const restarted = await runEffect(makeSync({
        binding: fixture.binding,
        state: fixture.state,
        publisher: restartedPublisher,
      }).runPublicationWork(BUDGET));

      expect(first).toMatchObject({
        _tag: "continuationRequired",
        reason: "publicationOutcomeRecorded",
      });
      expect(afterFirst.publicationWork.inFlight).toMatchObject({
        attemptOrdinal: 2,
      });
      expect(restarted._tag).toBe("idle");
      expect(await publisherCallCount(firstPublisher)).toBe(1);
      expect(await publisherCallCount(restartedPublisher)).toBe(1);
      expect(await acceptedPublicationCount(fixture.destination)).toBe(1);
      expect((await snapshotState(fixture.state)).publicationWork.inFlight)
        .toBeNull();
    },
  );
});
