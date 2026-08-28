import { Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  capturePublicationAttemptInstant,
  captureQueryPublicationArtifact,
  claimEvaluationWork,
  claimPublication,
  completeQueryEvaluation,
  completePublication,
  MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
  QueryKeyCollisionError,
  QuerySyncWorkLimitError,
  recordEvaluationAttemptOutcome,
  recordPublicationAttemptOutcome,
} from "@flarex/query-sync/internal/kernel";
import type {
  AcceptedQueryPublicationEvidence,
  BeginQueryEvaluationRequest,
  NamespaceCursor,
  PublicationAttempt,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryOperationTarget,
  QueryPublicationArtifact,
  QuerySyncState,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  makeReferenceQuerySyncStateHarness,
  makeAcceptedQueryPublicationEvidenceForTesting,
  makeQueryEvaluationAttemptForTesting,
  runStateConformanceCommands,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceQuerySyncTransitionState,
  ReferenceStateBinding,
  ReferenceStateFault,
  StateConformanceCommand,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  canonicalText,
  cursor,
  descriptor,
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
    expect.unreachable("Expected an initialized reference state");
  }
  return state;
}

function firstRegistrationRequest(
  queryTarget: QueryOperationTarget,
): BeginQueryEvaluationRequest {
  return Object.freeze({
    target: queryTarget,
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  });
}

function publicationArtifact(label: string): QueryPublicationArtifact {
  return getSuccess(captureQueryPublicationArtifact({
    content: canonicalText(label),
  }));
}

const installPendingPublication = Effect.fn(
  "QuerySync.Test.installPendingPublication",
)(function*(
  transitionState: ReferenceQuerySyncTransitionState,
  bootstrapCursor: NamespaceCursor,
  queryDescriptor: QueryDescriptor,
  label: string,
  dependencies: readonly string[] = [],
) {
  const begun = yield* transitionState.beginQueryEvaluation(
    firstRegistrationRequest(target({ descriptor: queryDescriptor })),
  );
  if (begun._tag !== "created" && begun._tag !== "replayed") {
    return yield* Effect.die(new Error(
      "Expected an evaluation attempt while preparing state",
    ));
  }
  const queryEvaluation = evaluation({
    descriptor: queryDescriptor,
    generation: begun.attempt.generation,
    snapshot: bootstrapCursor.appliedThroughSequence,
    dependencies,
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    begun.attempt.registrationCursor,
    [],
    queryEvaluation.authorityWitness,
  ));
  const publication = publicationArtifact(label);
  const completion = yield* transitionState.completeQueryEvaluation(
    begun.attempt,
    queryEvaluation,
    refresh,
    publication,
  );
  if (completion._tag !== "completed") {
    return yield* Effect.die(new Error(
      "Expected evaluation completion while preparing state",
    ));
  }
  return Object.freeze({
    attempt: begun.attempt,
    evaluation: queryEvaluation,
    refresh,
    publication,
  });
});

const claimPendingPublication = Effect.fn(
  "QuerySync.Test.claimPendingPublication",
)(function*(transitionState: ReferenceQuerySyncTransitionState) {
  const claimed = yield* transitionState.claimPublication();
  if (claimed._tag !== "claimed") {
    return yield* Effect.die(new Error(
      "Expected one pending publication claim",
    ));
  }
  return claimed.attempt;
});

function acceptanceFor(
  attempt: PublicationAttempt,
): AcceptedQueryPublicationEvidence {
  return makeAcceptedQueryPublicationEvidenceForTesting({
    identity: attempt.publication.identity,
    resultDigest: attempt.publication.resultDigest,
  });
}

function resultOutcomeTag(
  result: Result.Result<Readonly<{ readonly _tag: string }>, unknown>,
): string {
  return Result.match(result, {
    onFailure: (failure) => (
      typeof failure === "object"
      && failure !== null
      && "_tag" in failure
      && typeof failure._tag === "string"
        ? failure._tag
        : "UnknownFailure"
    ),
    onSuccess: (success) => success._tag,
  });
}

function expectInjectedFault(
  result: Result.Result<unknown, unknown>,
  operation: ReferenceStateFault["operation"],
  timing: ReferenceStateFault["timing"],
): void {
  Result.match(result, {
    onFailure: (failure) => expect(failure).toMatchObject(
      timing === "beforeSwap"
        ? {
          _tag: "QuerySyncStateUnavailableError",
          operation,
          commitCertainty: "notCommitted",
          reason: "temporarilyUnavailable",
        }
        : {
          _tag: "QuerySyncStateCommitOutcomeUnknownError",
          operation,
          commitCertainty: "unknown",
          reason: "responseLostAfterCommit",
        },
    ),
    onSuccess: () => expect.unreachable(
      `Expected ${timing} fault for ${operation}`,
    ),
  });
}

function makeSeededCommands(seed: number): readonly StateConformanceCommand[] {
  let randomState = seed >>> 0;
  const nextRandom = (): number => {
    randomState = (
      Math.imul(randomState, 1_664_525) + 1_013_904_223
    ) >>> 0;
    return randomState;
  };

  const bootstrapCursor = cursor();
  const queryDescriptor = descriptor({
    keySeed: nextRandom(),
    identity: `seeded-query-${seed}`,
  });
  const queryTarget = target({ descriptor: queryDescriptor });
  const dependency = canonicalText(`seeded-dependency-${seed}`);
  const firstPublication = publicationArtifact(
    `seeded-publication-${seed}-first`,
  );
  const commands: StateConformanceCommand[] = [{
    _tag: "initializeOrInspectNamespace",
    bootstrapCursor,
  }];

  const prefixCount = 1 + (nextRandom() % 3);
  for (let index = 1; index <= prefixCount; index += 1) {
    const admitted = batch({
      sequence: BigInt(index),
      dependencies: nextRandom() % 2 === 0 ? [dependency] : [],
    });
    commands.push({
      _tag: "applyAdmittedBatchAndAdvance",
      batch: admitted,
    });
    if (nextRandom() % 2 === 0) {
      commands.push({
        _tag: "applyAdmittedBatchAndAdvance",
        batch: admitted,
      });
    }
  }

  commands.push({
    _tag: "beginQueryEvaluation",
    request: firstRegistrationRequest(queryTarget),
  });
  if (nextRandom() % 2 === 0) {
    commands.push({
      _tag: "beginQueryEvaluation",
      request: firstRegistrationRequest(queryTarget),
    });
  }

  const firstSnapshot = BigInt(prefixCount);
  const firstRegistrationCursor = cursor({ sequence: firstSnapshot });
  const firstEvaluation = evaluation({
    descriptor: queryDescriptor,
    generation: 1n,
    snapshot: firstSnapshot,
    dependencies: [dependency],
    resultSeed: nextRandom(),
    witnessSeed: nextRandom(),
  });
  const firstAttempt = makeQueryEvaluationAttemptForTesting({
    namespaceId: firstRegistrationCursor.namespaceId,
    syncModelId: firstRegistrationCursor.syncModelId,
    sourceEpoch: firstRegistrationCursor.sourceEpoch,
    descriptor: queryDescriptor,
    generation: firstEvaluation.generation,
    expectedActiveGeneration: null,
    registrationCursor: firstRegistrationCursor,
    requestedDirtyThroughSequence: null,
  });
  commands.push({
    _tag: "completeQueryEvaluation",
    attempt: firstAttempt,
    evaluation: firstEvaluation,
    refresh: getSuccess(deriveGenerationRefreshEvidence(
      firstEvaluation,
      firstRegistrationCursor,
      [],
      firstEvaluation.authorityWitness,
    )),
    publication: firstPublication,
  });

  const tailCount = 1 + (nextRandom() % 3);
  let requestedDirtyThroughSequence: SyncSequence | null = null;
  for (let offset = 1; offset <= tailCount; offset += 1) {
    const sequence = BigInt(prefixCount + offset);
    const includesDependency = nextRandom() % 2 === 0;
    const admitted = batch({
      sequence,
      dependencies: includesDependency ? [dependency] : [],
    });
    if (includesDependency) {
      requestedDirtyThroughSequence = admitted.sourceSequence;
    }
    commands.push({
      _tag: "applyAdmittedBatchAndAdvance",
      batch: admitted,
    });
    if (nextRandom() % 3 === 0) {
      commands.push({
        _tag: "applyAdmittedBatchAndAdvance",
        batch: admitted,
      });
    }
  }

  const secondSnapshot = BigInt(prefixCount + tailCount);
  if (requestedDirtyThroughSequence !== null) {
    const secondRegistrationCursor = cursor({ sequence: secondSnapshot });
    const secondRequest = Object.freeze({
      target: queryTarget,
      expectedActiveGeneration: firstAttempt.generation,
      requestedDirtyThroughSequence,
    });
    const secondEvaluation = evaluation({
      descriptor: queryDescriptor,
      generation: 2n,
      snapshot: secondSnapshot,
      dependencies: nextRandom() % 2 === 0 ? [dependency] : [],
      resultSeed: nextRandom(),
      witnessSeed: nextRandom(),
    });
    const secondAttempt: QueryEvaluationAttempt =
      makeQueryEvaluationAttemptForTesting({
        namespaceId: secondRegistrationCursor.namespaceId,
        syncModelId: secondRegistrationCursor.syncModelId,
        sourceEpoch: secondRegistrationCursor.sourceEpoch,
        descriptor: queryDescriptor,
        generation: secondEvaluation.generation,
        expectedActiveGeneration: firstAttempt.generation,
        registrationCursor: secondRegistrationCursor,
        requestedDirtyThroughSequence,
      });
    commands.push({
      _tag: "beginQueryEvaluation",
      request: secondRequest,
    });
    commands.push({
      _tag: "completeQueryEvaluation",
      attempt: secondAttempt,
      evaluation: secondEvaluation,
      refresh: getSuccess(deriveGenerationRefreshEvidence(
        secondEvaluation,
        secondRegistrationCursor,
        [],
        secondEvaluation.authorityWitness,
      )),
      publication: publicationArtifact(
        `seeded-publication-${seed}-second`,
      ),
    });
  }

  return Object.freeze(commands);
}

describe("reference transition-state extended conformance", () => {
  it("records an outcome from the attempt returned by begin", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-begin-attempt-outcome",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );

    const begun = await runEffect(transitionState.beginQueryEvaluation(
      firstRegistrationRequest(target()),
    ));
    if (begun._tag !== "created" && begun._tag !== "replayed") {
      throw new Error(`Expected an evaluation attempt, received ${begun._tag}`);
    }
    expect(await runEffect(transitionState.recordEvaluationAttemptOutcome(
      begun.attempt,
      "transientExhausted",
    ))).toMatchObject({
      _tag: "eligible",
      generation: begun.attempt.generation,
    });
  });

  it("refuses a query-key collision without mutating stored state", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-query-collision",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );

    const storedDescriptor = descriptor({
      keySeed: 701,
      identity: "stored-query-identity",
    });
    await runEffect(transitionState.beginQueryEvaluation(
      firstRegistrationRequest(target({
        descriptor: storedDescriptor,
      })),
    ));
    const beforeCollision = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));

    const failure = await runEffectFailure(
      transitionState.beginQueryEvaluation(firstRegistrationRequest(target({
        descriptor: descriptor({
          keySeed: 701,
          identity: "conflicting-query-identity",
        }),
      }))),
    );

    expect(failure).toBeInstanceOf(QueryKeyCollisionError);
    expect(failure).toMatchObject({
      operation: "beginQueryEvaluation",
      queryKey: storedDescriptor.queryKey,
    });
    expect(await runEffect(
      transitionState.snapshotForConformance(),
    )).toBe(beforeCollision);
  });

  it("executes collision and hard-limit failures through the shared oracle", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-negative-oracle",
      bootstrapCursor,
    ));
    const storedDescriptor = descriptor({
      keySeed: 702,
      identity: "negative-oracle-stored",
    });
    const conflictingTarget = target({
      descriptor: descriptor({
        keySeed: 702,
        identity: "negative-oracle-conflict",
      }),
    });
    const admitted = batch({
      sequence: 1n,
      dependencies: [canonicalText("negative-oracle-limit")],
    });
    const limitKey = admitted.dependencyKeys[0];
    if (limitKey === undefined) {
      throw new Error("Expected one captured dependency key");
    }
    const oversizedBatch = Object.freeze({
      ...admitted,
      dependencyKeys: Object.freeze(Array.from(
        { length: MAX_INVALIDATION_DEPENDENCY_LOOKUPS + 1 },
        () => limitKey,
      )),
    });

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
            request: firstRegistrationRequest(target({
              descriptor: storedDescriptor,
            })),
          },
          {
            _tag: "beginQueryEvaluation",
            request: firstRegistrationRequest(conflictingTarget),
          },
          {
            _tag: "applyAdmittedBatchAndAdvance",
            batch: oversizedBatch,
          },
        ],
      },
    ));

    expect(steps).toHaveLength(4);
    for (const step of steps) {
      expect(step.outcome).toEqual(step.expectedOutcome);
      expect(step.snapshot).toEqual(step.expectedSnapshot);
    }
    const collision = steps[2]?.outcome;
    const limit = steps[3]?.outcome;
    expect(collision !== undefined && Result.isFailure(collision)).toBe(true);
    expect(limit !== undefined && Result.isFailure(limit)).toBe(true);
    if (collision === undefined || Result.isSuccess(collision)) return;
    if (limit === undefined || Result.isSuccess(limit)) return;
    expect(collision.failure).toBeInstanceOf(QueryKeyCollisionError);
    expect(limit.failure).toBeInstanceOf(QuerySyncWorkLimitError);
    expect(limit.failure).toMatchObject({
      operation: "applyAdmittedInvalidations",
      dimension: "dependencyLookups",
      maximum: MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
      observed: MAX_INVALIDATION_DEPENDENCY_LOOKUPS + 1,
    });
  });

  it("preserves exact recovery semantics for before- and after-swap faults on every C2 mutation", async () => {
    await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(10_000);
      const harness = yield* makeReferenceQuerySyncStateHarness();

      for (const timing of ["beforeSwap", "afterSwap"] as const) {
        const evaluationCursor = cursor();
        const evaluationState = harness.bind(bindingFor(
          `fault-evaluation-claim-${timing}`,
          evaluationCursor,
        ));
        yield* evaluationState.initializeOrInspectNamespace(evaluationCursor);
        yield* evaluationState.beginQueryEvaluation(
          firstRegistrationRequest(target()),
        );
        const beforeEvaluationClaim = requireState(
          yield* evaluationState.snapshotForConformance(),
        );
        yield* evaluationState.injectNextFault({
          operation: "claimEvaluationWork",
          timing,
        });
        const lostEvaluationClaim = yield* Effect.result(
          evaluationState.claimEvaluationWork({
            maximumQueryInspections: 1,
            continuation: null,
          }),
        );
        expectInjectedFault(
          lostEvaluationClaim,
          "claimEvaluationWork",
          timing,
        );
        const afterEvaluationClaimFault = requireState(
          yield* evaluationState.snapshotForConformance(),
        );
        expect(afterEvaluationClaimFault === beforeEvaluationClaim).toBe(
          timing === "beforeSwap",
        );
        const recoveredEvaluationClaim = yield*
          evaluationState.claimEvaluationWork({
            maximumQueryInspections: 1,
            continuation: null,
          });
        expect(recoveredEvaluationClaim._tag).toBe("claimed");

        const outcomeCursor = cursor();
        const outcomeState = harness.bind(bindingFor(
          `fault-evaluation-outcome-${timing}`,
          outcomeCursor,
        ));
        yield* outcomeState.initializeOrInspectNamespace(outcomeCursor);
        yield* outcomeState.beginQueryEvaluation(
          firstRegistrationRequest(target()),
        );
        const evaluationWork = yield* outcomeState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        });
        if (evaluationWork._tag !== "claimed") {
          return yield* Effect.die(new Error(
            "Expected evaluation work for outcome fault",
          ));
        }
        const beforeEvaluationOutcome = requireState(
          yield* outcomeState.snapshotForConformance(),
        );
        yield* outcomeState.injectNextFault({
          operation: "recordEvaluationAttemptOutcome",
          timing,
        });
        const lostEvaluationOutcome = yield* Effect.result(
          outcomeState.recordEvaluationAttemptOutcome(
            evaluationWork.attempt,
            "terminalRefusal",
          ),
        );
        expectInjectedFault(
          lostEvaluationOutcome,
          "recordEvaluationAttemptOutcome",
          timing,
        );
        const afterEvaluationOutcomeFault = requireState(
          yield* outcomeState.snapshotForConformance(),
        );
        expect(afterEvaluationOutcomeFault === beforeEvaluationOutcome).toBe(
          timing === "beforeSwap",
        );
        const recoveredEvaluationOutcome = yield*
          outcomeState.recordEvaluationAttemptOutcome(
            evaluationWork.attempt,
            "terminalRefusal",
          );
        expect(recoveredEvaluationOutcome).toMatchObject({
          _tag: "blocked",
          blockedWork: {
            queryKey: evaluationWork.attempt.descriptor.queryKey,
            generation: evaluationWork.attempt.generation,
            reason: "terminalEvaluatorRefusal",
            resetRequired: true,
          },
        });
        const afterEvaluationOutcomeRecovery = requireState(
          yield* outcomeState.snapshotForConformance(),
        );
        expect(afterEvaluationOutcomeRecovery.evaluationWork.revision).toBe(
          beforeEvaluationOutcome.evaluationWork.revision + 1n,
        );
        if (timing === "afterSwap") {
          expect(afterEvaluationOutcomeRecovery).toBe(
            afterEvaluationOutcomeFault,
          );
        }

        const publicationClaimCursor = cursor();
        const publicationClaimState = harness.bind(bindingFor(
          `fault-publication-claim-${timing}`,
          publicationClaimCursor,
        ));
        yield* publicationClaimState.initializeOrInspectNamespace(
          publicationClaimCursor,
        );
        yield* installPendingPublication(
          publicationClaimState,
          publicationClaimCursor,
          descriptor(),
          `fault-publication-claim-${timing}`,
        );
        const beforePublicationClaim = requireState(
          yield* publicationClaimState.snapshotForConformance(),
        );
        yield* publicationClaimState.injectNextFault({
          operation: "claimPublication",
          timing,
        });
        const lostPublicationClaim = yield* Effect.result(
          publicationClaimState.claimPublication(),
        );
        expectInjectedFault(
          lostPublicationClaim,
          "claimPublication",
          timing,
        );
        const afterPublicationClaimFault = requireState(
          yield* publicationClaimState.snapshotForConformance(),
        );
        expect(afterPublicationClaimFault === beforePublicationClaim).toBe(
          timing === "beforeSwap",
        );
        const recoveredPublicationClaim = yield*
          publicationClaimState.claimPublication();
        expect(recoveredPublicationClaim._tag).toBe(
          timing === "beforeSwap" ? "claimed" : "replayed",
        );
        if (recoveredPublicationClaim._tag === "blocked"
          || recoveredPublicationClaim._tag === "none") {
          return yield* Effect.die(new Error(
            "Expected recovered publication attempt",
          ));
        }
        expect(recoveredPublicationClaim.attempt.attemptOrdinal).toBe(1);

        const publicationOutcomeCursor = cursor();
        const publicationOutcomeState = harness.bind(bindingFor(
          `fault-publication-outcome-${timing}`,
          publicationOutcomeCursor,
        ));
        yield* publicationOutcomeState.initializeOrInspectNamespace(
          publicationOutcomeCursor,
        );
        yield* installPendingPublication(
          publicationOutcomeState,
          publicationOutcomeCursor,
          descriptor(),
          `fault-publication-outcome-${timing}`,
        );
        const publicationAttempt = yield* claimPendingPublication(
          publicationOutcomeState,
        );
        const beforePublicationOutcome = requireState(
          yield* publicationOutcomeState.snapshotForConformance(),
        );
        yield* publicationOutcomeState.injectNextFault({
          operation: "recordPublicationAttemptOutcome",
          timing,
        });
        const lostPublicationOutcome = yield* Effect.result(
          publicationOutcomeState.recordPublicationAttemptOutcome(
            publicationAttempt,
            "knownNotAppended",
          ),
        );
        expectInjectedFault(
          lostPublicationOutcome,
          "recordPublicationAttemptOutcome",
          timing,
        );
        const afterPublicationOutcomeFault = requireState(
          yield* publicationOutcomeState.snapshotForConformance(),
        );
        expect(afterPublicationOutcomeFault === beforePublicationOutcome).toBe(
          timing === "beforeSwap",
        );
        const recoveredPublicationOutcome = yield*
          publicationOutcomeState.recordPublicationAttemptOutcome(
            publicationAttempt,
            "knownNotAppended",
          );
        expect(recoveredPublicationOutcome).toMatchObject({
          _tag: "recorded",
          attemptOrdinal: 1,
          nextAttemptOrdinal: 2,
          nextDisposition: "ready",
        });
        const afterPublicationOutcomeRecovery = requireState(
          yield* publicationOutcomeState.snapshotForConformance(),
        );
        expect(
          afterPublicationOutcomeRecovery.publicationWork.inFlight
            ?.attemptOrdinal,
        ).toBe(2);
        if (timing === "afterSwap") {
          expect(afterPublicationOutcomeRecovery).toBe(
            afterPublicationOutcomeFault,
          );
        }

        const publicationCompletionCursor = cursor();
        const publicationCompletionState = harness.bind(bindingFor(
          `fault-publication-completion-${timing}`,
          publicationCompletionCursor,
        ));
        yield* publicationCompletionState.initializeOrInspectNamespace(
          publicationCompletionCursor,
        );
        yield* installPendingPublication(
          publicationCompletionState,
          publicationCompletionCursor,
          descriptor(),
          `fault-publication-completion-${timing}`,
        );
        const completionAttempt = yield* claimPendingPublication(
          publicationCompletionState,
        );
        const completionEvidence = acceptanceFor(completionAttempt);
        const beforePublicationCompletion = requireState(
          yield* publicationCompletionState.snapshotForConformance(),
        );
        yield* publicationCompletionState.injectNextFault({
          operation: "completePublication",
          timing,
        });
        const lostPublicationCompletion = yield* Effect.result(
          publicationCompletionState.completePublication(completionEvidence),
        );
        expectInjectedFault(
          lostPublicationCompletion,
          "completePublication",
          timing,
        );
        const afterPublicationCompletionFault = requireState(
          yield* publicationCompletionState.snapshotForConformance(),
        );
        expect(
          afterPublicationCompletionFault === beforePublicationCompletion,
        ).toBe(timing === "beforeSwap");
        const recoveredPublicationCompletion = yield*
          publicationCompletionState.completePublication(completionEvidence);
        expect(recoveredPublicationCompletion._tag).toBe(
          timing === "beforeSwap" ? "completed" : "replayed",
        );
        const afterPublicationCompletionRecovery = requireState(
          yield* publicationCompletionState.snapshotForConformance(),
        );
        expect(afterPublicationCompletionRecovery.publicationWork.inFlight)
          .toBeNull();
        expect(afterPublicationCompletionRecovery.publicationWork.latestDelivered)
          .toMatchObject({ identity: completionEvidence.identity });
        if (timing === "afterSwap") {
          expect(afterPublicationCompletionRecovery).toBe(
            afterPublicationCompletionFault,
          );
        }
      }
    }).pipe(Effect.provide(TestClock.layer())));
  });

  it("serializes competing C2 claims and terminal/completion turns to complete pure histories", async () => {
    await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(20_000);
      const harness = yield* makeReferenceQuerySyncStateHarness();

      const multiClaimCursor = cursor();
      const multiClaimState = harness.bind(bindingFor(
        "concurrency-two-evaluation-claims",
        multiClaimCursor,
      ));
      yield* multiClaimState.initializeOrInspectNamespace(multiClaimCursor);
      const firstDescriptor = descriptor({ keySeed: 11, identity: "claim-a" });
      const secondDescriptor = descriptor({ keySeed: 3, identity: "claim-b" });
      yield* multiClaimState.beginQueryEvaluation(firstRegistrationRequest(
        target({ descriptor: firstDescriptor }),
      ));
      yield* multiClaimState.beginQueryEvaluation(firstRegistrationRequest(
        target({ descriptor: secondDescriptor }),
      ));
      const beforeClaims = requireState(
        yield* multiClaimState.snapshotForConformance(),
      );
      const firstPureClaim = getSuccess(claimEvaluationWork(beforeClaims, {
        maximumQueryInspections: 1,
        continuation: null,
      }));
      const secondPureClaim = getSuccess(claimEvaluationWork(
        firstPureClaim.state,
        { maximumQueryInspections: 1, continuation: null },
      ));
      const competingClaims = yield* Effect.all([
        multiClaimState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
        multiClaimState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      ] as const, { concurrency: "unbounded" });
      if (
        competingClaims[0]._tag !== "claimed"
        || competingClaims[1]._tag !== "claimed"
      ) {
        return yield* Effect.die(new Error(
          "Expected two serialized evaluation claims",
        ));
      }
      const claimedQueryKeys = [
        competingClaims[0].attempt.descriptor.queryKey,
        competingClaims[1].attempt.descriptor.queryKey,
      ];
      expect(claimedQueryKeys).toHaveLength(2);
      expect(new Set(claimedQueryKeys).size).toBe(2);
      expect(claimedQueryKeys).toEqual(expect.arrayContaining([
        firstDescriptor.queryKey,
        secondDescriptor.queryKey,
      ]));
      expect(requireState(yield* multiClaimState.snapshotForConformance()))
        .toEqual(secondPureClaim.state);

      const invalidationCursor = cursor();
      const invalidationState = harness.bind(bindingFor(
        "concurrency-evaluation-claim-invalidation",
        invalidationCursor,
      ));
      yield* invalidationState.initializeOrInspectNamespace(invalidationCursor);
      const invalidationDependency = canonicalText("claim-race-dependency");
      yield* installPendingPublication(
        invalidationState,
        invalidationCursor,
        descriptor(),
        "claim-race-initial-publication",
        [invalidationDependency],
      );
      yield* invalidationState.applyAdmittedBatchAndAdvance(batch({
        sequence: 1n,
        dependencies: [invalidationDependency],
      }));
      const beforeClaimInvalidation = requireState(
        yield* invalidationState.snapshotForConformance(),
      );
      const laterInvalidation = batch({
        sequence: 2n,
        dependencies: [invalidationDependency],
      });
      const pureClaimFirst = getSuccess(claimEvaluationWork(
        beforeClaimInvalidation,
        { maximumQueryInspections: 1, continuation: null },
      ));
      const pureInvalidationAfterClaim = getSuccess(
        applyAdmittedInvalidations(pureClaimFirst.state, laterInvalidation),
      );
      const pureInvalidationFirst = getSuccess(applyAdmittedInvalidations(
        beforeClaimInvalidation,
        laterInvalidation,
      ));
      const pureClaimAfterInvalidation = getSuccess(claimEvaluationWork(
        pureInvalidationFirst.state,
        { maximumQueryInspections: 1, continuation: null },
      ));
      const [claimReceipt, invalidationReceipt] = yield* Effect.all([
        invalidationState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
        invalidationState.applyAdmittedBatchAndAdvance(laterInvalidation),
      ] as const, { concurrency: "unbounded" });
      if (claimReceipt._tag !== "claimed") {
        return yield* Effect.die(new Error(
          "Expected claim in invalidation race",
        ));
      }
      expect(invalidationReceipt._tag).toBe("applied");
      const afterClaimInvalidation = requireState(
        yield* invalidationState.snapshotForConformance(),
      );
      if (claimReceipt.attempt.requestedDirtyThroughSequence === 1n) {
        expect(afterClaimInvalidation).toEqual(
          pureInvalidationAfterClaim.state,
        );
      } else {
        expect(claimReceipt.attempt.requestedDirtyThroughSequence).toBe(2n);
        expect(afterClaimInvalidation).toEqual(
          pureClaimAfterInvalidation.state,
        );
      }

      const terminalCursor = cursor();
      const terminalState = harness.bind(bindingFor(
        "concurrency-terminal-outcome-completion",
        terminalCursor,
      ));
      yield* terminalState.initializeOrInspectNamespace(terminalCursor);
      yield* terminalState.beginQueryEvaluation(
        firstRegistrationRequest(target()),
      );
      const terminalClaim = yield* terminalState.claimEvaluationWork({
        maximumQueryInspections: 1,
        continuation: null,
      });
      if (terminalClaim._tag !== "claimed") {
        return yield* Effect.die(new Error(
          "Expected evaluation claim for terminal race",
        ));
      }
      const terminalEvaluation = evaluation({
        descriptor: terminalClaim.attempt.descriptor,
        generation: terminalClaim.attempt.generation,
        snapshot: 0n,
      });
      const terminalRefresh = getSuccess(deriveGenerationRefreshEvidence(
        terminalEvaluation,
        terminalCursor,
        [],
        terminalEvaluation.authorityWitness,
      ));
      const terminalPublication = publicationArtifact(
        "terminal-completion-race",
      );
      const beforeTerminalRace = requireState(
        yield* terminalState.snapshotForConformance(),
      );
      const pureTerminalFirst = getSuccess(recordEvaluationAttemptOutcome(
        beforeTerminalRace,
        terminalClaim.attempt,
        "terminalRefusal",
      ));
      const pureCompletionAfterTerminal = completeQueryEvaluation(
        pureTerminalFirst.state,
        terminalClaim.attempt,
        terminalEvaluation,
        terminalRefresh,
        terminalPublication,
      );
      const pureCompletionFirst = getSuccess(completeQueryEvaluation(
        beforeTerminalRace,
        terminalClaim.attempt,
        terminalEvaluation,
        terminalRefresh,
        terminalPublication,
      ));
      const pureTerminalAfterCompletion = getSuccess(
        recordEvaluationAttemptOutcome(
          pureCompletionFirst.state,
          terminalClaim.attempt,
          "terminalRefusal",
        ),
      );
      const [terminalOutcome, terminalCompletion] = yield* Effect.all([
        Effect.result(terminalState.recordEvaluationAttemptOutcome(
          terminalClaim.attempt,
          "terminalRefusal",
        )),
        Effect.result(terminalState.completeQueryEvaluation(
          terminalClaim.attempt,
          terminalEvaluation,
          terminalRefresh,
          terminalPublication,
        )),
      ] as const, { concurrency: "unbounded" });
      const afterTerminalRace = requireState(
        yield* terminalState.snapshotForConformance(),
      );
      if (
        Result.isSuccess(terminalOutcome)
        && terminalOutcome.success._tag === "blocked"
      ) {
        expect(terminalCompletion).toEqual(Result.map(
          pureCompletionAfterTerminal,
          (decision) => ({ _tag: decision._tag }),
        ));
        expect(afterTerminalRace).toEqual(pureTerminalFirst.state);
      } else {
        expect(resultOutcomeTag(terminalCompletion)).toBe("completed");
        expect(resultOutcomeTag(terminalOutcome)).toBe(
          pureTerminalAfterCompletion._tag,
        );
        expect(afterTerminalRace).toEqual(
          pureTerminalAfterCompletion.state,
        );
      }

      const publicationCursor = cursor();
      const publicationState = harness.bind(bindingFor(
        "concurrency-publication-claims",
        publicationCursor,
      ));
      yield* publicationState.initializeOrInspectNamespace(publicationCursor);
      yield* installPendingPublication(
        publicationState,
        publicationCursor,
        descriptor(),
        "concurrent-publication-claim",
      );
      const beforePublicationClaims = requireState(
        yield* publicationState.snapshotForConformance(),
      );
      const capturedNow = getSuccess(capturePublicationAttemptInstant(20_000));
      const purePublicationClaim = getSuccess(claimPublication(
        beforePublicationClaims,
        capturedNow,
      ));
      const purePublicationReplay = getSuccess(claimPublication(
        purePublicationClaim.state,
        capturedNow,
      ));
      const publicationClaims = yield* Effect.all([
        publicationState.claimPublication(),
        publicationState.claimPublication(),
      ] as const, { concurrency: "unbounded" });
      const publicationClaimTags = publicationClaims.map(
        (receipt) => receipt._tag,
      );
      expect(publicationClaimTags).toHaveLength(2);
      expect(publicationClaimTags).toEqual(expect.arrayContaining([
        "claimed",
        "replayed",
      ]));
      const attempts = publicationClaims.flatMap((receipt) => (
        receipt._tag === "claimed" || receipt._tag === "replayed"
          ? [receipt.attempt]
          : []
      ));
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      expect(requireState(yield* publicationState.snapshotForConformance()))
        .toEqual(purePublicationReplay.state);
    }).pipe(Effect.provide(TestClock.layer())));
  });

  it("serializes publication outcome and exact completion in both orders", async () => {
    await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(30_000);
      const harness = yield* makeReferenceQuerySyncStateHarness();
      const capturedNow = getSuccess(capturePublicationAttemptInstant(30_000));

      const runOrderedHistory = Effect.fn(
        "QuerySync.Test.runOrderedPublicationHistory",
      )(function*(
        physicalNamespaceId: string,
        order: "outcomeFirst" | "completionFirst",
      ) {
        const bootstrapCursor = cursor();
        const transitionState = harness.bind(bindingFor(
          physicalNamespaceId,
          bootstrapCursor,
        ));
        yield* transitionState.initializeOrInspectNamespace(bootstrapCursor);
        yield* installPendingPublication(
          transitionState,
          bootstrapCursor,
          descriptor(),
          physicalNamespaceId,
        );
        const attempt = yield* claimPendingPublication(transitionState);
        const evidence = acceptanceFor(attempt);
        const before = requireState(
          yield* transitionState.snapshotForConformance(),
        );
        const pureOutcomeFirst = getSuccess(recordPublicationAttemptOutcome(
          before,
          attempt,
          "knownNotAppended",
          capturedNow,
        ));
        const pureCompletionAfterOutcome = getSuccess(completePublication(
          pureOutcomeFirst.state,
          evidence,
        ));
        const pureCompletionFirst = getSuccess(completePublication(
          before,
          evidence,
        ));
        const pureOutcomeAfterCompletion = getSuccess(
          recordPublicationAttemptOutcome(
            pureCompletionFirst.state,
            attempt,
            "knownNotAppended",
            capturedNow,
          ),
        );

        if (order === "outcomeFirst") {
          expect((yield* transitionState.recordPublicationAttemptOutcome(
            attempt,
            "knownNotAppended",
          ))._tag).toBe("recorded");
          expect((yield* transitionState.completePublication(evidence))._tag)
            .toBe("completed");
          expect(requireState(yield* transitionState.snapshotForConformance()))
            .toEqual(pureCompletionAfterOutcome.state);
        } else {
          expect((yield* transitionState.completePublication(evidence))._tag)
            .toBe("completed");
          expect((yield* transitionState.recordPublicationAttemptOutcome(
            attempt,
            "knownNotAppended",
          ))._tag).toBe(pureOutcomeAfterCompletion._tag);
          expect(pureOutcomeAfterCompletion._tag).toBe("superseded");
          expect(requireState(yield* transitionState.snapshotForConformance()))
            .toEqual(pureOutcomeAfterCompletion.state);
        }

        return Object.freeze({
          transitionState,
          attempt,
          evidence,
          before,
          histories: Object.freeze([
            Object.freeze({
              outcome: pureOutcomeFirst._tag,
              completion: pureCompletionAfterOutcome._tag,
              state: pureCompletionAfterOutcome.state,
            }),
            Object.freeze({
              outcome: pureOutcomeAfterCompletion._tag,
              completion: pureCompletionFirst._tag,
              state: pureOutcomeAfterCompletion.state,
            }),
          ]),
        });
      });

      yield* runOrderedHistory(
        "publication-outcome-before-completion",
        "outcomeFirst",
      );
      yield* runOrderedHistory(
        "publication-completion-before-outcome",
        "completionFirst",
      );

      const concurrentCursor = cursor();
      const concurrentState = harness.bind(bindingFor(
        "publication-outcome-completion-concurrent",
        concurrentCursor,
      ));
      yield* concurrentState.initializeOrInspectNamespace(concurrentCursor);
      yield* installPendingPublication(
        concurrentState,
        concurrentCursor,
        descriptor(),
        "publication-outcome-completion-concurrent",
      );
      const concurrentAttempt = yield* claimPendingPublication(concurrentState);
      const concurrentEvidence = acceptanceFor(concurrentAttempt);
      const concurrentBefore = requireState(
        yield* concurrentState.snapshotForConformance(),
      );
      const pureConcurrentOutcomeFirst = getSuccess(
        recordPublicationAttemptOutcome(
          concurrentBefore,
          concurrentAttempt,
          "knownNotAppended",
          capturedNow,
        ),
      );
      const pureConcurrentCompletionAfter = getSuccess(completePublication(
        pureConcurrentOutcomeFirst.state,
        concurrentEvidence,
      ));
      const pureConcurrentCompletionFirst = getSuccess(completePublication(
        concurrentBefore,
        concurrentEvidence,
      ));
      const pureConcurrentOutcomeAfter = getSuccess(
        recordPublicationAttemptOutcome(
          pureConcurrentCompletionFirst.state,
          concurrentAttempt,
          "knownNotAppended",
          capturedNow,
        ),
      );
      const [outcomeReceipt, completionReceipt] = yield* Effect.all([
        concurrentState.recordPublicationAttemptOutcome(
          concurrentAttempt,
          "knownNotAppended",
        ),
        concurrentState.completePublication(concurrentEvidence),
      ] as const, { concurrency: "unbounded" });
      expect([
        {
          outcome: pureConcurrentOutcomeFirst._tag,
          completion: pureConcurrentCompletionAfter._tag,
          state: pureConcurrentCompletionAfter.state,
        },
        {
          outcome: pureConcurrentOutcomeAfter._tag,
          completion: pureConcurrentCompletionFirst._tag,
          state: pureConcurrentOutcomeAfter.state,
        },
      ]).toContainEqual({
        outcome: outcomeReceipt._tag,
        completion: completionReceipt._tag,
        state: requireState(yield* concurrentState.snapshotForConformance()),
      });
    }).pipe(Effect.provide(TestClock.layer())));
  });

  it("serializes delivery of older in-flight work against queued-newer replacement", async () => {
    await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(40_000);
      const harness = yield* makeReferenceQuerySyncStateHarness();
      const bootstrapCursor = cursor();
      const transitionState = harness.bind(bindingFor(
        "older-delivery-queued-replacement",
        bootstrapCursor,
      ));
      yield* transitionState.initializeOrInspectNamespace(bootstrapCursor);
      const queryDescriptor = descriptor();
      const dependency = canonicalText("queued-replacement-dependency");
      const generationOne = yield* installPendingPublication(
        transitionState,
        bootstrapCursor,
        queryDescriptor,
        "queued-replacement-generation-1",
        [dependency],
      );
      const olderAttempt = yield* claimPendingPublication(transitionState);
      const olderEvidence = acceptanceFor(olderAttempt);

      yield* transitionState.applyAdmittedBatchAndAdvance(batch({
        sequence: 1n,
        dependencies: [dependency],
      }));
      const afterFirstInvalidation = requireState(
        yield* transitionState.snapshotForConformance(),
      );
      const firstDirtyThrough = afterFirstInvalidation.queries[0]?.active
        ?.dirtyThroughSequence;
      if (firstDirtyThrough === null || firstDirtyThrough === undefined) {
        return yield* Effect.die(new Error(
          "Expected generation one to be dirty",
        ));
      }
      const generationTwoBegin = yield* transitionState.beginQueryEvaluation({
        target: target({ descriptor: queryDescriptor }),
        expectedActiveGeneration: generationOne.attempt.generation,
        requestedDirtyThroughSequence: firstDirtyThrough,
      });
      if (generationTwoBegin._tag !== "created") {
        return yield* Effect.die(new Error(
          "Expected generation two evaluation",
        ));
      }
      const generationTwoEvaluation = evaluation({
        descriptor: queryDescriptor,
        generation: generationTwoBegin.attempt.generation,
        snapshot: 1n,
        dependencies: [dependency],
        resultSeed: 202,
      });
      yield* transitionState.completeQueryEvaluation(
        generationTwoBegin.attempt,
        generationTwoEvaluation,
        getSuccess(deriveGenerationRefreshEvidence(
          generationTwoEvaluation,
          generationTwoBegin.attempt.registrationCursor,
          [],
          generationTwoEvaluation.authorityWitness,
        )),
        publicationArtifact("queued-replacement-generation-2"),
      );
      expect(requireState(
        yield* transitionState.snapshotForConformance(),
      ).publicationWork.pending[0]?.identity.generation).toBe(2n);

      yield* transitionState.applyAdmittedBatchAndAdvance(batch({
        sequence: 2n,
        dependencies: [dependency],
      }));
      const afterSecondInvalidation = requireState(
        yield* transitionState.snapshotForConformance(),
      );
      const secondDirtyThrough = afterSecondInvalidation.queries[0]?.active
        ?.dirtyThroughSequence;
      if (secondDirtyThrough === null || secondDirtyThrough === undefined) {
        return yield* Effect.die(new Error(
          "Expected generation two to be dirty",
        ));
      }
      const generationThreeBegin = yield* transitionState.beginQueryEvaluation({
        target: target({ descriptor: queryDescriptor }),
        expectedActiveGeneration: generationTwoBegin.attempt.generation,
        requestedDirtyThroughSequence: secondDirtyThrough,
      });
      if (generationThreeBegin._tag !== "created") {
        return yield* Effect.die(new Error(
          "Expected generation three evaluation",
        ));
      }
      const generationThreeEvaluation = evaluation({
        descriptor: queryDescriptor,
        generation: generationThreeBegin.attempt.generation,
        snapshot: 2n,
        dependencies: [dependency],
        resultSeed: 303,
      });
      const generationThreeRefresh = getSuccess(
        deriveGenerationRefreshEvidence(
          generationThreeEvaluation,
          generationThreeBegin.attempt.registrationCursor,
          [],
          generationThreeEvaluation.authorityWitness,
        ),
      );
      const generationThreePublication = publicationArtifact(
        "queued-replacement-generation-3",
      );
      const beforeRace = requireState(
        yield* transitionState.snapshotForConformance(),
      );
      const pureDeliveryFirst = getSuccess(completePublication(
        beforeRace,
        olderEvidence,
      ));
      const pureReplacementAfterDelivery = getSuccess(
        completeQueryEvaluation(
          pureDeliveryFirst.state,
          generationThreeBegin.attempt,
          generationThreeEvaluation,
          generationThreeRefresh,
          generationThreePublication,
        ),
      );
      const pureReplacementFirst = getSuccess(completeQueryEvaluation(
        beforeRace,
        generationThreeBegin.attempt,
        generationThreeEvaluation,
        generationThreeRefresh,
        generationThreePublication,
      ));
      const pureDeliveryAfterReplacement = getSuccess(completePublication(
        pureReplacementFirst.state,
        olderEvidence,
      ));
      const [deliveryReceipt, replacementReceipt] = yield* Effect.all([
        transitionState.completePublication(olderEvidence),
        transitionState.completeQueryEvaluation(
          generationThreeBegin.attempt,
          generationThreeEvaluation,
          generationThreeRefresh,
          generationThreePublication,
        ),
      ] as const, { concurrency: "unbounded" });
      const afterRace = requireState(
        yield* transitionState.snapshotForConformance(),
      );
      expect([
        {
          delivery: pureDeliveryFirst._tag,
          replacement: pureReplacementAfterDelivery._tag,
          state: pureReplacementAfterDelivery.state,
        },
        {
          delivery: pureDeliveryAfterReplacement._tag,
          replacement: pureReplacementFirst._tag,
          state: pureDeliveryAfterReplacement.state,
        },
      ]).toContainEqual({
        delivery: deliveryReceipt._tag,
        replacement: replacementReceipt._tag,
        state: afterRace,
      });
      expect(afterRace.publicationWork.inFlight).toBeNull();
      expect(afterRace.publicationWork.pending).toHaveLength(1);
      expect(afterRace.publicationWork.pending[0]?.identity.generation).toBe(3n);
    }).pipe(Effect.provide(TestClock.layer())));
  });

  it("serializes completion racing an exact-next invalidation to one of the two pure histories", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-completion-race",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );

    const dependency = canonicalText("completion-race-dependency");
    const begun = await runEffect(
      transitionState.beginQueryEvaluation(firstRegistrationRequest(target())),
    );
    if (begun._tag !== "created") {
      throw new Error("Expected the first begin receipt to be created");
    }
    const beforeRace = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    const queryEvaluation = evaluation({
      descriptor: begun.attempt.descriptor,
      generation: begun.attempt.generation,
      snapshot: begun.attempt.registrationCursor.appliedThroughSequence,
      dependencies: [dependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      begun.attempt.registrationCursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const publication = publicationArtifact("completion-race-publication");
    const admittedBatch = batch({
      sequence: 1n,
      dependencies: [dependency],
    });

    const completeFirst = getSuccess(completeQueryEvaluation(
      beforeRace,
      begun.attempt,
      queryEvaluation,
      refresh,
      publication,
    ));
    const applyAfterCompletion = getSuccess(applyAdmittedInvalidations(
      completeFirst.state,
      admittedBatch,
    ));
    const applyFirst = getSuccess(applyAdmittedInvalidations(
      beforeRace,
      admittedBatch,
    ));
    const completeAfterApply = getSuccess(completeQueryEvaluation(
      applyFirst.state,
      begun.attempt,
      queryEvaluation,
      refresh,
      publication,
    ));
    const pureHistories = [
      Object.freeze({
        completion: completeFirst._tag,
        invalidation: applyAfterCompletion._tag,
        state: applyAfterCompletion.state,
      }),
      Object.freeze({
        completion: completeAfterApply._tag,
        invalidation: applyFirst._tag,
        state: completeAfterApply.state,
      }),
    ] as const;
    expect(pureHistories[0].state).not.toEqual(pureHistories[1].state);

    const [completionReceipt, invalidationReceipt] = await runEffect(
      Effect.all([
        transitionState.completeQueryEvaluation(
          begun.attempt,
          queryEvaluation,
          refresh,
          publication,
        ),
        transitionState.applyAdmittedBatchAndAdvance(admittedBatch),
      ] as const, { concurrency: "unbounded" }),
    );
    const afterRace = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));

    expect(pureHistories).toContainEqual({
      completion: completionReceipt._tag,
      invalidation: invalidationReceipt._tag,
      state: afterRace,
    });
  });

  it("does not let returned-receipt mutation reach the stored aggregate", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-receipt-isolation",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    const begun = await runEffect(
      transitionState.beginQueryEvaluation(firstRegistrationRequest(target())),
    );
    if (begun._tag !== "created") {
      throw new Error("Expected the first begin receipt to be created");
    }
    const beforeMutation = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));

    expect(Reflect.set(
      begun.attempt.descriptor,
      "queryIdentity",
      canonicalText("mutated-query-identity"),
    )).toBe(false);
    expect(Reflect.set(
      begun.attempt.registrationCursor,
      "appliedThroughSequence",
      99n,
    )).toBe(false);

    const afterMutation = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(afterMutation).toBe(beforeMutation);
    expect(afterMutation.queries[0]?.descriptor).toEqual(
      beforeMutation.queries[0]?.descriptor,
    );
    expect(afterMutation.cursor.appliedThroughSequence).toBe(0n);
  });

  it("matches the explicit pure oracle for repeated deterministic seeded schedules", async () => {
    const seeds = [
      0x0102_0304,
      0x1020_3040,
      0x5f37_59df,
      0x89ab_cdef,
      0xfedc_ba98,
      0x7fff_ffff,
    ] as const;

    for (const seed of seeds) {
      const commands = makeSeededCommands(seed);
      expect(makeSeededCommands(seed)).toEqual(commands);

      const bootstrapCursor = cursor();
      const harness = await runEffect(makeReferenceQuerySyncStateHarness());
      const transitionState = harness.bind(bindingFor(
        `physical-namespace-seeded-${seed}`,
        bootstrapCursor,
      ));
      const steps = await runEffect(runStateConformanceCommands(
        transitionState,
        {
          initialExpectedState: null,
          commands,
        },
      ));

      expect(steps).toHaveLength(commands.length);
      for (const step of steps) {
        expect(step.outcome).toEqual(step.expectedOutcome);
        expect(step.snapshot).toEqual(step.expectedSnapshot);
      }
    }
  });
});
