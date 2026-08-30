import {
  StandardApplicationTaskAttemptHistoryQuery,
  type StandardApplicationTaskAttemptHistoryQueryApi,
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
  listTaskAttempts,
  listTaskRuns,
  type TaskAttempt,
  type TaskAttemptHistory,
  type TaskRunId,
  type TaskRunRef,
} from "../src/index.js";

type RunStatus = Effect.Success<
  ReturnType<StandardApplicationTaskRunQueryApi["inspect"]>
>;
type History = Effect.Success<
  ReturnType<StandardApplicationTaskAttemptHistoryQueryApi["list"]>
>;
const databaseTime = Brand.nominal<RunStatus["observedAtMs"]>();
const runId = Brand.nominal<RunStatus["runId"]>()(
  "run_00000000-0000-4000-8000-0000000000c1",
);
const runVersion = Brand.nominal<RunStatus["runVersion"]>();
const attemptId = Brand.nominal<History["attempts"][number]["attemptId"]>();
const attemptNumber = Brand.nominal<
  History["attempts"][number]["attemptNumber"]
>();

describe("clean Task attempt-history primitive", () => {
  it("lists admissions through the exact scope that issued the run ref", async () => {
    const scope = pointQueryScope();
    const list = vi.fn<StandardApplicationTaskAttemptHistoryQueryApi["list"]>(
      () => Effect.succeed(attemptHistory()),
    );
    const reference = await issueReference(scope);

    const history = await Effect.runPromise(listTaskAttempts(reference).pipe(
      Effect.provideService(
        StandardApplicationTaskAttemptHistoryQuery,
        StandardApplicationTaskAttemptHistoryQuery.of({ scope, list }),
      ),
    ));

    expect(history).not.toBe(attemptHistoryValue);
    expect(history).toEqual({
      runId,
      observedAtMs: 2_000,
      runVersion: 2n,
      attempts: [{
        attemptId: "attempt_00000000-0000-4000-8000-0000000000c1",
        attemptNumber: 1,
        admittedRunVersion: 1n,
      }],
    });
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.attempts)).toBe(true);
    expect(Object.isFrozen(history.attempts[0])).toBe(true);
    expect(history.attempts).not.toBe(attemptHistoryValue.attempts);
    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith(runId);
    expectTypeOf(history).toEqualTypeOf<TaskAttemptHistory>();
    expectTypeOf(history.runId).toEqualTypeOf<TaskRunId>();
    expectTypeOf(history.observedAtMs).toEqualTypeOf<number>();
    expectTypeOf(history.runVersion).toEqualTypeOf<bigint>();
    expectTypeOf(history.attempts).toEqualTypeOf<readonly TaskAttempt[]>();
    expectTypeOf<TaskAttempt["attemptId"]>().toEqualTypeOf<string>();
  });

  it("rejects a forged ref before attempt-history I/O", async () => {
    const scope = pointQueryScope();
    const list = forbiddenHistoryList();

    const exit = await Effect.runPromise(Effect.exit(
      listTaskAttempts(Object.freeze({}) as TaskRunRef).pipe(
        Effect.provideService(
          StandardApplicationTaskAttemptHistoryQuery,
          StandardApplicationTaskAttemptHistoryQuery.of({ scope, list }),
        ),
      ),
    ));

    expectMetadataDefect(exit);
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects a genuine ref under a different history scope before I/O", async () => {
    const reference = await issueReference(pointQueryScope());
    const scope = pointQueryScope();
    const list = forbiddenHistoryList();

    const exit = await Effect.runPromise(Effect.exit(
      listTaskAttempts(reference).pipe(Effect.provideService(
        StandardApplicationTaskAttemptHistoryQuery,
        StandardApplicationTaskAttemptHistoryQuery.of({ scope, list }),
      )),
    ));

    expectMetadataDefect(exit);
    expect(list).not.toHaveBeenCalled();
  });
});

const attemptHistoryValue = Object.freeze({
  runId,
  observedAtMs: databaseTime(2_000),
  runVersion: runVersion(2n),
  attempts: Object.freeze([Object.freeze({
    attemptId: attemptId(
      "attempt_00000000-0000-4000-8000-0000000000c1",
    ),
    attemptNumber: attemptNumber(1),
    admittedRunVersion: runVersion(1n),
  })]),
});

function attemptHistory(): History {
  return attemptHistoryValue;
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
  const list = vi.fn<StandardApplicationTaskRunListQueryApi["list"]>(
    () => Effect.succeed(Object.freeze({
      observedAtMs: databaseTime(1_000),
      items: Object.freeze([readyRun()]),
      nextCursor: null,
    })),
  );
  return StandardApplicationTaskRunListQuery.of({ scope, list });
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

function forbiddenHistoryList() {
  return vi.fn<StandardApplicationTaskAttemptHistoryQueryApi["list"]>(
    () => Effect.die("must not list Task attempts"),
  );
}

function expectMetadataDefect(exit: Exit.Exit<unknown, unknown>): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const defect = Cause.findDefect(exit.cause);
    expect(Result.isSuccess(defect)).toBe(true);
    if (Result.isSuccess(defect)) {
      expect(defect.success).toEqual(
        new TypeError("Task run metadata is unavailable."),
      );
    }
  }
}
