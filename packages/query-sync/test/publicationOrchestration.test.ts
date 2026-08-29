import {
  Cause,
  Duration,
  Effect,
  Exit,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  capturePublicationAttemptOrdinal,
  QuerySyncInvariantDefect,
} from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  PendingQueryPublication,
  PublicationAttempt,
  QueryDescriptor,
  QueryPublicationIdentity,
} from "@flarex/query-sync/internal/kernel";
import {
  InvalidNamespacePublicationSyncPolicyError,
  InvalidPublicationTurnBudgetError,
  makeNamespacePublicationSync,
  MAX_TURN_PUBLISHER_CALLS,
  PublicationAuthorityMismatchError,
  PublicationSettlementDeadlineError,
  ResultPublisherKnownNotAppendedError,
  ResultPublisherOutcomeUnknownError,
  ResultPublisherTerminalRefusalError,
} from "@flarex/query-sync/internal/orchestration";
import type {
  NamespacePublicationBinding,
  NamespacePublicationSync,
  NamespacePublicationSyncPolicy,
  PublicationTurnBudget,
  QuerySyncPublicationState,
  ResultPublisher,
} from "@flarex/query-sync/internal/orchestration";
import {
  QuerySyncStateUnavailableError,
} from "@flarex/query-sync/internal/state";
import type {
  QuerySyncTransitionState,
} from "@flarex/query-sync/internal/state";
import {
  makeReferenceQuerySyncStateHarness,
  makeReferenceResultPublisherHarness,
  ReferenceResultDestinationInvariantDefect,
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
  digest,
  evaluation,
  getSuccess,
  publicationArtifact,
  target,
} from "./fixtures.js";
import { runEffect, runEffectFailure } from "./effectBoundary.js";

const RETRY_DELAYS: readonly [number, number] = Object.freeze([0, 0]);

const POLICY: NamespacePublicationSyncPolicy = Object.freeze({
  stateAttemptsPerOperation: 3,
  retryDelayMilliseconds: RETRY_DELAYS,
  settlementReserveMilliseconds: 10,
});

const BUDGET: PublicationTurnBudget = Object.freeze({
  publisherCalls: MAX_TURN_PUBLISHER_CALLS,
  newWorkWindowMilliseconds: 1_000,
});

const acceptStep: ReferenceResultPublisherStep = (call, destination) =>
  destination.acceptExact(call.publication).pipe(Effect.asVoid);

interface PreparedPublicationState {
  readonly binding: NamespaceCursor;
  readonly state: ReferenceQuerySyncTransitionState;
  readonly pending: readonly PendingQueryPublication[];
}

interface PreparedPublicationSystem extends PreparedPublicationState {
  readonly destination: ReferenceResultDestination;
  readonly publisher: ReferenceResultPublisher;
  readonly sync: NamespacePublicationSync;
}

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key];
};

function bindingFor(cursorValue: NamespaceCursor): NamespacePublicationBinding {
  return Object.freeze({
    namespaceId: cursorValue.namespaceId,
    syncModelId: cursorValue.syncModelId,
    sourceEpoch: cursorValue.sourceEpoch,
  });
}

const installPendingPublication = Effect.fn(
  "QuerySync.Test.installPendingPublicationForOrchestration",
)(function*(
  state: ReferenceQuerySyncTransitionState,
  binding: NamespaceCursor,
  query: QueryDescriptor,
  label: string,
  resultSeed: number,
) {
  const begun = yield* state.beginQueryEvaluation(Object.freeze({
    target: target({ descriptor: query }),
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  }));
  if (begun._tag !== "created" && begun._tag !== "replayed") {
    return yield* Effect.die("Expected a publication fixture attempt");
  }
  const evaluated = evaluation({
    descriptor: query,
    generation: begun.attempt.generation,
    snapshot: binding.appliedThroughSequence,
    resultSeed,
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    evaluated,
    begun.attempt.registrationCursor,
    [],
    evaluated.authorityWitness,
  ));
  const completed = yield* state.completeQueryEvaluation(
    begun.attempt,
    evaluated,
    refresh,
    publicationArtifact(label),
  );
  if (completed._tag !== "completed") {
    return yield* Effect.die("Expected a completed publication fixture");
  }
});

async function prepareState(
  labels: readonly string[],
  binding: NamespaceCursor = cursor(),
): Promise<PreparedPublicationState> {
  const state = await runEffect(Effect.gen(function* () {
    const harness = yield* makeReferenceQuerySyncStateHarness();
    const bound = harness.bind({
      physicalNamespaceId: `physical-${binding.namespaceId}-${binding.syncModelId}-${binding.sourceEpoch}`,
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
    });
    yield* bound.initializeOrInspectNamespace(binding);
    for (let index = 0; index < labels.length; index += 1) {
      yield* installPendingPublication(
        bound,
        binding,
        descriptor({
          keySeed: index + 1,
          identity: `query-${index + 1}`,
        }),
        labels[index] ?? `publication-${index + 1}`,
        100 + index,
      );
    }
    return bound;
  }));
  const snapshot = await runEffect(state.snapshotForConformance());
  if (snapshot === null) throw new Error("Expected initialized state");
  return Object.freeze({
    binding,
    state,
    pending: Object.freeze([...snapshot.publicationWork.pending]),
  });
}

async function prepareSystem(
  labels: readonly string[],
  steps: readonly ReferenceResultPublisherStep[],
  options: Readonly<{
    readonly stateForCoordinator?: QuerySyncPublicationState;
    readonly policy?: NamespacePublicationSyncPolicy;
    readonly binding?: NamespaceCursor;
  }> = {},
): Promise<PreparedPublicationSystem> {
  const prepared = await prepareState(
    labels,
    options.binding ?? cursor(),
  );
  const { destination, publisher } = await runEffect(Effect.gen(function* () {
    const publisherHarness = yield* makeReferenceResultPublisherHarness();
    const destination = yield* publisherHarness.makeDestination();
    const publisher = yield* destination.makePublisher(steps);
    return { destination, publisher };
  }));
  const sync = getSuccess(makeNamespacePublicationSync({
    binding: bindingFor(prepared.binding),
    state: options.stateForCoordinator ?? prepared.state,
    publisher,
    policy: options.policy ?? POLICY,
  }));
  return Object.freeze({ ...prepared, destination, publisher, sync });
}

function emptyPublicationState(): QuerySyncPublicationState {
  return {
    claimPublication: () => Effect.succeed(Object.freeze({ _tag: "none" })),
    recordPublicationAttemptOutcome: () => Effect.die(
      "Unexpected publication outcome settlement",
    ),
    completePublication: () => Effect.die(
      "Unexpected publication completion settlement",
    ),
  };
}

function unusedPublisher(): ResultPublisher {
  return {
    publish: () => Effect.die("Unexpected publisher call"),
  };
}

function makeEmptySync(
  policy: NamespacePublicationSyncPolicy = POLICY,
): ReturnType<typeof makeNamespacePublicationSync> {
  return makeNamespacePublicationSync({
    binding: bindingFor(cursor()),
    state: emptyPublicationState(),
    publisher: unusedPublisher(),
    policy,
  });
}

function tracedState(
  state: QuerySyncPublicationState,
  trace: string[],
): QuerySyncPublicationState {
  return {
    claimPublication: () => Effect.sync(() => {
      trace.push("claim");
    }).pipe(Effect.andThen(state.claimPublication())),
    recordPublicationAttemptOutcome: (attempt, outcome) =>
      Effect.sync(() => {
        trace.push("recordOutcome");
      }).pipe(Effect.andThen(
        state.recordPublicationAttemptOutcome(attempt, outcome),
      )),
    completePublication: (evidence) => Effect.sync(() => {
      trace.push("complete");
    }).pipe(Effect.andThen(state.completePublication(evidence))),
  };
}

function tracedStep(
  trace: string[],
  step: ReferenceResultPublisherStep,
): ReferenceResultPublisherStep {
  return (call, destination) => Effect.sync(() => {
    trace.push("publish");
  }).pipe(Effect.andThen(step(call, destination)));
}

function claimAttempt(
  state: ReferenceQuerySyncTransitionState,
): Promise<PublicationAttempt> {
  return runEffect(state.claimPublication()).then((receipt) => {
    if (receipt._tag !== "claimed" && receipt._tag !== "replayed") {
      throw new Error("Expected one publication attempt");
    }
    return receipt.attempt;
  });
}

async function makePublisherFixture(
  steps: readonly ReferenceResultPublisherStep[],
): Promise<Readonly<{
  readonly destination: ReferenceResultDestination;
  readonly publisher: ReferenceResultPublisher;
}>> {
  return runEffect(Effect.gen(function* () {
    const harness = yield* makeReferenceResultPublisherHarness();
    const destination = yield* harness.makeDestination();
    const publisher = yield* destination.makePublisher(steps);
    return Object.freeze({ destination, publisher });
  }));
}

function syncFor(
  prepared: PreparedPublicationState,
  publisher: ResultPublisher,
  state: QuerySyncPublicationState = prepared.state,
  policy: NamespacePublicationSyncPolicy = POLICY,
  binding: NamespacePublicationBinding = bindingFor(prepared.binding),
): NamespacePublicationSync {
  return getSuccess(makeNamespacePublicationSync({
    binding,
    state,
    publisher,
    policy,
  }));
}

describe("bounded publication orchestration", () => {
  it("captures construction inputs and reads only the three publication methods", async () => {
    const getterTrace: string[] = [];
    const bindingTarget: Mutable<NamespacePublicationBinding> = {
      ...bindingFor(cursor()),
    };
    const binding = new Proxy(bindingTarget, {
      get: (targetValue, property, receiver) => {
        if (typeof property === "string") getterTrace.push(`binding.${property}`);
        return Reflect.get(targetValue, property, receiver);
      },
    });
    const policyTarget = {
      stateAttemptsPerOperation: 3,
      retryDelayMilliseconds: [0, 0] as [number, number],
      settlementReserveMilliseconds: 10,
    };
    const policy = new Proxy(policyTarget, {
      get: (targetValue, property, receiver) => {
        if (typeof property === "string") getterTrace.push(`policy.${property}`);
        return Reflect.get(targetValue, property, receiver);
      },
    });
    const stateTarget: Mutable<QuerySyncPublicationState> = {
      ...emptyPublicationState(),
    };
    const state = new Proxy(stateTarget, {
      get: (targetValue, property, receiver) => {
        if (typeof property === "string") getterTrace.push(`state.${property}`);
        return Reflect.get(targetValue, property, receiver);
      },
    });
    const publisherTarget: Mutable<ResultPublisher> = {
      publish: () => Effect.void,
    };
    const publisher = new Proxy(publisherTarget, {
      get: (targetValue, property, receiver) => {
        if (typeof property === "string") getterTrace.push(`publisher.${property}`);
        return Reflect.get(targetValue, property, receiver);
      },
    });

    const sync = getSuccess(makeNamespacePublicationSync({
      binding,
      state,
      publisher,
      policy,
    }));
    policyTarget.stateAttemptsPerOperation = 1;
    policyTarget.retryDelayMilliseconds[0] = 60_000;
    bindingTarget.namespaceId = cursor({ namespaceId: "mutated" }).namespaceId;
    stateTarget.claimPublication = () => Effect.die("mutated state method");
    publisherTarget.publish = () => Effect.die("mutated publisher method");

    const budgetTarget = {
      publisherCalls: 1,
      newWorkWindowMilliseconds: 11,
    };
    const budget = new Proxy(budgetTarget, {
      get: (targetValue, property, receiver) => {
        if (typeof property === "string") getterTrace.push(`budget.${property}`);
        return Reflect.get(targetValue, property, receiver);
      },
    });
    const outcome = await runEffect(sync.runPublicationWork(budget));

    expect(outcome._tag).toBe("idle");
    expect(getterTrace).toEqual([
      "binding.namespaceId",
      "binding.syncModelId",
      "binding.sourceEpoch",
      "policy.stateAttemptsPerOperation",
      "policy.retryDelayMilliseconds",
      "policy.settlementReserveMilliseconds",
      "state.claimPublication",
      "state.recordPublicationAttemptOutcome",
      "state.completePublication",
      "publisher.publish",
      "budget.publisherCalls",
      "budget.newWorkWindowMilliseconds",
    ]);
  });

  it("short-circuits canonical binding capture before policy access", () => {
    const policy = new Proxy(POLICY, {
      get: () => {
        throw new Error("policy must not be read");
      },
    });
    const result = makeNamespacePublicationSync({
      binding: {
        namespaceId: "",
        syncModelId: "",
        sourceEpoch: "",
      } as unknown as NamespacePublicationBinding,
      state: emptyPublicationState(),
      publisher: unusedPublisher(),
      policy,
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "QuerySyncCanonicalValueError",
        field: "namespaceId",
      });
    }
  });

  it("does not convert capability getter defects into construction failures", () => {
    const state = new Proxy(emptyPublicationState(), {
      get: () => {
        throw new Error("state getter defect");
      },
    });
    expect(() => makeNamespacePublicationSync({
      binding: bindingFor(cursor()),
      state,
      publisher: unusedPublisher(),
      policy: POLICY,
    })).toThrowError("state getter defect");
  });

  it.each([
    [{ ...POLICY, stateAttemptsPerOperation: 0 }, "stateAttemptsPerOperation", "invalidValue"],
    [{ ...POLICY, stateAttemptsPerOperation: 4 }, "stateAttemptsPerOperation", "aboveHardMaximum"],
    [{ ...POLICY, retryDelayMilliseconds: [-1, 0] as const }, "retryDelayMilliseconds", "invalidPair"],
    [{ ...POLICY, retryDelayMilliseconds: [60_001, 0] as const }, "retryDelayMilliseconds", "aboveHardMaximum"],
    [{ ...POLICY, settlementReserveMilliseconds: 0 }, "settlementReserveMilliseconds", "invalidValue"],
    [{ ...POLICY, settlementReserveMilliseconds: 60_000 }, "settlementReserveMilliseconds", "aboveHardMaximum"],
  ] as const)(
    "rejects invalid publication policy field %s with %s",
    (policy, field, reason) => {
      const result = makeEmptySync(policy);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toEqual(
          new InvalidNamespacePublicationSyncPolicyError({
            operation: "makeNamespacePublicationSync",
            field,
            reason,
          }),
        );
      }
    },
  );

  it("rejects a malformed retry-delay pair", () => {
    const result = makeEmptySync({
      ...POLICY,
      retryDelayMilliseconds: Object.freeze([0]) as unknown as readonly [number, number],
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "InvalidNamespacePublicationSyncPolicyError",
        field: "retryDelayMilliseconds",
        reason: "invalidPair",
      });
    }
  });

  it.each([
    [{ publisherCalls: 0, newWorkWindowMilliseconds: 11 }, "publisherCalls", "invalidValue"],
    [{ publisherCalls: 33, newWorkWindowMilliseconds: 11 }, "publisherCalls", "aboveHardMaximum"],
    [{ publisherCalls: 1, newWorkWindowMilliseconds: 0 }, "newWorkWindowMilliseconds", "invalidValue"],
    [{ publisherCalls: 1, newWorkWindowMilliseconds: 60_001 }, "newWorkWindowMilliseconds", "aboveHardMaximum"],
    [{ publisherCalls: 1, newWorkWindowMilliseconds: 10 }, "newWorkWindowMilliseconds", "notGreaterThanSettlementReserve"],
  ] as const)(
    "rejects invalid publication turn budget field %s with %s",
    async (budget, field, reason) => {
      const sync = getSuccess(makeEmptySync());
      const failure = await runEffectFailure(sync.runPublicationWork(budget));
      expect(failure).toEqual(new InvalidPublicationTurnBudgetError({
        operation: "runPublicationWork",
        field,
        reason,
        observed: budget[field],
      }));
    },
  );

  it("accepts the exact policy and budget boundaries", async () => {
    const lower = getSuccess(makeEmptySync({
      stateAttemptsPerOperation: 1,
      retryDelayMilliseconds: Object.freeze([0, 60_000]),
      settlementReserveMilliseconds: 1,
    }));
    const upper = getSuccess(makeEmptySync({
      stateAttemptsPerOperation: 3,
      retryDelayMilliseconds: Object.freeze([60_000, 0]),
      settlementReserveMilliseconds: 59_999,
    }));
    expect((await runEffect(lower.runPublicationWork({
      publisherCalls: 1,
      newWorkWindowMilliseconds: 2,
    })))._tag).toBe("idle");
    expect((await runEffect(upper.runPublicationWork({
      publisherCalls: 32,
      newWorkWindowMilliseconds: 60_000,
    })))._tag).toBe("idle");
  });

  it("returns a frozen idle result without calling the publisher", async () => {
    const sync = getSuccess(makeEmptySync());
    const outcome = await runEffect(sync.runPublicationWork(BUDGET));
    expect(outcome).toEqual({
      _tag: "idle",
      progress: {
        newlyClaimedAttempts: 0,
        replayedAttempts: 0,
        publisherCalls: 0,
        acceptedPublisherCalls: 0,
        knownNotAppendedPublisherCalls: 0,
        outcomeUnknownPublisherCalls: 0,
        terminalRefusalPublisherCalls: 0,
        recordedAttemptOutcomes: 0,
        completedPublications: 0,
        replayedCompletions: 0,
        supersededSettlements: 0,
        recoveryEvidenceExpiredSettlements: 0,
        blockedPublications: 0,
      },
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.progress)).toBe(true);
  });

  it("accepts once, completes durably, and never republishes completed work", async () => {
    const system = await prepareSystem(["publication-a"], [acceptStep]);
    const first = await runEffect(system.sync.runPublicationWork(BUDGET));
    expect(first).toMatchObject({
      _tag: "idle",
      progress: {
        newlyClaimedAttempts: 1,
        publisherCalls: 1,
        acceptedPublisherCalls: 1,
        completedPublications: 1,
      },
    });
    const afterFirst = await runEffect(system.state.snapshotForConformance());
    expect(afterFirst?.publicationWork).toMatchObject({
      pending: [],
      inFlight: null,
      latestDelivered: { identity: system.pending[0]?.identity },
    });

    const second = await runEffect(system.sync.runPublicationWork(BUDGET));
    expect(second).toMatchObject({ _tag: "idle", progress: { publisherCalls: 0 } });
    expect(await runEffect(system.publisher.snapshotForConformance())).toHaveLength(1);
    expect((await runEffect(system.destination.snapshotForConformance())).acceptedPublications).toHaveLength(1);
  });

  it("drains three canonical publications in durable state order", async () => {
    const system = await prepareSystem(
      ["publication-a", "publication-b", "publication-c"],
      [acceptStep, acceptStep, acceptStep],
    );
    const outcome = await runEffect(system.sync.runPublicationWork(BUDGET));
    expect(outcome).toMatchObject({
      _tag: "idle",
      progress: {
        newlyClaimedAttempts: 3,
        publisherCalls: 3,
        acceptedPublisherCalls: 3,
        completedPublications: 3,
      },
    });
    const calls = await runEffect(system.publisher.snapshotForConformance());
    expect(calls.map((call) => call.publication.identity)).toEqual(
      system.pending.map((publication) => publication.identity),
    );
    expect((await runEffect(system.destination.snapshotForConformance())).acceptedPublications).toHaveLength(3);
  });

  it.each([
    ["accepted", "idle", null, ["claim", "publish", "complete", "claim"], 1],
    ["knownNotAppended", "continuationRequired", "publicationOutcomeRecorded", ["claim", "publish", "recordOutcome"], 0],
    ["outcomeUnknown", "continuationRequired", "publicationOutcomeRecorded", ["claim", "publish", "recordOutcome"], 0],
    ["appendThenUnknown", "continuationRequired", "publicationOutcomeRecorded", ["claim", "publish", "recordOutcome"], 1],
    ["terminalRefusal", "publicationResetRequired", null, ["claim", "publish", "recordOutcome"], 0],
  ] as const)(
    "settles one %s publisher result in strict order",
    async (behavior, expectedTag, expectedReason, expectedTrace, acceptedCount) => {
      const trace: string[] = [];
      const baseStep: ReferenceResultPublisherStep = (call, destination) => {
        switch (behavior) {
          case "accepted":
            return destination.acceptExact(call.publication).pipe(Effect.asVoid);
          case "knownNotAppended":
            return Effect.fail(new ResultPublisherKnownNotAppendedError({
              operation: "publish",
            }));
          case "outcomeUnknown":
            return Effect.fail(new ResultPublisherOutcomeUnknownError({
              operation: "publish",
            }));
          case "appendThenUnknown":
            return destination.acceptExact(call.publication).pipe(
              Effect.andThen(Effect.fail(new ResultPublisherOutcomeUnknownError({
                operation: "publish",
              }))),
            );
          case "terminalRefusal":
            return Effect.fail(new ResultPublisherTerminalRefusalError({
              operation: "publish",
            }));
        }
      };
      const prepared = await prepareState([`publication-${behavior}`]);
      const harness = await runEffect(makeReferenceResultPublisherHarness());
      const destination = await runEffect(harness.makeDestination());
      const publisher = await runEffect(destination.makePublisher([
        tracedStep(trace, baseStep),
      ]));
      const sync = getSuccess(makeNamespacePublicationSync({
        binding: bindingFor(prepared.binding),
        state: tracedState(prepared.state, trace),
        publisher,
        policy: POLICY,
      }));

      const outcome = await runEffect(sync.runPublicationWork(BUDGET));
      expect(outcome._tag).toBe(expectedTag);
      if (expectedReason !== null && outcome._tag === "continuationRequired") {
        expect(outcome.reason).toBe(expectedReason);
      }
      if (behavior === "terminalRefusal") {
        expect(outcome).toMatchObject({
          _tag: "publicationResetRequired",
          reason: "terminalPublisherRefusal",
          resetRequired: true,
          progress: { blockedPublications: 1 },
        });
      }
      expect(trace).toEqual(expectedTrace);
      expect(outcome.progress.publisherCalls).toBe(1);
      expect(outcome.progress.acceptedPublisherCalls).toBe(
        behavior === "accepted" ? 1 : 0,
      );
      expect(outcome.progress.knownNotAppendedPublisherCalls).toBe(
        behavior === "knownNotAppended" ? 1 : 0,
      );
      expect(outcome.progress.outcomeUnknownPublisherCalls).toBe(
        behavior === "outcomeUnknown" || behavior === "appendThenUnknown" ? 1 : 0,
      );
      expect(outcome.progress.terminalRefusalPublisherCalls).toBe(
        behavior === "terminalRefusal" ? 1 : 0,
      );
      expect((await runEffect(destination.snapshotForConformance())).acceptedPublications).toHaveLength(acceptedCount);
    },
  );
});

describe("publication orchestration turn and settlement bounds", () => {
  it("stops before another claim at the exact physical-call limit and resumes fresh", async () => {
    const prepared = await prepareState([
      "publication-a",
      "publication-b",
      "publication-c",
    ]);
    const { publisher } = await makePublisherFixture([
      acceptStep,
      acceptStep,
      acceptStep,
    ]);
    let claimCalls = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: () => {
        claimCalls += 1;
        return prepared.state.claimPublication();
      },
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: prepared.state.completePublication,
    };
    const sync = syncFor(prepared, publisher, state);

    const first = await runEffect(sync.runPublicationWork({
      publisherCalls: 2,
      newWorkWindowMilliseconds: 1_000,
    }));
    expect(first).toMatchObject({
      _tag: "continuationRequired",
      reason: "publisherCallLimitReached",
      progress: {
        publisherCalls: 2,
        acceptedPublisherCalls: 2,
        completedPublications: 2,
      },
    });
    expect(claimCalls).toBe(2);

    const second = await runEffect(sync.runPublicationWork({
      publisherCalls: 2,
      newWorkWindowMilliseconds: 1_000,
    }));
    expect(second).toMatchObject({
      _tag: "idle",
      progress: {
        publisherCalls: 1,
        completedPublications: 1,
      },
    });
    expect(claimCalls).toBe(4);
    expect(await runEffect(publisher.snapshotForConformance())).toHaveLength(3);
  });

  it("debits an expected failure as one call before reclaiming stale work", async () => {
    const prepared = await prepareState(["publication-a"]);
    const attempt = await claimAttempt(prepared.state);
    let claimCalls = 0;
    let publisherCalls = 0;
    let settlementCalls = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: () => {
        claimCalls += 1;
        return Effect.succeed(Object.freeze({
          _tag: "replayed",
          attempt,
        }));
      },
      recordPublicationAttemptOutcome: () => {
        settlementCalls += 1;
        return Effect.succeed(Object.freeze({
          _tag: "superseded",
          identity: attempt.publication.identity,
          attemptOrdinal: attempt.attemptOrdinal,
        }));
      },
      completePublication: () => Effect.die("Unexpected completion"),
    };
    const publisher: ResultPublisher = {
      publish: () => {
        publisherCalls += 1;
        return Effect.fail(new ResultPublisherKnownNotAppendedError({
          operation: "publish",
        }));
      },
    };
    const sync = syncFor(prepared, publisher, state);

    const outcome = await runEffect(sync.runPublicationWork({
      publisherCalls: 1,
      newWorkWindowMilliseconds: 1_000,
    }));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "publisherCallLimitReached",
      progress: {
        replayedAttempts: 1,
        publisherCalls: 1,
        knownNotAppendedPublisherCalls: 1,
        supersededSettlements: 1,
      },
    });
    expect({ claimCalls, publisherCalls, settlementCalls }).toEqual({
      claimCalls: 1,
      publisherCalls: 1,
      settlementCalls: 1,
    });
  });

  it("retries an unknown completion with identical evidence without republishing", async () => {
    const prepared = await prepareState(["publication-a"]);
    await runEffect(prepared.state.injectNextFault({
      operation: "completePublication",
      timing: "afterSwap",
    }));
    const { publisher } = await makePublisherFixture([acceptStep]);
    const sync = syncFor(prepared, publisher);

    const outcome = await runEffect(sync.runPublicationWork(BUDGET));
    expect(outcome).toMatchObject({
      _tag: "idle",
      progress: {
        publisherCalls: 1,
        acceptedPublisherCalls: 1,
        completedPublications: 0,
        replayedCompletions: 1,
      },
    });
    expect(await runEffect(publisher.snapshotForConformance())).toHaveLength(1);
  });

  it("stops at admission equality before claiming more work", async () => {
    const prepared = await prepareState(["publication-a", "publication-b"]);
    const { publisher } = await makePublisherFixture([acceptStep]);
    let claimCalls = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: () => {
        claimCalls += 1;
        return prepared.state.claimPublication();
      },
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: (evidence) =>
        prepared.state.completePublication(evidence).pipe(
          Effect.tap(() => TestClock.adjust("990 millis")),
        ),
    };
    const sync = syncFor(prepared, publisher, state);

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.runPublicationWork(BUDGET);
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "deadlineReached",
      progress: {
        publisherCalls: 1,
        completedPublications: 1,
      },
    });
    expect(claimCalls).toBe(1);
  });

  it("stops after a claim that returns at admission equality", async () => {
    const prepared = await prepareState(["publication-a"]);
    const { publisher } = await makePublisherFixture([acceptStep]);
    const state: QuerySyncPublicationState = {
      claimPublication: () => prepared.state.claimPublication().pipe(
        Effect.tap(() => TestClock.adjust("990 millis")),
      ),
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: prepared.state.completePublication,
    };
    const sync = syncFor(prepared, publisher, state);

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.runPublicationWork(BUDGET);
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "deadlineReached",
      progress: {
        newlyClaimedAttempts: 1,
        publisherCalls: 0,
      },
    });
    expect(await runEffect(publisher.snapshotForConformance())).toHaveLength(0);
  });

  it("floors positive publisher headroom to whole milliseconds", async () => {
    const prepared = await prepareState(["publication-a"]);
    const { publisher } = await makePublisherFixture([acceptStep]);
    let claimedPublication: PendingQueryPublication | null = null;
    const state: QuerySyncPublicationState = {
      claimPublication: () => prepared.state.claimPublication().pipe(
        Effect.tap((receipt) => Effect.sync(() => {
          if (receipt._tag === "claimed" || receipt._tag === "replayed") {
            claimedPublication = receipt.attempt.publication;
          }
        })),
        Effect.tap(() => TestClock.adjust(Duration.nanos(1_500_000n))),
      ),
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: prepared.state.completePublication,
    };
    const sync = syncFor(prepared, publisher, state, {
      ...POLICY,
      settlementReserveMilliseconds: 1,
    });

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.runPublicationWork({
        publisherCalls: 1,
        newWorkWindowMilliseconds: 10,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "publisherCallLimitReached",
    });
    const calls = await runEffect(publisher.snapshotForConformance());
    expect(calls).toHaveLength(1);
    expect(claimedPublication).not.toBeNull();
    expect(calls[0]?.publication).toBe(claimedPublication);
    expect(Object.isFrozen(calls)).toBe(true);
    expect(Object.isFrozen(calls[0])).toBe(true);
    expect(calls[0]?.budget).toEqual({
      remainingPublisherCallsIncludingThisCall: 1,
      maximumSettlementMilliseconds: 7,
    });
    expect(Object.isFrozen(calls[0]?.budget)).toBe(true);
  });

  it("reports completion pending at settlement-cutoff equality", async () => {
    const prepared = await prepareState(["publication-a"]);
    const delayedAcceptance: ReferenceResultPublisherStep = (
      call,
      destination,
    ) => destination.acceptExact(call.publication).pipe(
      Effect.tap(() => TestClock.adjust("10 millis")),
      Effect.asVoid,
    );
    const { publisher, destination } = await makePublisherFixture([
      delayedAcceptance,
    ]);
    let completionCalls = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: prepared.state.claimPublication,
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: (evidence) => {
        completionCalls += 1;
        return prepared.state.completePublication(evidence);
      },
    };
    const sync = syncFor(prepared, publisher, state, {
      ...POLICY,
      settlementReserveMilliseconds: 1,
    });

    const failure = await runEffectFailure(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.runPublicationWork({
        publisherCalls: 1,
        newWorkWindowMilliseconds: 10,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(failure).toBeInstanceOf(PublicationSettlementDeadlineError);
    expect(failure).toMatchObject({
      operation: "runPublicationWork",
      reason: "settlementWindowElapsed",
      identity: prepared.pending[0]?.identity,
      attemptOrdinal: 1,
      pending: { _tag: "completePublication" },
    });
    expect(completionCalls).toBe(0);
    expect((await runEffect(destination.snapshotForConformance())).acceptedPublications).toHaveLength(1);
  });

  it("reports the exact outcome pending at settlement-cutoff equality", async () => {
    const prepared = await prepareState(["publication-a"]);
    const delayedUnknown: ReferenceResultPublisherStep = () =>
      TestClock.adjust("10 millis").pipe(
        Effect.andThen(Effect.fail(new ResultPublisherOutcomeUnknownError({
          operation: "publish",
        }))),
      );
    const { publisher } = await makePublisherFixture([delayedUnknown]);
    let outcomeSettlementCalls = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: prepared.state.claimPublication,
      recordPublicationAttemptOutcome: (attempt, outcome) => {
        outcomeSettlementCalls += 1;
        return prepared.state.recordPublicationAttemptOutcome(attempt, outcome);
      },
      completePublication: prepared.state.completePublication,
    };
    const sync = syncFor(prepared, publisher, state, {
      ...POLICY,
      settlementReserveMilliseconds: 1,
    });

    const failure = await runEffectFailure(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.runPublicationWork({
        publisherCalls: 1,
        newWorkWindowMilliseconds: 10,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(failure).toBeInstanceOf(PublicationSettlementDeadlineError);
    expect(failure).toMatchObject({
      operation: "runPublicationWork",
      reason: "settlementWindowElapsed",
      identity: prepared.pending[0]?.identity,
      attemptOrdinal: 1,
      pending: {
        _tag: "recordPublicationAttemptOutcome",
        outcome: "outcomeUnknown",
      },
    });
    expect(outcomeSettlementCalls).toBe(0);
  });

  it("awaits a settlement operation already started before its cutoff", async () => {
    const prepared = await prepareState(["publication-a"]);
    const { publisher } = await makePublisherFixture([acceptStep]);
    let completionStarts = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: prepared.state.claimPublication,
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: (evidence) => Effect.sync(() => {
        completionStarts += 1;
      }).pipe(
        Effect.andThen(TestClock.adjust("10 millis")),
        Effect.andThen(prepared.state.completePublication(evidence)),
      ),
    };
    const sync = syncFor(prepared, publisher, state, {
      ...POLICY,
      settlementReserveMilliseconds: 1,
    });

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.runPublicationWork({
        publisherCalls: 2,
        newWorkWindowMilliseconds: 10,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "deadlineReached",
      progress: { completedPublications: 1 },
    });
    expect(completionStarts).toBe(1);
    expect((await runEffect(prepared.state.snapshotForConformance()))?.publicationWork.inFlight).toBeNull();
  });

  it("does not start a retry delay that reaches admission equality", async () => {
    const prepared = await prepareState(["publication-a"]);
    const { publisher } = await makePublisherFixture([acceptStep]);
    let claimCalls = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: () => {
        claimCalls += 1;
        return claimCalls === 1
          ? Effect.fail(new QuerySyncStateUnavailableError({
            operation: "claimPublication",
            commitCertainty: "notCommitted",
            reason: "temporarilyUnavailable",
            cause: null,
          }))
          : prepared.state.claimPublication();
      },
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: prepared.state.completePublication,
    };
    const sync = syncFor(prepared, publisher, state, {
      stateAttemptsPerOperation: 3,
      retryDelayMilliseconds: Object.freeze([9, 0]),
      settlementReserveMilliseconds: 1,
    });

    const failure = await runEffectFailure(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.runPublicationWork({
        publisherCalls: 1,
        newWorkWindowMilliseconds: 10,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(failure).toMatchObject({
      _tag: "QuerySyncStateUnavailableError",
      operation: "claimPublication",
    });
    expect(claimCalls).toBe(1);
    expect(await runEffect(publisher.snapshotForConformance())).toHaveLength(0);
  });
});

describe("publication orchestration authority and destination invariants", () => {
  it("retains captured binding, policy, state, publisher, and script values", async () => {
    const prepared = await prepareState(["publication-a"]);
    await runEffect(prepared.state.injectNextFault({
      operation: "claimPublication",
      timing: "beforeSwap",
    }));
    const publisherHarness = await runEffect(
      makeReferenceResultPublisherHarness(),
    );
    const destination = await runEffect(publisherHarness.makeDestination());
    const steps: ReferenceResultPublisherStep[] = [acceptStep];
    const referencePublisher = await runEffect(
      destination.makePublisher(steps),
    );
    const mutableBinding: Mutable<NamespacePublicationBinding> = {
      ...bindingFor(prepared.binding),
    };
    const mutablePolicy: Mutable<NamespacePublicationSyncPolicy> & {
      retryDelayMilliseconds: [number, number];
    } = {
      stateAttemptsPerOperation: 3,
      retryDelayMilliseconds: [0, 0],
      settlementReserveMilliseconds: 10,
    };
    const mutableState: Mutable<QuerySyncPublicationState> = {
      claimPublication: prepared.state.claimPublication,
      recordPublicationAttemptOutcome:
        prepared.state.recordPublicationAttemptOutcome,
      completePublication: prepared.state.completePublication,
    };
    const mutablePublisher: Mutable<ResultPublisher> = {
      publish: referencePublisher.publish,
    };
    const sync = getSuccess(makeNamespacePublicationSync({
      binding: mutableBinding,
      state: mutableState,
      publisher: mutablePublisher,
      policy: mutablePolicy,
    }));

    mutableBinding.namespaceId = cursor({ namespaceId: "mutated" }).namespaceId;
    mutablePolicy.stateAttemptsPerOperation = 1;
    mutablePolicy.retryDelayMilliseconds[0] = 60_000;
    mutablePolicy.settlementReserveMilliseconds = 59_999;
    mutableState.claimPublication = () => Effect.die("mutated state");
    mutablePublisher.publish = () => Effect.die("mutated publisher");
    steps[0] = () => Effect.die("mutated script");

    const outcome = await runEffect(sync.runPublicationWork({
      publisherCalls: 1,
      newWorkWindowMilliseconds: 1_000,
    }));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "publisherCallLimitReached",
      progress: {
        publisherCalls: 1,
        completedPublications: 1,
      },
    });
    expect(await runEffect(referencePublisher.snapshotForConformance())).toHaveLength(1);
  });

  it("dies on a terminal-refusal recorded receipt and performs no later work", async () => {
    const prepared = await prepareState(["publication-a"]);
    const attempt = await claimAttempt(prepared.state);
    const nextAttemptOrdinal = getSuccess(capturePublicationAttemptOrdinal(
      attempt.attemptOrdinal + 1,
    ));
    let claimCalls = 0;
    let publisherCalls = 0;
    let settlementCalls = 0;
    const state: QuerySyncPublicationState = {
      claimPublication: () => {
        claimCalls += 1;
        return Effect.succeed(Object.freeze({
          _tag: "replayed",
          attempt,
        }));
      },
      recordPublicationAttemptOutcome: () => {
        settlementCalls += 1;
        return Effect.succeed(Object.freeze({
          _tag: "recorded",
          identity: attempt.publication.identity,
          attemptOrdinal: attempt.attemptOrdinal,
          nextAttemptOrdinal,
          nextDisposition: "ready",
        }));
      },
      completePublication: () => Effect.die("Unexpected completion"),
    };
    const publisher: ResultPublisher = {
      publish: () => {
        publisherCalls += 1;
        return Effect.fail(new ResultPublisherTerminalRefusalError({
          operation: "publish",
        }));
      },
    };
    const sync = syncFor(prepared, publisher, state);

    const exit = await runEffect(Effect.exit(
      sync.runPublicationWork(BUDGET),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause);
      Result.match(defect, {
        onFailure: () => expect.unreachable("Expected invariant defect"),
        onSuccess: (observed) => expect(observed).toMatchObject({
          _tag: "QuerySyncInvariantDefect",
          operation: "recordPublicationAttemptOutcome",
          invariant: "publicationAttemptStateInvalid",
        } satisfies Partial<QuerySyncInvariantDefect>),
      });
    }
    expect({ claimCalls, publisherCalls, settlementCalls }).toEqual({
      claimCalls: 1,
      publisherCalls: 1,
      settlementCalls: 1,
    });
  });

  it.each([
    ["terminalPublisherRefusal", 1],
    ["attemptLimitReached", 128],
    ["ageLimitReached", 1],
  ] as const)(
    "returns frozen reset-required evidence for preblocked %s work without publishing",
    async (reason, attemptOrdinalInput) => {
      const prepared = await prepareState(["publication-a"]);
      const attempt = await claimAttempt(prepared.state);
      let publisherCalls = 0;
      const state: QuerySyncPublicationState = {
        claimPublication: () => Effect.succeed(Object.freeze({
          _tag: "blocked",
          identity: attempt.publication.identity,
          attemptOrdinal: getSuccess(capturePublicationAttemptOrdinal(
            attemptOrdinalInput,
          )),
          reason,
          resetRequired: true,
        })),
        recordPublicationAttemptOutcome: () => Effect.die(
          "Unexpected outcome settlement",
        ),
        completePublication: () => Effect.die("Unexpected completion"),
      };
      const publisher: ResultPublisher = {
        publish: () => {
          publisherCalls += 1;
          return Effect.void;
        },
      };
      const sync = syncFor(prepared, publisher, state);

      const outcome = await runEffect(sync.runPublicationWork(BUDGET));
      expect(outcome).toMatchObject({
        _tag: "publicationResetRequired",
        identity: attempt.publication.identity,
        attemptOrdinal: attemptOrdinalInput,
        reason,
        resetRequired: true,
        progress: {
          blockedPublications: 1,
          publisherCalls: 0,
        },
      });
      expect(publisherCalls).toBe(0);
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(Object.isFrozen(outcome.progress)).toBe(true);
      if (outcome._tag === "publicationResetRequired") {
        expect(Object.isFrozen(outcome.identity)).toBe(true);
      }
    },
  );

  it.each([
    "namespaceId",
    "syncModelId",
    "sourceEpoch",
  ] as const)(
    "fences an independently crossed %s before publisher or settlement",
    async (field) => {
      const prepared = await prepareState(["publication-a"]);
      const alternate = cursor({
        namespaceId: "tenant-other",
        syncModelId: "model-other",
        sourceEpoch: "epoch-other",
      });
      const requestedBinding: NamespacePublicationBinding = Object.freeze({
        namespaceId: field === "namespaceId"
          ? alternate.namespaceId
          : prepared.binding.namespaceId,
        syncModelId: field === "syncModelId"
          ? alternate.syncModelId
          : prepared.binding.syncModelId,
        sourceEpoch: field === "sourceEpoch"
          ? alternate.sourceEpoch
          : prepared.binding.sourceEpoch,
      });
      let outcomeSettlementCalls = 0;
      let completionCalls = 0;
      let publisherCalls = 0;
      const state: QuerySyncPublicationState = {
        claimPublication: prepared.state.claimPublication,
        recordPublicationAttemptOutcome: (attempt, outcome) => {
          outcomeSettlementCalls += 1;
          return prepared.state.recordPublicationAttemptOutcome(
            attempt,
            outcome,
          );
        },
        completePublication: (evidence) => {
          completionCalls += 1;
          return prepared.state.completePublication(evidence);
        },
      };
      const publisher: ResultPublisher = {
        publish: () => {
          publisherCalls += 1;
          return Effect.void;
        },
      };
      const sync = syncFor(
        prepared,
        publisher,
        state,
        POLICY,
        requestedBinding,
      );

      const failure = await runEffectFailure(
        sync.runPublicationWork(BUDGET),
      );
      expect(failure).toBeInstanceOf(PublicationAuthorityMismatchError);
      expect(failure).toMatchObject({
        operation: "runPublicationWork",
        reason: "boundAuthorityMismatch",
        field,
        identity: prepared.pending[0]?.identity,
      });
      expect({
        publisherCalls,
        outcomeSettlementCalls,
        completionCalls,
      }).toEqual({
        publisherCalls: 0,
        outcomeSettlementCalls: 0,
        completionCalls: 0,
      });
    },
  );

  it("deduplicates exact acceptance per destination and freezes snapshots", async () => {
    const prepared = await prepareState(["publication-a"]);
    const publication = prepared.pending[0];
    if (publication === undefined) throw new Error("Expected publication");
    const harness = await runEffect(makeReferenceResultPublisherHarness());
    const destination = await runEffect(harness.makeDestination());

    const first = await runEffect(destination.acceptExact(publication));
    const second = await runEffect(destination.acceptExact(publication));
    expect(first._tag).toBe("appended");
    expect(second._tag).toBe("alreadyAccepted");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.publication)).toBe(true);
    expect(Object.isFrozen(first.publication.identity)).toBe(true);

    const snapshot = await runEffect(destination.snapshotForConformance());
    expect(snapshot.acceptedPublications).toEqual([publication]);
    expect(snapshot.acceptedPublications[0]).not.toBe(publication);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.acceptedPublications)).toBe(true);
    expect(Object.isFrozen(snapshot.acceptedPublications[0])).toBe(true);
    expect(Object.isFrozen(snapshot.acceptedPublications[0]?.identity)).toBe(true);
  });

  it("defects on same-destination identity collisions in digest or content", async () => {
    const prepared = await prepareState(["publication-a"]);
    const publication = prepared.pending[0];
    if (publication === undefined) throw new Error("Expected publication");
    const harness = await runEffect(makeReferenceResultPublisherHarness());
    const destination = await runEffect(harness.makeDestination());
    await runEffect(destination.acceptExact(publication));
    const collisions: readonly PendingQueryPublication[] = Object.freeze([
      Object.freeze({ ...publication, resultDigest: digest(999) }),
      Object.freeze({
        ...publication,
        content: publicationArtifact("different-content").content,
      }),
    ]);

    for (const collision of collisions) {
      const exit = await runEffect(Effect.exit(
        destination.acceptExact(collision),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const defect = Cause.findDefect(exit.cause);
        Result.match(defect, {
          onFailure: () => expect.unreachable("Expected collision defect"),
          onSuccess: (observed) => {
            expect(observed).toBeInstanceOf(
              ReferenceResultDestinationInvariantDefect,
            );
            expect(observed).toMatchObject({
              _tag: "ReferenceResultDestinationInvariantDefect",
              operation: "acceptExact",
              reason: "publicationIdentityCollision",
            });
          },
        });
      }
    }
    expect((await runEffect(destination.snapshotForConformance())).acceptedPublications).toHaveLength(1);
  });

  it("keeps destinations and namespace, model, and epoch identities isolated", async () => {
    const prepared = await prepareState(["publication-a"]);
    const publication = prepared.pending[0];
    if (publication === undefined) throw new Error("Expected publication");
    const harness = await runEffect(makeReferenceResultPublisherHarness());
    const firstDestination = await runEffect(harness.makeDestination());
    const secondDestination = await runEffect(harness.makeDestination());
    expect((await runEffect(firstDestination.acceptExact(publication)))._tag).toBe("appended");
    expect((await runEffect(secondDestination.acceptExact(publication)))._tag).toBe("appended");
    expect((await runEffect(firstDestination.snapshotForConformance())).acceptedPublications).toHaveLength(1);
    expect((await runEffect(secondDestination.snapshotForConformance())).acceptedPublications).toHaveLength(1);

    const alternate = cursor({
      namespaceId: "tenant-other",
      syncModelId: "model-other",
      sourceEpoch: "epoch-other",
    });
    const identityVariant = (
      identity: QueryPublicationIdentity,
      field: "namespaceId" | "syncModelId" | "sourceEpoch",
    ): QueryPublicationIdentity => Object.freeze({
      ...identity,
      namespaceId: field === "namespaceId"
        ? alternate.namespaceId
        : identity.namespaceId,
      syncModelId: field === "syncModelId"
        ? alternate.syncModelId
        : identity.syncModelId,
      sourceEpoch: field === "sourceEpoch"
        ? alternate.sourceEpoch
        : identity.sourceEpoch,
    });
    const isolatedPublications = (
      ["namespaceId", "syncModelId", "sourceEpoch"] as const
    ).map((field): PendingQueryPublication => Object.freeze({
      ...publication,
      identity: identityVariant(publication.identity, field),
    }));
    for (const isolated of isolatedPublications) {
      expect((await runEffect(
        firstDestination.acceptExact(isolated),
      ))._tag).toBe("appended");
    }
    expect((await runEffect(firstDestination.snapshotForConformance())).acceptedPublications).toHaveLength(4);
  });
});
