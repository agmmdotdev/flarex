import {
  makeTaskEventHistoryQueryLayer,
  TaskEventHistoryQuery,
  TaskEventHistoryStoreFailure,
  type ApplicationTaskEventHistoryStoreShape,
  type TaskEventHistoryStoreItem,
  type TaskEventHistoryStoreSnapshot,
} from "@flarex/durable-task/internal/run-projection";
import type {
  TaskDatabaseTimeMsV1,
  TaskAttemptNumberV1,
  TaskRequestedEffectSequenceV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const attemptNumber = Brand.nominal<TaskAttemptNumberV1>();
const sequence = Brand.nominal<TaskRequestedEffectSequenceV1>();
const runVersion = Brand.nominal<TaskRunVersionV1>();
const runId = Brand.nominal<TaskRunIdV1>()(
  "run_00000000-0000-4000-8000-0000000000d1",
);

describe("TaskEventHistoryQuery", () => {
  it("projects an owned immutable lifecycle timeline", async () => {
    const input = Object.freeze([
      item(3n, 2n, 1_000, {
        kind: "attempt_granted",
        attemptNumber: attemptNumber(1),
      }),
      item(7n, 3n, 1_100, {
        kind: "retry_scheduled",
        previousAttemptNumber: attemptNumber(1),
        retry: { source: "failed_completion", delivery: "durable" },
        notBeforeMs: databaseTime(1_500),
      }),
    ]);
    const listEvents = vi.fn<ApplicationTaskEventHistoryStoreShape["listEvents"]>(
      () => Effect.succeed(snapshot(input)),
    );

    const history = await Effect.runPromise(Effect.gen(function* () {
      const query = yield* TaskEventHistoryQuery;
      return yield* query.list(runId);
    }).pipe(Effect.provide(makeTaskEventHistoryQueryLayer({ listEvents }))));

    expect(listEvents).toHaveBeenCalledWith(runId);
    expect(history.events.map(entry => ({
      sequence: entry.sequence,
      recordedRunVersion: entry.recordedRunVersion,
      kind: entry.event.kind,
    }))).toEqual([
      { sequence: 3n, recordedRunVersion: 2n, kind: "attempt_granted" },
      { sequence: 7n, recordedRunVersion: 3n, kind: "retry_scheduled" },
    ]);
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.events)).toBe(true);
    expect(Object.isFrozen(history.events[1]?.event)).toBe(true);
    const retry = history.events[1]?.event;
    expect(retry?.kind === "retry_scheduled" && Object.isFrozen(retry.retry))
      .toBe(true);
  });

  it.each([
    {
      name: "nonadvancing ledger sequence",
      events: [
        item(3n, 2n, 1_000, { kind: "attempt_granted", attemptNumber: attemptNumber(1) }),
        item(3n, 3n, 1_100, { kind: "execution_observed", attemptNumber: attemptNumber(1) }),
      ],
      reason: "event_order_invalid",
    },
    {
      name: "nonadvancing run version",
      events: [
        item(3n, 2n, 1_000, { kind: "attempt_granted", attemptNumber: attemptNumber(1) }),
        item(5n, 2n, 1_100, { kind: "execution_observed", attemptNumber: attemptNumber(1) }),
      ],
      reason: "recorded_version_not_advanced",
    },
    {
      name: "event version beyond the run",
      events: [item(3n, 9n, 1_000, {
        kind: "attempt_granted",
        attemptNumber: attemptNumber(1),
      })],
      reason: "recorded_version_exceeds_run",
    },
  ])("rejects $name", async ({ events, reason }) => {
    await expect(queryFailure(snapshot(events))).resolves.toMatchObject({
      _tag: "TaskEventHistoryStoreContractError",
      reason,
    });
  });

  it("rejects more lifecycle events than one run can accept", async () => {
    const events = Array.from({ length: 752 }, (_, index) => item(
      BigInt(index + 1),
      BigInt(index + 1),
      index,
      { kind: "attempt_granted", attemptNumber: attemptNumber(1) },
    ));
    await expect(queryFailure(Object.freeze({
      observedAtMs: databaseTime(4_000),
      runVersion: runVersion(800n),
      events: Object.freeze(events),
    }))).resolves.toMatchObject({ reason: "too_many_events" });
  });

  it("preserves store failures by identity without retry", async () => {
    const expected = new TaskEventHistoryStoreFailure({
      operation: "list_task_events",
      runId,
      reason: "stale_scope_authority",
      cause: null,
    });
    const listEvents = vi.fn<ApplicationTaskEventHistoryStoreShape["listEvents"]>(
      () => Effect.fail(expected),
    );
    const received = await Effect.runPromise(Effect.flip(
      Effect.gen(function* () {
        const query = yield* TaskEventHistoryQuery;
        return yield* query.list(runId);
      }).pipe(Effect.provide(makeTaskEventHistoryQueryLayer({ listEvents }))),
    ));
    expect(received).toBe(expected);
    expect(listEvents).toHaveBeenCalledOnce();
  });
});

function item(
  ledgerSequence: bigint,
  acceptedRunVersion: bigint,
  observedAtMs: number,
  event: TaskEventHistoryStoreItem["event"],
): TaskEventHistoryStoreItem {
  return Object.freeze({
    sequence: sequence(ledgerSequence),
    acceptedRunVersion: runVersion(acceptedRunVersion),
    observedAtMs: databaseTime(observedAtMs),
    event,
  });
}

function snapshot(
  events: readonly TaskEventHistoryStoreItem[],
): TaskEventHistoryStoreSnapshot {
  return Object.freeze({
    observedAtMs: databaseTime(4_000),
    runVersion: runVersion(7n),
    events: Object.freeze([...events]),
  });
}

async function queryFailure(value: TaskEventHistoryStoreSnapshot) {
  const listEvents: ApplicationTaskEventHistoryStoreShape["listEvents"] =
    () => Effect.succeed(value);
  return Effect.runPromise(
    Effect.flip(Effect.gen(function* () {
      const query = yield* TaskEventHistoryQuery;
      return yield* query.list(runId);
    }).pipe(Effect.provide(makeTaskEventHistoryQueryLayer({ listEvents })))),
  );
}
