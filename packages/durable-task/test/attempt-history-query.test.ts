import {
  makeTaskAttemptHistoryQueryLayer,
  TaskAttemptHistoryQuery,
  TaskAttemptHistoryStoreFailure,
  type ApplicationTaskAttemptHistoryStoreShape,
  type TaskAttemptHistoryStoreItem,
  type TaskAttemptHistoryStoreSnapshot,
} from "@flarex/durable-task/internal/run-projection";
import type {
  TaskAttemptIdV1,
  TaskAttemptNumberV1,
  TaskDatabaseTimeMsV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

const attemptId = Brand.nominal<TaskAttemptIdV1>();
const attemptNumber = Brand.nominal<TaskAttemptNumberV1>();
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const runId = Brand.nominal<TaskRunIdV1>()(
  "run_00000000-0000-4000-8000-0000000000a1",
);
const runVersion = Brand.nominal<TaskRunVersionV1>();

describe("TaskAttemptHistoryQuery", () => {
  it("projects a bounded immutable admission history", async () => {
    const storeAttempts = Object.freeze([
      storeItem(1, 2n, "00000000-0000-4000-8000-0000000000a2"),
      storeItem(2, 5n, "00000000-0000-4000-8000-0000000000a3"),
    ]);
    const listAttempts = vi.fn<
      ApplicationTaskAttemptHistoryStoreShape["listAttempts"]
    >(() => Effect.succeed(Object.freeze({
      observedAtMs: databaseTime(4_000),
      runVersion: runVersion(7n),
      attempts: storeAttempts,
    })));

    const history = await Effect.runPromise(Effect.gen(function* () {
      const query = yield* TaskAttemptHistoryQuery;
      return yield* query.list(runId);
    }).pipe(Effect.provide(makeTaskAttemptHistoryQueryLayer({ listAttempts }))));

    expect(listAttempts).toHaveBeenCalledWith(runId);
    expect(history).toEqual({
      runId,
      observedAtMs: databaseTime(4_000),
      runVersion: runVersion(7n),
      attempts: [
        {
          attemptId: storeAttempts[0]?.attemptId,
          attemptNumber: attemptNumber(1),
          admittedRunVersion: runVersion(2n),
        },
        {
          attemptId: storeAttempts[1]?.attemptId,
          attemptNumber: attemptNumber(2),
          admittedRunVersion: runVersion(5n),
        },
      ],
    });
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.attempts)).toBe(true);
    expect(Object.isFrozen(history.attempts[0])).toBe(true);
  });

  it.each([
    {
      name: "nonsequential attempt number",
      snapshot: snapshot([storeItem(
        2,
        2n,
        "00000000-0000-4000-8000-0000000000a4",
      )]),
      reason: "attempt_order_invalid",
    },
    {
      name: "nonadvancing accepted version",
      snapshot: snapshot([
        storeItem(1, 2n, "00000000-0000-4000-8000-0000000000a5"),
        storeItem(2, 2n, "00000000-0000-4000-8000-0000000000a6"),
      ]),
      reason: "accepted_version_not_advanced",
    },
    {
      name: "accepted version beyond the run",
      snapshot: snapshot([storeItem(
        1,
        9n,
        "00000000-0000-4000-8000-0000000000a7",
      )]),
      reason: "accepted_version_exceeds_run",
    },
  ])("rejects $name from a hostile store", async ({ snapshot, reason }) => {
    const failure = await queryFailure(snapshot);
    expect(failure).toMatchObject({
      _tag: "TaskAttemptHistoryStoreContractError",
      reason,
    });
  });

  it("rejects more entries than the durable attempt bound", async () => {
    const attempts = Array.from({ length: 251 }, (_, index) => storeItem(
      index + 1,
      BigInt(index + 2),
      `${(index + 1).toString(16).padStart(8, "0")}-0000-4000-8000-0000000000aa`,
    ));
    const failure = await queryFailure({
      observedAtMs: databaseTime(4_000),
      runVersion: runVersion(300n),
      attempts,
    });

    expect(failure).toMatchObject({
      _tag: "TaskAttemptHistoryStoreContractError",
      reason: "too_many_attempts",
    });
  });

  it("preserves the captured store failure by identity without retry", async () => {
    const expected = new TaskAttemptHistoryStoreFailure({
      operation: "list_task_attempts",
      runId,
      reason: "stale_scope_authority",
      cause: null,
    });
    const listAttempts = vi.fn<
      ApplicationTaskAttemptHistoryStoreShape["listAttempts"]
    >(() => Effect.fail(expected));

    const received = await Effect.runPromise(Effect.flip(
      Effect.gen(function* () {
        const query = yield* TaskAttemptHistoryQuery;
        return yield* query.list(runId);
      }).pipe(Effect.provide(makeTaskAttemptHistoryQueryLayer({ listAttempts }))),
    ));

    expect(received).toBe(expected);
    expect(listAttempts).toHaveBeenCalledOnce();
  });
});

function storeItem(
  number: number,
  acceptedVersion: bigint,
  uuid: string,
): TaskAttemptHistoryStoreItem {
  return Object.freeze({
    attemptId: attemptId(`attempt_${uuid}`),
    attemptNumber: attemptNumber(number),
    acceptedRunVersion: runVersion(acceptedVersion),
  });
}

function snapshot(
  attempts: readonly TaskAttemptHistoryStoreItem[],
): TaskAttemptHistoryStoreSnapshot {
  return Object.freeze({
    observedAtMs: databaseTime(4_000),
    runVersion: runVersion(7n),
    attempts: Object.freeze([...attempts]),
  });
}

async function queryFailure(
  value: TaskAttemptHistoryStoreSnapshot,
): Promise<unknown> {
  const listAttempts: ApplicationTaskAttemptHistoryStoreShape["listAttempts"] =
    () => Effect.succeed(value);
  return Effect.runPromise(Effect.flip(
    Effect.gen(function* () {
      const query = yield* TaskAttemptHistoryQuery;
      return yield* query.list(runId);
    }).pipe(Effect.provide(makeTaskAttemptHistoryQueryLayer({ listAttempts }))),
  ));
}
