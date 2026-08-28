import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  completeQueryGeneration,
  MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
  QueryKeyCollisionError,
  QuerySyncWorkLimitError,
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
    throw new Error("Expected an initialized reference state");
  }
  return state;
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
    _tag: "beginQueryGeneration",
    target: queryTarget,
  });
  if (nextRandom() % 2 === 0) {
    commands.push({
      _tag: "beginQueryGeneration",
      target: queryTarget,
    });
  }

  const firstSnapshot = BigInt(prefixCount);
  const firstEvaluation = evaluation({
    descriptor: queryDescriptor,
    generation: 1n,
    snapshot: firstSnapshot,
    dependencies: [dependency],
    resultSeed: nextRandom(),
    witnessSeed: nextRandom(),
  });
  commands.push({
    _tag: "completeQueryGeneration",
    evaluation: firstEvaluation,
    refresh: getSuccess(deriveGenerationRefreshEvidence(
      firstEvaluation,
      cursor({ sequence: firstSnapshot }),
      [],
      firstEvaluation.authorityWitness,
    )),
  });

  const tailCount = 1 + (nextRandom() % 3);
  for (let offset = 1; offset <= tailCount; offset += 1) {
    const sequence = BigInt(prefixCount + offset);
    const admitted = batch({
      sequence,
      dependencies: nextRandom() % 2 === 0 ? [dependency] : [],
    });
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
  commands.push({
    _tag: "beginQueryGeneration",
    target: queryTarget,
  });
  const secondEvaluation = evaluation({
    descriptor: queryDescriptor,
    generation: 2n,
    snapshot: secondSnapshot,
    dependencies: nextRandom() % 2 === 0 ? [dependency] : [],
    resultSeed: nextRandom(),
    witnessSeed: nextRandom(),
  });
  commands.push({
    _tag: "completeQueryGeneration",
    evaluation: secondEvaluation,
    refresh: getSuccess(deriveGenerationRefreshEvidence(
      secondEvaluation,
      cursor({ sequence: secondSnapshot }),
      [],
      secondEvaluation.authorityWitness,
    )),
  });

  return Object.freeze(commands);
}

describe("reference transition-state extended conformance", () => {
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
    await runEffect(transitionState.beginQueryGeneration(target({
      descriptor: storedDescriptor,
    })));
    const beforeCollision = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));

    const failure = await runEffectFailure(
      transitionState.beginQueryGeneration(target({
        descriptor: descriptor({
          keySeed: 701,
          identity: "conflicting-query-identity",
        }),
      })),
    );

    expect(failure).toBeInstanceOf(QueryKeyCollisionError);
    expect(failure).toMatchObject({
      operation: "beginQueryGeneration",
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
            _tag: "beginQueryGeneration",
            target: target({ descriptor: storedDescriptor }),
          },
          {
            _tag: "beginQueryGeneration",
            target: conflictingTarget,
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
      transitionState.beginQueryGeneration(target()),
    );
    const beforeRace = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    const queryEvaluation = evaluation({
      descriptor: begun.descriptor,
      generation: begun.generation,
      snapshot: begun.registrationCursor.appliedThroughSequence,
      dependencies: [dependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      begun.registrationCursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const admittedBatch = batch({
      sequence: 1n,
      dependencies: [dependency],
    });

    const completeFirst = getSuccess(completeQueryGeneration(
      beforeRace,
      queryEvaluation,
      refresh,
    ));
    const applyAfterCompletion = getSuccess(applyAdmittedInvalidations(
      completeFirst.state,
      admittedBatch,
    ));
    const applyFirst = getSuccess(applyAdmittedInvalidations(
      beforeRace,
      admittedBatch,
    ));
    const completeAfterApply = getSuccess(completeQueryGeneration(
      applyFirst.state,
      queryEvaluation,
      refresh,
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
        transitionState.completeQueryGeneration(queryEvaluation, refresh),
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
      transitionState.beginQueryGeneration(target()),
    );
    if (begun._tag !== "created") {
      throw new Error("Expected the first begin receipt to be created");
    }
    const beforeMutation = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));

    expect(Reflect.set(
      begun.descriptor,
      "queryIdentity",
      canonicalText("mutated-query-identity"),
    )).toBe(false);
    expect(Reflect.set(
      begun.registrationCursor,
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
