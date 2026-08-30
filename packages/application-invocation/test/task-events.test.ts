import {
  StandardApplicationTaskEventHistoryQuery,
  type StandardApplicationTaskEventHistoryQueryApi,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import {
  StandardApplicationTaskRunListQuery,
  type StandardApplicationTaskRunListQueryApi,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import { Brand, Cause, Effect, Exit, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  listTaskEvents,
  listTaskRuns,
  type TaskEvent,
  type TaskEventHistory,
  type TaskLifecycleEvent,
  type TaskRunId,
  type TaskRunRef,
} from "../src/index.js";
import { projectTaskEventHistory } from "../src/TaskEvents.js";

type RunStatus = Effect.Success<
  ReturnType<StandardApplicationTaskRunQueryApi["inspect"]>
>;
type EventHistory = Effect.Success<
  ReturnType<StandardApplicationTaskEventHistoryQueryApi["list"]>
>;
type StandardEvent = EventHistory["events"][number]["event"];
const databaseTime = Brand.nominal<RunStatus["observedAtMs"]>();
const runId = Brand.nominal<RunStatus["runId"]>()(
  "run_00000000-0000-4000-8000-0000000000e1",
);
const runVersion = Brand.nominal<RunStatus["runVersion"]>();
const sequence = Brand.nominal<EventHistory["events"][number]["sequence"]>();
const attemptNumber = Brand.nominal<
  Extract<StandardEvent, { readonly kind: "attempt_granted" }>["attemptNumber"]
>();
const generation = Brand.nominal<
  Extract<
    StandardEvent,
    { readonly kind: "cancellation_requested" }
  >["generation"]
>();

describe("clean Task lifecycle-event primitive", () => {
  it("lists lifecycle events through the scope that issued the run ref", async () => {
    const scope = pointQueryScope();
    const list = vi.fn<StandardApplicationTaskEventHistoryQueryApi["list"]>(
      () => Effect.succeed(eventHistoryValue),
    );
    const reference = await issueReference(scope);

    const history = await Effect.runPromise(listTaskEvents(reference).pipe(
      Effect.provideService(
        StandardApplicationTaskEventHistoryQuery,
        StandardApplicationTaskEventHistoryQuery.of({ scope, list }),
      ),
    ));

    expect(history).not.toBe(eventHistoryValue);
    expect(history).toEqual({
      runId,
      observedAtMs: 2_000,
      runVersion: 2n,
      events: [{
        sequence: 1n,
        recordedRunVersion: 1n,
        observedAtMs: 1_000,
        event: { kind: "attemptGranted", attemptNumber: 1 },
      }],
    });
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.events)).toBe(true);
    expect(Object.isFrozen(history.events[0])).toBe(true);
    expect(Object.isFrozen(history.events[0]?.event)).toBe(true);
    expect(history.events).not.toBe(eventHistoryValue.events);
    expect(list).toHaveBeenCalledWith(runId);
    expectTypeOf(history).toEqualTypeOf<TaskEventHistory>();
    expectTypeOf(history.runId).toEqualTypeOf<TaskRunId>();
    expectTypeOf(history.observedAtMs).toEqualTypeOf<number>();
    expectTypeOf(history.runVersion).toEqualTypeOf<bigint>();
    expectTypeOf(history.events).toEqualTypeOf<readonly TaskEvent[]>();
  });

  it.each([
    [
      { kind: "attempt_granted", attemptNumber: attemptNumber(1) },
      { kind: "attemptGranted", attemptNumber: 1 },
    ],
    [
      { kind: "execution_observed", attemptNumber: attemptNumber(1) },
      { kind: "executionObserved", attemptNumber: 1 },
    ],
    [
      {
        kind: "cancellation_requested",
        attemptNumber: attemptNumber(1),
        generation: generation(2n),
        reasonCode: "policy_cancelled",
      },
      {
        kind: "cancellationRequested",
        attemptNumber: 1,
        generation: 2n,
        reasonCode: "policyCancelled",
      },
    ],
    [
      {
        kind: "retry_scheduled",
        previousAttemptNumber: attemptNumber(1),
        retry: { source: "failed_completion", delivery: "immediate" },
        notBeforeMs: databaseTime(1_500),
      },
      {
        kind: "retryScheduled",
        previousAttemptNumber: 1,
        retry: { source: "failedCompletion", delivery: "immediate" },
        notBeforeMs: 1_500,
      },
    ],
    [
      {
        kind: "retry_scheduled",
        previousAttemptNumber: attemptNumber(1),
        retry: { source: "lease_expiry", delivery: "durable" },
        notBeforeMs: databaseTime(1_500),
      },
      {
        kind: "retryScheduled",
        previousAttemptNumber: 1,
        retry: { source: "leaseExpiry", delivery: "durable" },
        notBeforeMs: 1_500,
      },
    ],
    [
      {
        kind: "run_succeeded",
        attemptNumber: attemptNumber(1),
        hasResult: true,
      },
      { kind: "runSucceeded", attemptNumber: 1, hasResult: true },
    ],
    [
      {
        kind: "run_cancelled",
        generation: generation(2n),
        reasonCode: "requested",
        cancellation: {
          attemptNumber: null,
          resolution: "without_active_attempt",
        },
      },
      {
        kind: "runCancelled",
        generation: 2n,
        reasonCode: "requested",
        cancellation: {
          attemptNumber: null,
          resolution: "withoutActiveAttempt",
        },
      },
    ],
    [
      {
        kind: "run_cancelled",
        generation: generation(2n),
        reasonCode: "execution_cancelled",
        cancellation: {
          attemptNumber: attemptNumber(1),
          resolution: "acknowledged",
        },
      },
      {
        kind: "runCancelled",
        generation: 2n,
        reasonCode: "executionCancelled",
        cancellation: { attemptNumber: 1, resolution: "acknowledged" },
      },
    ],
    [
      {
        kind: "run_cancelled",
        generation: generation(2n),
        reasonCode: "policy_cancelled",
        cancellation: {
          attemptNumber: attemptNumber(1),
          resolution: "lease_expired",
        },
      },
      {
        kind: "runCancelled",
        generation: 2n,
        reasonCode: "policyCancelled",
        cancellation: { attemptNumber: 1, resolution: "leaseExpired" },
      },
    ],
    [
      {
        kind: "run_failed",
        attemptNumber: attemptNumber(1),
        failure: { kind: "task_failure", code: "handler_failed" },
      },
      {
        kind: "runFailed",
        attemptNumber: 1,
        failure: { kind: "taskFailure", code: "handlerFailed" },
      },
    ],
  ] as const satisfies readonly (readonly [
    StandardEvent,
    TaskLifecycleEvent,
  ])[])("projects lifecycle event $0.kind", (event, expected) => {
    const source = eventHistory(event);
    const projected = projectTaskEventHistory(source);

    expect(projected.events[0]?.event).toEqual(expected);
    expect(projected).not.toBe(source);
    expect(projected.events).not.toBe(source.events);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.events)).toBe(true);
    expect(Object.isFrozen(projected.events[0])).toBe(true);
    const projectedEvent = projected.events[0]?.event;
    expect(Object.isFrozen(projectedEvent)).toBe(true);
    if (projectedEvent?.kind === "retryScheduled") {
      expect(Object.isFrozen(projectedEvent.retry)).toBe(true);
    }
    if (projectedEvent?.kind === "runCancelled") {
      expect(Object.isFrozen(projectedEvent.cancellation)).toBe(true);
    }
    if (projectedEvent?.kind === "runFailed") {
      expect(Object.isFrozen(projectedEvent.failure)).toBe(true);
    }
  });

  it.each([
    { name: "forged", reference: Object.freeze({}) as TaskRunRef },
    { name: "cross-scope", reference: null },
  ])("rejects a $name ref before event I/O", async ({ reference }) => {
    const issuingScope = pointQueryScope();
    const actualReference = reference ?? await issueReference(issuingScope);
    const scope = pointQueryScope();
    const list = vi.fn<StandardApplicationTaskEventHistoryQueryApi["list"]>(
      () => Effect.die("must not list Task events"),
    );
    const exit = await Effect.runPromise(Effect.exit(
      listTaskEvents(actualReference).pipe(Effect.provideService(
        StandardApplicationTaskEventHistoryQuery,
        StandardApplicationTaskEventHistoryQuery.of({ scope, list }),
      )),
    ));
    expectMetadataDefect(exit);
    expect(list).not.toHaveBeenCalled();
  });
});

const eventHistoryValue = Object.freeze({
  runId,
  observedAtMs: databaseTime(2_000),
  runVersion: runVersion(2n),
  events: Object.freeze([eventEntry({
    kind: "attempt_granted",
    attemptNumber: attemptNumber(1),
  })]),
}) satisfies EventHistory;

function eventHistory(event: StandardEvent): EventHistory {
  return Object.freeze({
    runId,
    observedAtMs: databaseTime(2_000),
    runVersion: runVersion(2n),
    events: Object.freeze([eventEntry(event)]),
  });
}

function eventEntry(
  event: StandardEvent,
): EventHistory["events"][number] {
  return Object.freeze({
    sequence: sequence(1n),
    recordedRunVersion: runVersion(1n),
    observedAtMs: databaseTime(1_000),
    event: Object.freeze(event),
  });
}

function pointQueryScope(): StandardApplicationTaskRunQueryApi {
  return StandardApplicationTaskRunQuery.of({
    inspect: () => Effect.die("must not inspect the run"),
  });
}

async function issueReference(
  scope: StandardApplicationTaskRunQueryApi,
): Promise<TaskRunRef> {
  const page = await Effect.runPromise(listTaskRuns().pipe(
    Effect.provideService(StandardApplicationTaskRunListQuery, runListQuery(scope)),
  ));
  const listed = page.runs[0];
  if (listed === undefined) throw new Error("expected one listed Task run");
  return listed.ref;
}

function runListQuery(
  scope: StandardApplicationTaskRunQueryApi,
): StandardApplicationTaskRunListQueryApi {
  return StandardApplicationTaskRunListQuery.of({
    scope,
    list: () => Effect.succeed(Object.freeze({
      observedAtMs: databaseTime(1_000),
      items: Object.freeze([readyRun()]),
      nextCursor: null,
    })),
  });
}

function readyRun(): RunStatus {
  return Object.freeze({
    runId,
    createdAtMs: databaseTime(500),
    observedAtMs: databaseTime(1_000),
    runVersion: runVersion(1n),
    state: Object.freeze({
      kind: "ready" as const,
      eligibleAtMs: databaseTime(500),
      retry: null,
      cancellation: Object.freeze({ kind: "not_requested" as const }),
    }),
  });
}

function expectMetadataDefect(exit: Exit.Exit<unknown, unknown>): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const defect = Cause.findDefect(exit.cause);
    expect(Result.isSuccess(defect)).toBe(true);
    expect(Result.getOrThrow(defect)).toEqual(
      new TypeError("Task run metadata is unavailable."),
    );
  }
}
