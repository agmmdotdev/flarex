import { Deferred, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  makeAdmittedChangeSource,
  MAX_MODEL_SEMANTIC_BYTES,
  MAX_MODEL_SEMANTIC_WORK_UNITS,
  MAX_PROJECTED_CANONICAL_BYTES,
  MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  MAX_SOURCE_PAGE_BATCHES,
  MAX_SOURCE_TRANSPORT_BYTES,
} from "@flarex/query-sync/internal/change";
import type {
  AdmittedChangePage,
  AdmittedChangeSource,
  ChangeReadBudget,
  ChangeSourceReadRequest,
} from "@flarex/query-sync/internal/change";
import { ChangeSourceUnavailableError } from "@flarex/query-sync/internal/change";
import type {
  NamespaceCursor,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  InvalidNamespaceQuerySyncPolicyError,
  InvalidQuerySyncTurnBudgetError,
  makeNamespaceQuerySync,
} from "@flarex/query-sync/internal/orchestration";
import type {
  CatchUpTurnBudget,
  NamespaceQuerySyncPolicy,
  QueryEvaluator,
} from "@flarex/query-sync/internal/orchestration";
import {
  QuerySyncStateContentionError,
  QuerySyncStateUnavailableError,
} from "@flarex/query-sync/internal/state";
import type { QuerySyncTransitionState } from "@flarex/query-sync/internal/state";
import {
  captureKeyValueAuthorityObservation,
  captureKeyValueCommittedPayload,
  makeKeyValueInvalidationProjector,
  makeReferenceQueryEvaluator,
  makeReferenceQuerySyncStateHarness,
  makeReferenceReplayableChangeSource,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceQuerySyncTransitionState,
} from "@flarex/query-sync/testing/conformance";

import { cursor, getSuccess } from "./fixtures.js";
import { runEffect } from "./effectBoundary.js";

const RETRY_DELAYS: readonly [number, number] = Object.freeze([0, 0]);

const POLICY: NamespaceQuerySyncPolicy = Object.freeze({
  stateAttemptsPerOperation: 3,
  sourceAttemptsPerRead: 3,
  retryDelayMilliseconds: RETRY_DELAYS,
  settlementReserveMilliseconds: 1,
});

const BUDGET: CatchUpTurnBudget = Object.freeze({
  sourceReads: 32,
  admittedBatches: 4_096,
  sourceTransportBytes: 16 * 1_024 * 1_024,
  modelSemanticWorkUnits: 65_536,
  modelSemanticBytes: 16 * 1_024 * 1_024,
  dependencyKeyExaminations: 65_536,
  canonicalDependencyBytes: 16 * 1_024 * 1_024,
  newWorkWindowMilliseconds: 1_000,
});

const HARD_READ_BUDGET: ChangeReadBudget = Object.freeze({
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

async function buildSource(
  binding: NamespaceCursor,
  batchCount: number,
  transportBytes = 1,
): Promise<AdmittedChangeSource> {
  return buildSourceWindow(binding, {
    replayableAfterSequenceExclusive: 0n,
    observedLatestSequence: BigInt(batchCount),
    batchSequences: Array.from(
      { length: batchCount },
      (_, index) => BigInt(index + 1),
    ),
    transportBytes,
  });
}

async function buildSourceWindow(
  binding: NamespaceCursor,
  input: Readonly<{
    replayableAfterSequenceExclusive: bigint;
    observedLatestSequence: bigint;
    batchSequences: readonly bigint[];
    transportBytes?: number;
  }>,
): Promise<AdmittedChangeSource> {
  const batches = input.batchSequences.map((sourceSequence) => ({
    sourceSequence: sequence(sourceSequence),
    payload: { changes: [] },
    transportBytes: input.transportBytes ?? 1,
  }));
  const source = await runEffect(makeReferenceReplayableChangeSource({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    replayableAfterSequenceExclusive: sequence(
      input.replayableAfterSequenceExclusive,
    ),
    observedLatestSequence: sequence(input.observedLatestSequence),
    batches,
    authorityObservation: {
      revision: batches.length,
      partitions: ["primary"],
    },
    authorityTransportBytes: 1,
  }, {
    capturePayload: captureKeyValueCommittedPayload,
    captureAuthorityObservation: captureKeyValueAuthorityObservation,
  }));
  return makeAdmittedChangeSource(
    source,
    makeKeyValueInvalidationProjector(binding.syncModelId),
  );
}

async function readReferencePage(
  source: AdmittedChangeSource,
  binding: NamespaceCursor,
  requestedAfterSequenceExclusive: bigint,
): Promise<AdmittedChangePage> {
  const read = await runEffect(source.readAfter({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    requestedAfterSequenceExclusive: sequence(
      requestedAfterSequenceExclusive,
    ),
  }, HARD_READ_BUDGET));
  if (read._tag !== "page") {
    throw new Error(`Expected a reference page, received ${read._tag}`);
  }
  return read;
}

function replayReferencePage(page: AdmittedChangePage): AdmittedChangeSource {
  return Object.freeze({
    readAfter: () => Effect.succeed(page),
  });
}

async function buildState(
  binding: NamespaceCursor,
): Promise<ReferenceQuerySyncTransitionState> {
  const harness = await runEffect(makeReferenceQuerySyncStateHarness());
  return harness.bind({
    physicalNamespaceId: `physical-${binding.namespaceId}`,
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
  });
}

async function unusedEvaluator(): Promise<QueryEvaluator> {
  return runEffect(makeReferenceQueryEvaluator([]));
}

const CATCH_UP_BOUNDARY_CASES = [
  { scenario: "gap", name: "sequence gap" },
  { scenario: "historyUnavailable", name: "history loss" },
  { scenario: "modelReplaced", name: "state model replacement" },
  { scenario: "sourceEpochReplaced", name: "source epoch replacement" },
  { scenario: "stateEpochReplaced", name: "state epoch replacement" },
  { scenario: "resetRequired", name: "apply epoch reset" },
] as const;

const ATOMIC_FAULT_TIMINGS = [
  { timing: "beforeSwap", recovery: "retry before commit" },
  { timing: "afterSwap", recovery: "replay after unknown commit" },
] as const;

type CatchUpBoundaryScenario =
  typeof CATCH_UP_BOUNDARY_CASES[number]["scenario"];

interface CatchUpBoundaryFixture {
  readonly binding: NamespaceCursor;
  readonly source: AdmittedChangeSource;
  readonly state: QuerySyncTransitionState;
  readonly expected: Readonly<Record<string, unknown>>;
}

async function arrangeCatchUpBoundary(
  scenario: CatchUpBoundaryScenario,
): Promise<CatchUpBoundaryFixture> {
  switch (scenario) {
    case "gap": {
      const binding = cursor();
      const referenceSource = await buildSource(binding, 2);
      const secondBatchPage = await readReferencePage(
        referenceSource,
        binding,
        1n,
      );
      return {
        binding,
        source: replayReferencePage(secondBatchPage),
        state: await buildState(binding),
        expected: {
          _tag: "gap",
          phase: "initialCatchUp",
          expectedSequence: 1n,
          observedSequence: 2n,
          progress: {
            sourceCalls: 1,
            admittedBatches: 1,
            settledBatchTransitions: 1,
          },
        },
      };
    }
    case "historyUnavailable": {
      const binding = cursor();
      return {
        binding,
        source: await buildSourceWindow(binding, {
          replayableAfterSequenceExclusive: 1n,
          observedLatestSequence: 1n,
          batchSequences: [],
        }),
        state: await buildState(binding),
        expected: {
          _tag: "historyUnavailable",
          phase: "initialCatchUp",
          evidence: {
            reason: "requestedCursorBeforeReplayableHistory",
            requestedCursor: { appliedThroughSequence: 0n },
            replayableAfterSequenceExclusive: 1n,
          },
          progress: { sourceCalls: 1, admittedBatches: 0 },
        },
      };
    }
    case "modelReplaced": {
      const existingCursor = cursor({ sequence: 3n });
      const binding = cursor({ syncModelId: "graph" });
      const harness = await runEffect(makeReferenceQuerySyncStateHarness());
      const physicalNamespaceId = "physical-model-replacement";
      const existingState = harness.bind({
        physicalNamespaceId,
        namespaceId: existingCursor.namespaceId,
        syncModelId: existingCursor.syncModelId,
        sourceEpoch: existingCursor.sourceEpoch,
      });
      await runEffect(existingState.initializeOrInspectNamespace(
        existingCursor,
      ));
      return {
        binding,
        source: await buildSource(binding, 0),
        state: harness.bind({
          physicalNamespaceId,
          namespaceId: binding.namespaceId,
          syncModelId: binding.syncModelId,
          sourceEpoch: binding.sourceEpoch,
        }),
        expected: {
          _tag: "modelReplaced",
          phase: "initialCatchUp",
          existingCursor,
          requestedSyncModelId: binding.syncModelId,
          progress: { sourceCalls: 0 },
        },
      };
    }
    case "sourceEpochReplaced": {
      const binding = cursor({ sourceEpoch: "epoch-b" });
      const sourceBinding = cursor({ sourceEpoch: "epoch-a" });
      return {
        binding,
        source: await buildSource(sourceBinding, 0),
        state: await buildState(binding),
        expected: {
          _tag: "epochReplaced",
          phase: "initialCatchUp",
          evidence: {
            source: "changeSource",
            value: {
              currentSourceEpoch: sourceBinding.sourceEpoch,
              reason: "sourceEpochChanged",
            },
          },
          progress: { sourceCalls: 1 },
        },
      };
    }
    case "stateEpochReplaced": {
      const existingCursor = cursor({ sequence: 3n });
      const binding = cursor({ sourceEpoch: "epoch-b" });
      const harness = await runEffect(makeReferenceQuerySyncStateHarness());
      const physicalNamespaceId = "physical-epoch-replacement";
      const existingState = harness.bind({
        physicalNamespaceId,
        namespaceId: existingCursor.namespaceId,
        syncModelId: existingCursor.syncModelId,
        sourceEpoch: existingCursor.sourceEpoch,
      });
      await runEffect(existingState.initializeOrInspectNamespace(
        existingCursor,
      ));
      return {
        binding,
        source: await buildSource(binding, 0),
        state: harness.bind({
          physicalNamespaceId,
          namespaceId: binding.namespaceId,
          syncModelId: binding.syncModelId,
          sourceEpoch: binding.sourceEpoch,
        }),
        expected: {
          _tag: "epochReplaced",
          phase: "initialCatchUp",
          evidence: {
            source: "state",
            existingCursor,
            requestedSourceEpoch: binding.sourceEpoch,
          },
          progress: { sourceCalls: 0 },
        },
      };
    }
    case "resetRequired": {
      const binding = cursor();
      const replacementBinding = cursor({ sourceEpoch: "epoch-b" });
      const replacementSource = await buildSource(replacementBinding, 1);
      const replacementPage = await readReferencePage(
        replacementSource,
        replacementBinding,
        0n,
      );
      return {
        binding,
        source: replayReferencePage(replacementPage),
        state: await buildState(binding),
        expected: {
          _tag: "resetRequired",
          phase: "initialCatchUp",
          expectedSourceEpoch: binding.sourceEpoch,
          observedSourceEpoch: replacementBinding.sourceEpoch,
          progress: {
            sourceCalls: 1,
            admittedBatches: 1,
            settledBatchTransitions: 1,
          },
        },
      };
    }
  }
}

describe("bounded query-sync catch-up orchestration", () => {
  it("captures policy and budget values in exact field order", async () => {
    const binding = cursor();
    const source = await buildSource(binding, 0);
    const state = await buildState(binding);
    const evaluator = await unusedEvaluator();

    const invalidPolicy = makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state,
      evaluator,
      policy: { ...POLICY, stateAttemptsPerOperation: 0 },
    });
    expect(Result.isFailure(invalidPolicy)).toBe(true);
    if (Result.isFailure(invalidPolicy)) {
      expect(invalidPolicy.failure).toEqual(
        new InvalidNamespaceQuerySyncPolicyError({
          operation: "makeNamespaceQuerySync",
          field: "stateAttemptsPerOperation",
          reason: "invalidValue",
        }),
      );
    }

    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state,
      evaluator,
      policy: POLICY,
    }));
    const invalidBudget = await runEffect(Effect.flip(sync.catchUp({
      ...BUDGET,
      sourceReads: 0,
      admittedBatches: 0,
    })));
    expect(invalidBudget).toEqual(new InvalidQuerySyncTurnBudgetError({
      operation: "catchUp",
      field: "sourceReads",
      reason: "invalidValue",
      observed: 0,
    }));

    for (const observed of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const failure = await runEffect(Effect.flip(sync.catchUp({
        ...BUDGET,
        sourceReads: observed,
      })));
      expect(failure).toMatchObject({
        _tag: "InvalidQuerySyncTurnBudgetError",
        field: "sourceReads",
        reason: "invalidValue",
      });
    }
    const reserveFailure = await runEffect(Effect.flip(sync.catchUp({
      ...BUDGET,
      newWorkWindowMilliseconds: 1,
    })));
    expect(reserveFailure).toMatchObject({
      field: "newWorkWindowMilliseconds",
      reason: "notGreaterThanSettlementReserve",
    });
  });

  it("accepts an empty final page only after durable reinspection", async () => {
    const binding = cursor();
    const source = await buildSource(binding, 0);
    const state = await buildState(binding);
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state,
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));

    const outcome = await runEffect(sync.catchUp(BUDGET));
    expect(outcome).toMatchObject({
      _tag: "caughtUp",
      cursor: { appliedThroughSequence: 0n },
      progress: {
        sourceCalls: 1,
        admittedBatches: 0,
        settledBatchTransitions: 0,
      },
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.progress)).toBe(true);
  });

  it("rereads from a competing durable advance before declaring caught up", async () => {
    const binding = cursor();
    const staleSource = await buildSource(binding, 0);
    const currentSource = await buildSource(binding, 1);
    const state = await buildState(binding);
    const currentRead = await runEffect(currentSource.readAfter({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
    }, HARD_READ_BUDGET));
    const competingBatch = currentRead._tag === "page"
      ? currentRead.batches[0]
      : undefined;
    if (competingBatch === undefined) {
      throw new Error("Expected the competing batch in the test fixture");
    }
    const requests: ChangeSourceReadRequest[] = [];
    const source: AdmittedChangeSource = Object.freeze({
      readAfter: (
        request: ChangeSourceReadRequest,
        budget: ChangeReadBudget,
      ) => {
        requests.push(request);
        if (requests.length !== 1) {
          return currentSource.readAfter(request, budget);
        }
        return staleSource.readAfter(request, budget).pipe(
          Effect.flatMap((read) => state.applyAdmittedBatchAndAdvance(
            competingBatch,
          ).pipe(Effect.orDie, Effect.as(read))),
        );
      },
    });
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state,
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));

    const outcome = await runEffect(sync.catchUp(BUDGET));
    expect(outcome).toMatchObject({
      _tag: "caughtUp",
      cursor: { appliedThroughSequence: 1n },
      authority: { readThroughSequence: 1n },
      progress: { sourceCalls: 2 },
    });
    expect(requests.map((request) => (
      request.requestedAfterSequenceExclusive
    ))).toEqual([sequence(0n), sequence(1n)]);
  });

  it.each(CATCH_UP_BOUNDARY_CASES)(
    "returns the exact $name boundary evidence",
    async ({ scenario }) => {
      const fixture = await arrangeCatchUpBoundary(scenario);
      const sync = getSuccess(makeNamespaceQuerySync({
        bootstrapCursor: fixture.binding,
        source: fixture.source,
        state: fixture.state,
        evaluator: await unusedEvaluator(),
        policy: POLICY,
      }));

      const outcome = await runEffect(sync.catchUp(BUDGET));
      expect(outcome).toMatchObject(fixture.expected);
    },
  );

  it("charges and applies exactly 4,096 batches before refusing 4,097", async () => {
    const binding = cursor();
    const source = await buildSource(binding, 4_097);
    const state = await buildState(binding);
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state,
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));

    const outcome = await runEffect(sync.catchUp(BUDGET));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "admittedBatchLimitReached",
      progress: {
        admittedBatches: 4_096,
        settledBatchTransitions: 4_096,
        lastDurableCursor: { appliedThroughSequence: 4_096n },
      },
    });
    const snapshot = await runEffect(state.snapshotForConformance());
    expect(snapshot?.cursor.appliedThroughSequence).toBe(4_096n);
  }, 30_000);

  it.each(ATOMIC_FAULT_TIMINGS)(
    "recovers initializeOrInspectNamespace by $recovery",
    async ({ timing }) => {
      const binding = cursor();
      const state = await buildState(binding);
      let initializeCalls = 0;
      const countedState: QuerySyncTransitionState = Object.freeze({
        ...state,
        initializeOrInspectNamespace: (bootstrap: NamespaceCursor) => {
          initializeCalls += 1;
          return state.initializeOrInspectNamespace(bootstrap);
        },
      });
      await runEffect(state.injectNextFault({
        operation: "initializeOrInspectNamespace",
        timing,
      }));
      const sync = getSuccess(makeNamespaceQuerySync({
        bootstrapCursor: binding,
        source: await buildSource(binding, 0),
        state: countedState,
        evaluator: await unusedEvaluator(),
        policy: POLICY,
      }));

      const outcome = await runEffect(sync.catchUp(BUDGET));
      expect(outcome).toMatchObject({
        _tag: "caughtUp",
        cursor: { appliedThroughSequence: 0n },
        progress: {
          sourceCalls: 1,
          admittedBatches: 0,
          settledBatchTransitions: 0,
        },
      });
      expect(initializeCalls).toBe(3);
      expect(await runEffect(state.snapshotForConformance())).toMatchObject({
        cursor: { appliedThroughSequence: 0n },
      });
    },
  );

  it.each(ATOMIC_FAULT_TIMINGS)(
    "recovers applyAdmittedBatchAndAdvance by $recovery",
    async ({ timing }) => {
      const binding = cursor();
      const source = await buildSource(binding, 1);
      const state = await buildState(binding);
      let applyCalls = 0;
      const countedState: QuerySyncTransitionState = Object.freeze({
        ...state,
        applyAdmittedBatchAndAdvance: (
          batch: Parameters<
            QuerySyncTransitionState["applyAdmittedBatchAndAdvance"]
          >[0],
        ) => {
          applyCalls += 1;
          return state.applyAdmittedBatchAndAdvance(batch);
        },
      });
      await runEffect(state.injectNextFault({
        operation: "applyAdmittedBatchAndAdvance",
        timing,
      }));
      const sync = getSuccess(makeNamespaceQuerySync({
        bootstrapCursor: binding,
        source,
        state: countedState,
        evaluator: await unusedEvaluator(),
        policy: POLICY,
      }));

      const outcome = await runEffect(sync.catchUp(BUDGET));
      expect(outcome).toMatchObject({
        _tag: "caughtUp",
        cursor: { appliedThroughSequence: 1n },
        progress: {
          admittedBatches: 1,
          settledBatchTransitions: 1,
        },
      });
      expect(applyCalls).toBe(2);
      expect(await runEffect(state.snapshotForConformance())).toMatchObject({
        cursor: { appliedThroughSequence: 1n },
      });
    },
  );

  it("does not reset the attempt cap when retryable state error tags change", async () => {
    const binding = cursor();
    const state = await buildState(binding);
    let calls = 0;
    const alternatingState: QuerySyncTransitionState = Object.freeze({
      ...state,
      initializeOrInspectNamespace: () => {
        calls += 1;
        return calls === 1
          ? Effect.fail(new QuerySyncStateUnavailableError({
            operation: "initializeOrInspectNamespace",
            commitCertainty: "notCommitted",
            reason: "temporarilyUnavailable",
            cause: null,
          }))
          : Effect.fail(new QuerySyncStateContentionError({
            operation: "initializeOrInspectNamespace",
            commitCertainty: "notCommitted",
            reason: "serializationRetriesExhausted",
            cause: null,
          }));
      },
    });
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source: await buildSource(binding, 0),
      state: alternatingState,
      evaluator: await unusedEvaluator(),
      policy: { ...POLICY, stateAttemptsPerOperation: 2 },
    }));

    const failure = await runEffect(Effect.flip(sync.catchUp(BUDGET)));
    expect(failure).toMatchObject({
      _tag: "QuerySyncStateContentionError",
      operation: "initializeOrInspectNamespace",
    });
    expect(calls).toBe(2);
  });

  it("retries one unavailable source call with the identical request", async () => {
    const binding = cursor();
    const delegate = await buildSource(binding, 0);
    const requests: object[] = [];
    const budgets: object[] = [];
    let calls = 0;
    const source: AdmittedChangeSource = Object.freeze({
      readAfter: (
        request: ChangeSourceReadRequest,
        budget: ChangeReadBudget,
      ) => {
        calls += 1;
        requests.push(request);
        budgets.push(budget);
        return calls === 1
          ? Effect.fail(new ChangeSourceUnavailableError({
            operation: "readAfter",
            reason: "temporarilyUnavailable",
          }))
          : delegate.readAfter(request, budget);
      },
    });
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state: await buildState(binding),
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));

    const outcome = await runEffect(sync.catchUp(BUDGET));
    expect(outcome._tag).toBe("caughtUp");
    expect(outcome.progress.sourceCalls).toBe(2);
    expect(requests[0]).toBe(requests[1]);
    expect(budgets[0]).toBe(budgets[1]);
  });

  it("propagates source exhaustion after the exact configured attempts", async () => {
    const binding = cursor();
    let calls = 0;
    const source: AdmittedChangeSource = Object.freeze({
      readAfter: () => {
        calls += 1;
        return Effect.fail(new ChangeSourceUnavailableError({
          operation: "readAfter",
          reason: "temporarilyUnavailable",
        }));
      },
    });
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state: await buildState(binding),
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));

    const failure = await runEffect(Effect.flip(sync.catchUp(BUDGET)));
    expect(failure).toMatchObject({
      _tag: "ChangeSourceUnavailableError",
      operation: "readAfter",
      reason: "temporarilyUnavailable",
    });
    expect(calls).toBe(3);
  });

  it("admits a retry delay that leaves exactly one millisecond", async () => {
    const binding = cursor();
    const delegate = await buildSource(binding, 0);
    const entered = await runEffect(Deferred.make<void>());
    let calls = 0;
    const source: AdmittedChangeSource = Object.freeze({
      readAfter: (
        request: ChangeSourceReadRequest,
        budget: ChangeReadBudget,
      ) => {
        calls += 1;
        if (calls === 1) {
          return Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.fail(new ChangeSourceUnavailableError({
              operation: "readAfter",
              reason: "temporarilyUnavailable",
            }))),
          );
        }
        return delegate.readAfter(request, budget);
      },
    });
    const delayPair: readonly [number, number] = Object.freeze([8, 0]);
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state: await buildState(binding),
      evaluator: await unusedEvaluator(),
      policy: { ...POLICY, retryDelayMilliseconds: delayPair },
    }));

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const fiber = yield* Effect.forkChild(sync.catchUp({
        ...BUDGET,
        newWorkWindowMilliseconds: 10,
      }));
      yield* Deferred.await(entered);
      yield* TestClock.adjust("8 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome._tag).toBe("caughtUp");
    expect(calls).toBe(2);
  });

  it("refuses a retry delay ending at the exact admission cutoff", async () => {
    const binding = cursor();
    let calls = 0;
    const source: AdmittedChangeSource = Object.freeze({
      readAfter: () => {
        calls += 1;
        return Effect.fail(new ChangeSourceUnavailableError({
          operation: "readAfter",
          reason: "temporarilyUnavailable",
        }));
      },
    });
    const delayPair: readonly [number, number] = Object.freeze([9, 0]);
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state: await buildState(binding),
      evaluator: await unusedEvaluator(),
      policy: { ...POLICY, retryDelayMilliseconds: delayPair },
    }));

    const failure = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* Effect.flip(sync.catchUp({
        ...BUDGET,
        newWorkWindowMilliseconds: 10,
      }));
    }).pipe(Effect.provide(TestClock.layer())));
    expect(failure._tag).toBe("ChangeSourceUnavailableError");
    expect(calls).toBe(1);
  });

  it("returns indivisible source shortfall without widening its budget", async () => {
    const binding = cursor();
    const source = await buildSource(binding, 1, 10);
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state: await buildState(binding),
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));
    const outcome = await runEffect(sync.catchUp({
      ...BUDGET,
      sourceTransportBytes: 1,
    }));
    expect(outcome).toMatchObject({
      _tag: "budgetInsufficient",
      evidence: {
        dimension: "sourceTransportBytes",
        provided: 1,
      },
      progress: { sourceCalls: 1, sourceTransportBytes: 0 },
    });
  });

  it("admits no source call at cutoff equality", async () => {
    const binding = cursor();
    const source = await buildSource(binding, 0);
    const state = await buildState(binding);
    let sourceCalls = 0;
    const countedSource: AdmittedChangeSource = Object.freeze({
      readAfter: (
        request: ChangeSourceReadRequest,
        budget: ChangeReadBudget,
      ) => {
        sourceCalls += 1;
        return source.readAfter(request, budget);
      },
    });
    const advancedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      initializeOrInspectNamespace: (bootstrap: NamespaceCursor) =>
        state.initializeOrInspectNamespace(bootstrap).pipe(
          Effect.tap(() => TestClock.adjust("9 millis")),
        ),
    });
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source: countedSource,
      state: advancedState,
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.catchUp({
        ...BUDGET,
        newWorkWindowMilliseconds: 10,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "deadlineReached",
      progress: { sourceCalls: 0 },
    });
    expect(sourceCalls).toBe(0);
  });

  it("awaits a source call admitted before the cutoff", async () => {
    const binding = cursor();
    const delegate = await buildSource(binding, 0);
    const source: AdmittedChangeSource = Object.freeze({
      readAfter: (
        request: ChangeSourceReadRequest,
        budget: ChangeReadBudget,
      ) => delegate.readAfter(request, budget).pipe(
        Effect.tap(() => TestClock.adjust("10 millis")),
      ),
    });
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state: await buildState(binding),
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* sync.catchUp({
        ...BUDGET,
        newWorkWindowMilliseconds: 10,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      reason: "deadlineReached",
      progress: { sourceCalls: 1 },
    });
  });

  it("keeps the per-read hard budget at or below the admitted-source limits", async () => {
    const binding = cursor();
    const delegate = await buildSource(binding, 0);
    let observed: ChangeReadBudget | null = null;
    const source: AdmittedChangeSource = Object.freeze({
      readAfter: (
        request: ChangeSourceReadRequest,
        budget: ChangeReadBudget,
      ) => {
        observed = budget;
        return delegate.readAfter(request, budget);
      },
    });
    const sync = getSuccess(makeNamespaceQuerySync({
      bootstrapCursor: binding,
      source,
      state: await buildState(binding),
      evaluator: await unusedEvaluator(),
      policy: POLICY,
    }));
    await runEffect(sync.catchUp(BUDGET));
    expect(observed).toEqual(HARD_READ_BUDGET);
  });
});
