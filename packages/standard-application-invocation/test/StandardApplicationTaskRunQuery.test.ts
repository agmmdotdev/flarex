import {
  TaskSystemRunAttemptUnavailableError,
  type ApplicationTaskSystemRunAttemptStoreShape,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  inspectStandardApplicationTaskRun,
  makeStandardApplicationTaskRunQueryLayer,
} from "../src/StandardApplicationTaskRunQuery.js";

type InspectionStore = Pick<
  ApplicationTaskSystemRunAttemptStoreShape,
  "inspectRunAttempt"
>;

describe("StandardApplicationTaskRunQuery", () => {
  it("wires the durable scope query without rewriting its failure", async () => {
    const runId = Brand.nominal<TaskRunIdV1>()("run-standard-query-1");
    const failure = new TaskSystemRunAttemptUnavailableError({
      operation: "inspect_current_attempt",
      runId,
      reason: "unavailable",
    });
    const inspectRunAttempt = vi.fn<InspectionStore["inspectRunAttempt"]>(
      () => Effect.fail(failure),
    );

    const result = await Effect.runPromise(Effect.result(
      inspectStandardApplicationTaskRun(runId).pipe(Effect.provide(
        makeStandardApplicationTaskRunQueryLayer({ inspectRunAttempt }),
      )),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(inspectRunAttempt).toHaveBeenCalledOnce();
    expect(inspectRunAttempt).toHaveBeenCalledWith({
      operation: "inspect_current_attempt",
      runId,
    });
  });
});
