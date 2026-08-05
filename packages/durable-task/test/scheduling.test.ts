import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { projectRunAttemptStateV1 } from "../src/runAttempt/Model.js";
import { RunAttemptLifecycleLive } from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { RunAttemptLifecycle } from "../src/runAttempt/Services/RunAttemptLifecycle.js";
import type { RunAttemptLifecycleShape } from "../src/runAttempt/Services/RunAttemptLifecycle.js";
import type {
  TaskDueDiscoveryCandidateV1,
  TaskDueDiscoveryCursorV1,
  TaskDueDiscoveryPageV1,
} from "../src/runRead/Model.js";
import {
  InvalidTaskWakeSchedulerRunRequestError,
  TaskDueCandidateLifecycleContractError,
  TaskWakeSchedulerHandlerContractError,
  TaskWakeSchedulerSourceContractError,
  makeRunAttemptDueCandidateHandlerV1,
  makeTaskWakeSchedulerV1,
  type TaskDueCandidateHandlingReceiptV1,
  type TaskDueWorkSourceV1,
} from "../src/scheduling/v1.js";
import {
  makeFixedTaskRetryJitterSourceV1,
  makeInMemoryTaskDueWorkSourceV1,
  makeRecordingTaskDueCandidateHandlerV1,
} from "../src/scheduling/testing-v1.js";
import {
  ATTEMPT_ID,
  FENCE_1,
  JITTER,
  LEASE_VERSION_1,
  NOW,
  RUN_VERSION_1,
  RUN_VERSION_2,
  databaseTime,
  runId,
  runVersion,
  readyAggregate,
  createDeterministicRunAttemptStore,
} from "./support.js";

const RUN_1 = runId("run_00000000-0000-4000-8000-000000000001");
const RUN_2 = runId("run_00000000-0000-4000-8000-000000000002");
const RUN_3 = runId("run_00000000-0000-4000-8000-000000000003");
const RUN_4 = runId("run_00000000-0000-4000-8000-000000000004");
const RUN_5 = runId("run_00000000-0000-4000-8000-000000000005");
const THROUGH = databaseTime(100);

describe("TaskWakeSchedulerV1", () => {
  it("processes stable pages sequentially through the standard memory adapters", async () => {
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [
        startCandidate(RUN_5, 50),
        startCandidate(RUN_2, 20),
        startCandidate(RUN_4, 40),
        startCandidate(RUN_1, 10),
        startCandidate(RUN_3, 30),
      ],
    });
    const handler = recordingSuccessHandler();
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(source, handler, {
      pageSize: 2,
      maximumPages: 3,
      maximumCandidates: 10,
    }));

    const receipt = await runTestEffect(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));

    expect(receipt).toMatchObject({
      stopReason: "source_exhausted",
      pagesRead: 3,
      candidatesHandled: 5,
      continuation: null,
    });
    expect(receipt.handled.map(({ runId }) => runId)).toEqual([
      RUN_1,
      RUN_2,
      RUN_3,
      RUN_4,
      RUN_5,
    ]);
    expect(source.requests()).toHaveLength(3);
    expect(handler.handledCandidates().map(({ runId }) => runId)).toEqual([
      RUN_1,
      RUN_2,
      RUN_3,
      RUN_4,
      RUN_5,
    ]);
  });

  it("returns a mid-page continuation at the candidate budget and resumes without loss", async () => {
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [RUN_1, RUN_2, RUN_3, RUN_4, RUN_5].map((id, index) =>
        startCandidate(id, index + 1)
      ),
    });
    const handler = recordingSuccessHandler();
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(source, handler, {
      pageSize: 5,
      maximumPages: 2,
      maximumCandidates: 3,
    }));

    const first = await runTestEffect(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));
    expect(first).toMatchObject({
      stopReason: "candidate_budget",
      pagesRead: 1,
      candidatesHandled: 3,
      continuation: { runId: RUN_3, dueAtMs: 3, throughMs: THROUGH },
    });

    const second = await runTestEffect(scheduler.run({
      dueKind: "start_attempt",
      cursor: first.continuation,
    }));
    expect(second).toMatchObject({
      stopReason: "source_exhausted",
      pagesRead: 1,
      candidatesHandled: 2,
      continuation: null,
    });
    expect(handler.handledCandidates().map(({ runId }) => runId)).toEqual([
      RUN_1,
      RUN_2,
      RUN_3,
      RUN_4,
      RUN_5,
    ]);
  });

  it("stops at the page budget and preserves the source continuation", async () => {
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [RUN_1, RUN_2, RUN_3].map((id, index) =>
        startCandidate(id, index + 1)
      ),
    });
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      recordingSuccessHandler(),
      { pageSize: 2, maximumPages: 1, maximumCandidates: 10 },
    ));

    const receipt = await runTestEffect(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));
    expect(receipt).toMatchObject({
      stopReason: "page_budget",
      pagesRead: 1,
      candidatesHandled: 2,
      continuation: { runId: RUN_2, dueAtMs: 2, throughMs: THROUGH },
    });
  });

  it("preserves the exact handler failure and stops after the first failed candidate", async () => {
    const failure = Object.freeze({ _tag: "InjectedHandlerFailure" as const });
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [startCandidate(RUN_1, 1), startCandidate(RUN_2, 2)],
    });
    const handler = makeRecordingTaskDueCandidateHandlerV1((candidate, index) =>
      index === 1
        ? Effect.fail(failure)
        : Effect.succeed(settlement(candidate, index))
    );
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(source, handler, {
      pageSize: 2,
      maximumPages: 1,
      maximumCandidates: 2,
    }));

    const observed = await runTestFailure(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));
    expect(observed).toBe(failure);
    expect(handler.handledCandidates().map(({ runId }) => runId)).toEqual([
      RUN_1,
      RUN_2,
    ]);
  });

  it("preserves the exact due-source failure without invoking the handler", async () => {
    const failure = Object.freeze({ _tag: "InjectedSourceFailure" as const });
    const source: TaskDueWorkSourceV1<typeof failure> = {
      discoverDueRuns: () => Effect.fail(failure),
    };
    const handler = recordingSuccessHandler();
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(source, handler, {
      pageSize: 1,
      maximumPages: 1,
      maximumCandidates: 1,
    }));

    const observed = await runTestFailure(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));
    expect(observed).toBe(failure);
    expect(handler.handledCandidates()).toEqual([]);
  });

  it("reprocesses a duplicate wake through lifecycle idempotency instead of scheduler-local deduplication", async () => {
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [startCandidate(RUN_1, 1)],
    });
    const store = createDeterministicRunAttemptStore({ initial: readyAggregate() });
    const program = Effect.gen(function* () {
      const lifecycle = yield* RunAttemptLifecycle;
      const handler = makeRunAttemptDueCandidateHandlerV1(
        lifecycle,
        makeFixedTaskRetryJitterSourceV1(JITTER),
      );
      const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(source, handler, {
        pageSize: 1,
        maximumPages: 1,
        maximumCandidates: 1,
      }));
      const first = yield* scheduler.run({ dueKind: "start_attempt", cursor: null });
      const duplicate = yield* scheduler.run({ dueKind: "start_attempt", cursor: null });
      return { first, duplicate };
    }).pipe(
      Effect.provide(RunAttemptLifecycleLive),
      Effect.provide(store.layer),
    );

    const result = await runTestEffect(program);
    expect(result.first.handled[0]?.disposition).toBe("accepted");
    expect(result.duplicate.handled[0]?.disposition).toBe("idempotent");
    expect(store.writeCount()).toBe(1);
  });

  it("fails closed when a source returns a continuation that does not match its page", async () => {
    const candidate = startCandidate(RUN_1, 1);
    const invalidCursor = {
      version: 2,
      dueKind: "start_attempt",
      throughMs: THROUGH,
      dueAtMs: candidate.dueAtMs,
      runId: candidate.runId,
    } as unknown as TaskDueDiscoveryCursorV1;
    const source: TaskDueWorkSourceV1<never> = {
      discoverDueRuns: () => Effect.succeed({
        version: 1,
        dueKind: "start_attempt",
        throughMs: THROUGH,
        candidates: [candidate],
        nextCursor: invalidCursor,
      }),
    };
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      recordingSuccessHandler(),
      { pageSize: 1, maximumPages: 1, maximumCandidates: 1 },
    ));

    const observed = await runTestFailure(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));
    expect(observed).toBeInstanceOf(TaskWakeSchedulerSourceContractError);
    expect(observed).toMatchObject({ reason: "continuation_invalid", runId: RUN_1 });
  });

  it("fails closed when a source returns a page with an unsupported version", async () => {
    const source: TaskDueWorkSourceV1<never> = {
      discoverDueRuns: () => Effect.succeed({
        version: 2,
        dueKind: "start_attempt",
        throughMs: THROUGH,
        candidates: [],
        nextCursor: null,
      } as unknown as TaskDueDiscoveryPageV1),
    };
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      recordingSuccessHandler(),
      { pageSize: 1, maximumPages: 1, maximumCandidates: 1 },
    ));

    const observed = await runTestFailure(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));

    expect(observed).toBeInstanceOf(TaskWakeSchedulerSourceContractError);
    expect(observed).toMatchObject({ reason: "page_version_mismatch" });
  });

  it("rejects an unsupported input cursor version before invoking the source", async () => {
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [],
    });
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      recordingSuccessHandler(),
      { pageSize: 1, maximumPages: 1, maximumCandidates: 1 },
    ));
    const invalidCursor = {
      version: 2,
      dueKind: "start_attempt",
      throughMs: THROUGH,
      dueAtMs: databaseTime(1),
      runId: RUN_1,
    } as unknown as TaskDueDiscoveryCursorV1;

    const observed = await runTestFailure(scheduler.run({
      dueKind: "start_attempt",
      cursor: invalidCursor,
    }));

    expect(observed).toBeInstanceOf(InvalidTaskWakeSchedulerRunRequestError);
    expect(observed).toMatchObject({ reason: "cursor_version_mismatch" });
    expect(source.requests()).toEqual([]);
  });

  it("captures the in-memory source snapshot time at construction", async () => {
    const options = {
      throughMs: THROUGH,
      candidates: [startCandidate(RUN_1, 50)],
    };
    const source = makeInMemoryTaskDueWorkSourceV1(options);
    options.throughMs = databaseTime(10);
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      recordingSuccessHandler(),
      { pageSize: 1, maximumPages: 1, maximumCandidates: 1 },
    ));

    const receipt = await runTestEffect(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));

    expect(receipt).toMatchObject({ throughMs: THROUGH, candidatesHandled: 1 });
  });

  it("rejects a handler receipt with an impossible lifecycle combination", async () => {
    const candidate = startCandidate(RUN_1, 1);
    const malformed = Object.freeze({
      ...settlement(candidate, 0),
      disposition: "accepted",
      outcomeKind: "current",
    }) as unknown as TaskDueCandidateHandlingReceiptV1;
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [candidate],
    });
    const handler = makeRecordingTaskDueCandidateHandlerV1(() =>
      Effect.succeed(malformed)
    );
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      handler,
      { pageSize: 1, maximumPages: 1, maximumCandidates: 1 },
    ));

    const observed = await runTestFailure(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));

    expect(observed).toBeInstanceOf(TaskWakeSchedulerHandlerContractError);
    expect(observed).toMatchObject({
      reason: "receipt_candidate_mismatch",
      runId: RUN_1,
    });
  });

  it("rejects a non-current outcome with an unknown runtime disposition", async () => {
    const candidate = startCandidate(RUN_1, 1);
    const malformed = Object.freeze({
      ...settlement(candidate, 0),
      disposition: "adapter-specific",
      outcomeKind: "attempt_granted",
    }) as unknown as TaskDueCandidateHandlingReceiptV1;
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [candidate],
    });
    const handler = makeRecordingTaskDueCandidateHandlerV1(() =>
      Effect.succeed(malformed)
    );
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      handler,
      { pageSize: 1, maximumPages: 1, maximumCandidates: 1 },
    ));

    const observed = await runTestFailure(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));

    expect(observed).toBeInstanceOf(TaskWakeSchedulerHandlerContractError);
    expect(observed).toMatchObject({ reason: "receipt_candidate_mismatch" });
  });

  it("projects only the admitted receipt fields from a handler adapter", async () => {
    const candidate = startCandidate(RUN_1, 1);
    const adapterReceipt = Object.freeze({
      ...settlement(candidate, 0),
      adapterMetadata: "must-not-cross-the-port",
    });
    const source = makeInMemoryTaskDueWorkSourceV1({
      throughMs: THROUGH,
      candidates: [candidate],
    });
    const handler = makeRecordingTaskDueCandidateHandlerV1(() =>
      Effect.succeed(adapterReceipt)
    );
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      handler,
      { pageSize: 1, maximumPages: 1, maximumCandidates: 1 },
    ));

    const receipt = await runTestEffect(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));

    expect(receipt.handled[0]).toEqual(settlement(candidate, 0));
    expect(receipt.handled[0]).not.toHaveProperty("adapterMetadata");
  });

  it("projects only admitted cursor fields from a due-source adapter", async () => {
    const candidate = startCandidate(RUN_1, 1);
    const source: TaskDueWorkSourceV1<never> = {
      discoverDueRuns: () => Effect.succeed({
        version: 1,
        dueKind: "start_attempt",
        throughMs: THROUGH,
        candidates: [candidate],
        nextCursor: {
          version: 1,
          dueKind: "start_attempt",
          throughMs: THROUGH,
          dueAtMs: candidate.dueAtMs,
          runId: candidate.runId,
          adapterMetadata: "must-not-cross-the-port",
        },
      }),
    };
    const scheduler = Result.getOrThrow(makeTaskWakeSchedulerV1(
      source,
      recordingSuccessHandler(),
      { pageSize: 1, maximumPages: 1, maximumCandidates: 2 },
    ));

    const receipt = await runTestEffect(scheduler.run({
      dueKind: "start_attempt",
      cursor: null,
    }));

    expect(receipt.stopReason).toBe("page_budget");
    expect(receipt.continuation).toEqual({
      version: 1,
      dueKind: "start_attempt",
      throughMs: THROUGH,
      dueAtMs: candidate.dueAtMs,
      runId: candidate.runId,
    });
    expect(receipt.continuation).not.toHaveProperty("adapterMetadata");
  });
});

describe("RunAttempt due-candidate handler", () => {
  it("maps start and lease-expiry candidates into the admitted lifecycle commands", async () => {
    const commands: unknown[] = [];
    const currentState = projectRunAttemptStateV1(readyAggregate());
    const lifecycle: Pick<RunAttemptLifecycleShape, "startAttempt" | "handleLeaseExpiry"> = {
      startAttempt: (command) => {
        commands.push(command);
        return Effect.succeed({
          disposition: "current",
          observedAtMs: NOW,
          runVersion: RUN_VERSION_2,
          outcome: { kind: "current", reason: "stale_run_version", state: currentState },
          evidence: [],
          requestedEffects: [],
        });
      },
      handleLeaseExpiry: (command) => {
        commands.push(command);
        return Effect.succeed({
          disposition: "current",
          observedAtMs: NOW,
          runVersion: RUN_VERSION_2,
          outcome: { kind: "current", reason: "stale_lease_version", state: currentState },
          evidence: [],
          requestedEffects: [],
        });
      },
    };
    const handler = makeRunAttemptDueCandidateHandlerV1(
      lifecycle,
      makeFixedTaskRetryJitterSourceV1(JITTER),
    );
    const start = startCandidate(RUN_1, 10);
    const expiry: TaskDueDiscoveryCandidateV1 = {
      kind: "handle_lease_expiry",
      dueAtMs: databaseTime(20),
      runId: RUN_2,
      attemptId: ATTEMPT_ID,
      executionFence: FENCE_1,
      expectedLeaseVersion: LEASE_VERSION_1,
    };

    const receipts = await runTestEffect(Effect.gen(function* () {
      const startReceipt = yield* handler.handle(start);
      const expiryReceipt = yield* handler.handle(expiry);
      return [startReceipt, expiryReceipt] as const;
    }));

    expect(commands).toEqual([
      {
        type: "start_attempt",
        runId: RUN_1,
        expectedRunVersion: RUN_VERSION_1,
        retryJitter: JITTER,
      },
      {
        type: "handle_lease_expiry",
        runId: RUN_2,
        attemptId: ATTEMPT_ID,
        executionFence: FENCE_1,
        expectedLeaseVersion: LEASE_VERSION_1,
      },
    ]);
    expect(receipts.map(({ kind, disposition, outcomeKind }) => ({
      kind,
      disposition,
      outcomeKind,
    }))).toEqual([
      { kind: "start_attempt", disposition: "current", outcomeKind: "current" },
      { kind: "handle_lease_expiry", disposition: "current", outcomeKind: "current" },
    ]);
  });

  it("fails explicitly when lifecycle disposition and outcome disagree", async () => {
    const currentState = projectRunAttemptStateV1(readyAggregate());
    const lifecycle: Pick<RunAttemptLifecycleShape, "startAttempt" | "handleLeaseExpiry"> = {
      startAttempt: () => Effect.succeed({
        disposition: "accepted",
        observedAtMs: NOW,
        runVersion: RUN_VERSION_2,
        outcome: { kind: "current", reason: "stale_run_version", state: currentState },
        evidence: [],
        requestedEffects: [],
      }),
      handleLeaseExpiry: () => Effect.die("not invoked"),
    };
    const handler = makeRunAttemptDueCandidateHandlerV1(
      lifecycle,
      makeFixedTaskRetryJitterSourceV1(JITTER),
    );

    const observed = await runTestFailure(handler.handle(startCandidate(RUN_1, 10)));

    expect(observed).toBeInstanceOf(TaskDueCandidateLifecycleContractError);
    expect(observed).toMatchObject({
      dueKind: "start_attempt",
      runId: RUN_1,
      reason: "disposition_outcome_mismatch",
    });
  });
});

function startCandidate(
  id: ReturnType<typeof runId>,
  dueAtMs: number,
): TaskDueDiscoveryCandidateV1 {
  return Object.freeze({
    kind: "start_attempt",
    dueAtMs: databaseTime(dueAtMs),
    runId: id,
    expectedRunVersion: RUN_VERSION_1,
  });
}

function recordingSuccessHandler() {
  return makeRecordingTaskDueCandidateHandlerV1((candidate, index) =>
    Effect.succeed(settlement(candidate, index))
  );
}

function settlement(
  candidate: TaskDueDiscoveryCandidateV1,
  index: number,
): TaskDueCandidateHandlingReceiptV1 {
  return Object.freeze({
    version: "flarex.task-due-candidate-handling-receipt.v1",
    kind: candidate.kind,
    dueAtMs: candidate.dueAtMs,
    runId: candidate.runId,
    disposition: "current",
    observedAtMs: databaseTime(1_000 + index),
    runVersion: runVersion(BigInt(index + 1)),
    outcomeKind: "current",
  });
}

function runTestEffect<Success, Failure>(
  effect: Effect.Effect<Success, Failure>,
): Promise<Success> {
  return Effect.runPromise(effect);
}

function runTestFailure<Success, Failure>(
  effect: Effect.Effect<Success, Failure>,
): Promise<Failure> {
  return Effect.runPromise(effect.pipe(Effect.flip));
}
