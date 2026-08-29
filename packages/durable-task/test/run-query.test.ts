import { Brand, Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  TaskSystemRunAttemptCorruptionError,
  TaskSystemRunAttemptStaleScopeAuthorityError,
  TaskSystemRunAttemptTerminalStoreError,
  TaskSystemRunAttemptTransientStoreError,
  TaskSystemRunAttemptUnavailableError,
} from "../src/runAttempt/Errors.js";
import type {
  ApplicationTaskRunAttemptAggregateV1,
  ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
} from "../src/runAttempt/Model.js";
import type { ApplicationTaskRuntimeTargetSha256V1 } from
  "../src/runCreation/Model.js";
import type {
  ApplicationTaskSystemRunAttemptStoreShape,
} from "../src/runAttempt/Services/TaskSystemRunAttemptStore.js";
import {
  makeTaskRunQueryLayer,
  projectTaskRun,
  TaskRunQuery,
} from "../src/runProjection/index.js";
import { NOW, RUN_ID, readyAggregate } from "./support.js";

type InspectionStore = Pick<
  ApplicationTaskSystemRunAttemptStoreShape,
  "inspectRunAttempt"
>;

describe("TaskRunQuery", () => {
  it("reads exactly one authoritative snapshot and applies the safe projection", async () => {
    const snapshot = readyApplicationSnapshot();
    const inspectRunAttempt = vi.fn<InspectionStore["inspectRunAttempt"]>(
      () => Effect.succeed(snapshot),
    );
    const projection = await Effect.runPromise(inspectWith(
      makeTaskRunQueryLayer({ inspectRunAttempt }),
    ));

    expect(inspectRunAttempt).toHaveBeenCalledOnce();
    expect(inspectRunAttempt).toHaveBeenCalledWith({
      operation: "inspect_current_attempt",
      runId: RUN_ID,
    });
    expect(projection).toEqual(projectTaskRun(snapshot));
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.state)).toBe(true);
  });

  it("propagates every store failure by identity without retrying", async () => {
    const failures = [
      new TaskSystemRunAttemptUnavailableError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "unavailable",
      }),
      new TaskSystemRunAttemptCorruptionError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "aggregate_invalid",
      }),
      new TaskSystemRunAttemptStaleScopeAuthorityError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        authority: "epoch",
      }),
      new TaskSystemRunAttemptTransientStoreError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "timeout",
        cause: new Error("timed out"),
      }),
      new TaskSystemRunAttemptTerminalStoreError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "unsupported_integration",
        cause: null,
      }),
    ] as const;

    for (const expected of failures) {
      const inspectRunAttempt = vi.fn<InspectionStore["inspectRunAttempt"]>(
        () => Effect.fail(expected),
      );
      const result = await Effect.runPromise(Effect.result(inspectWith(
        makeTaskRunQueryLayer({ inspectRunAttempt }),
      )));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBe(expected);
      expect(inspectRunAttempt).toHaveBeenCalledOnce();
    }
  });
});

function inspectWith(
  layer: ReturnType<typeof makeTaskRunQueryLayer>,
) {
  return Effect.gen(function* () {
    const query = yield* TaskRunQuery;
    return yield* query.inspect(RUN_ID);
  }).pipe(Effect.provide(layer));
}

function readyApplicationSnapshot():
  ApplicationTaskSystemRunAttemptInspectionSnapshotV1 {
  const legacy = readyAggregate();
  if (legacy.phase !== "ready") throw new Error("Expected ready aggregate.");
  const current = {
    version: legacy.version,
    runId: legacy.runId,
    applicationTaskRuntimeTargetSha256:
      Brand.nominal<ApplicationTaskRuntimeTargetSha256V1>()(
        new Uint8Array(32).fill(0x52),
      ),
    createdAtMs: legacy.createdAtMs,
    runVersion: legacy.runVersion,
    boundPolicy: legacy.boundPolicy,
    attemptHistory: legacy.attemptHistory,
    leaseHistory: legacy.leaseHistory,
    lastLifecycleAcceptance: null,
    completionReplays: Object.freeze([]),
    requestedEffectCursor: legacy.requestedEffectCursor,
    phase: "ready",
    ready: legacy.ready,
    cancellation: legacy.cancellation,
  } satisfies ApplicationTaskRunAttemptAggregateV1;
  return Object.freeze({ observedAtMs: NOW, current });
}
