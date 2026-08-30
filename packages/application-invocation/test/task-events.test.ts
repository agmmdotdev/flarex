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
  type TaskEventHistory,
  type TaskRunRef,
} from "../src/index.js";

type RunStatus = Effect.Success<
  ReturnType<StandardApplicationTaskRunQueryApi["inspect"]>
>;
type EventHistory = Effect.Success<
  ReturnType<StandardApplicationTaskEventHistoryQueryApi["list"]>
>;
const databaseTime = Brand.nominal<RunStatus["observedAtMs"]>();
const runId = Brand.nominal<RunStatus["runId"]>()(
  "run_00000000-0000-4000-8000-0000000000e1",
);
const runVersion = Brand.nominal<RunStatus["runVersion"]>();

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

    expect(history).toBe(eventHistoryValue);
    expect(list).toHaveBeenCalledWith(runId);
    expectTypeOf(history).toEqualTypeOf<TaskEventHistory>();
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
  events: Object.freeze([]),
}) satisfies EventHistory;

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
