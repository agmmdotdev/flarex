import { Brand, Option } from "effect";
import { describe, expect, it } from "vitest";

import type {
  ApplicationPersistedTaskRequestedEffectV1,
  CurrentPersistedTaskRequestedEffect,
  PersistedTaskRequestedEffectV1,
  TaskAttemptNumberV1,
  TaskDatabaseTimeMsV1,
  TaskRequestedEffectSequenceV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../src/runAttempt/Model.js";
import {
  decideTaskRunListRefetch,
  decideTaskRunRefetch,
  makeTaskReadRefreshRequired,
  projectTaskRunInvalidation,
  type TaskReadInvalidation,
  type TaskRunListPage,
  type TaskRunProjection,
} from "../src/runProjection/index.js";

const taskRunId = Brand.nominal<TaskRunIdV1>();
const taskRunVersion = Brand.nominal<TaskRunVersionV1>();
const effectSequence = Brand.nominal<TaskRequestedEffectSequenceV1>();
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const attemptNumber = Brand.nominal<TaskAttemptNumberV1>();
const RUN_A = taskRunId("run_00000000-0000-4000-8000-0000000000d1");
const RUN_B = taskRunId("run_00000000-0000-4000-8000-0000000000d2");

describe("Task read invalidation policy", () => {
  it("projects only the durable current-state notification intent", () => {
    const projected = projectApplicationInvalidation(
      applicationNotify(RUN_A, 3n),
    );
    const current = projectCurrentInvalidation(currentNotify(RUN_A, 3n));

    expect(Option.getOrThrow(projected)).toEqual({
      kind: "run_advanced",
      runId: RUN_A,
      runVersion: taskRunVersion(3n),
    });
    expect(Option.getOrThrow(current)).toEqual(Option.getOrThrow(projected));
    expect(Object.isFrozen(Option.getOrThrow(projected))).toBe(true);
    expect(Option.isNone(projectTaskRunInvalidation(lifecycleEvent()))).toBe(true);
  });

  it("refetches a point only for a newer matching run", () => {
    const current = projection(RUN_A, 3n);

    expect(decideTaskRunRefetch(current, advanced(RUN_A, 4n))).toEqual({
      kind: "refetch",
      reason: "run_advanced",
    });
    expect(decideTaskRunRefetch(current, advanced(RUN_A, 3n))).toEqual({
      kind: "ignore",
      reason: "covered",
    });
    expect(decideTaskRunRefetch(current, advanced(RUN_A, 2n))).toEqual({
      kind: "ignore",
      reason: "covered",
    });
    expect(decideTaskRunRefetch(current, advanced(RUN_B, 9n))).toEqual({
      kind: "ignore",
      reason: "different_run",
    });
  });

  it("refetches a list for a newer or not-yet-listed run", () => {
    const current = page(projection(RUN_A, 3n));

    expect(decideTaskRunListRefetch(current, advanced(RUN_A, 4n))).toEqual({
      kind: "refetch",
      reason: "run_advanced",
    });
    expect(decideTaskRunListRefetch(current, advanced(RUN_A, 3n))).toEqual({
      kind: "ignore",
      reason: "covered",
    });
    expect(decideTaskRunListRefetch(current, advanced(RUN_A, 2n))).toEqual({
      kind: "ignore",
      reason: "covered",
    });
    expect(decideTaskRunListRefetch(current, advanced(RUN_B, 1n))).toEqual({
      kind: "refetch",
      reason: "run_not_in_page",
    });
  });

  it.each(["reconnected", "cursor_gap"] as const)(
    "forces point and list refetch after %s",
    reason => {
      const invalidation = makeTaskReadRefreshRequired(reason);

      expect(decideTaskRunRefetch(projection(RUN_A, 3n), invalidation))
        .toEqual({ kind: "refetch", reason });
      expect(decideTaskRunListRefetch(
        page(projection(RUN_A, 3n)),
        invalidation,
      )).toEqual({ kind: "refetch", reason });
      expect(Object.isFrozen(invalidation)).toBe(true);
    },
  );

  it("returns frozen decisions without mutating authoritative projections", () => {
    const current = projection(RUN_A, 3n);
    const point = decideTaskRunRefetch(current, advanced(RUN_A, 4n));
    const listed = decideTaskRunListRefetch(page(current), advanced(RUN_B, 1n));

    expect(Object.isFrozen(point)).toBe(true);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(current.runVersion).toBe(taskRunVersion(3n));
  });
});

function advanced(
  runId: TaskRunIdV1,
  version: bigint,
): TaskReadInvalidation {
  return Object.freeze({
    kind: "run_advanced",
    runId,
    runVersion: taskRunVersion(version),
  });
}

function applicationNotify(
  runId: TaskRunIdV1,
  version: bigint,
): ApplicationPersistedTaskRequestedEffectV1 {
  return Object.freeze({
    sequence: effectSequence(2n),
    effect: Object.freeze({
      version: "flarex.task-requested-effect.v1",
      kind: "notify_current_state",
      runId,
      acceptedRunVersion: taskRunVersion(version),
    }),
  });
}

function currentNotify(
  runId: TaskRunIdV1,
  version: bigint,
): CurrentPersistedTaskRequestedEffect {
  return Object.freeze({
    sequence: effectSequence(2n),
    effect: Object.freeze({
      version: "flarex.task-requested-effect.v1",
      kind: "notify_current_state",
      runId,
      acceptedRunVersion: taskRunVersion(version),
    }),
  });
}

function projectApplicationInvalidation(
  requested: ApplicationPersistedTaskRequestedEffectV1,
) {
  return projectTaskRunInvalidation(requested);
}

function projectCurrentInvalidation(
  requested: CurrentPersistedTaskRequestedEffect,
) {
  return projectTaskRunInvalidation(requested);
}

function lifecycleEvent(): PersistedTaskRequestedEffectV1 {
  return Object.freeze({
    sequence: effectSequence(1n),
    effect: Object.freeze({
      version: "flarex.task-requested-effect.v1",
      kind: "publish_lifecycle_event",
      runId: RUN_A,
      acceptedRunVersion: taskRunVersion(3n),
      observedAtMs: databaseTime(2_000),
      event: Object.freeze({
        kind: "attempt_granted",
        attemptNumber: attemptNumber(1),
      }),
    }),
  });
}

function projection(
  runId: TaskRunIdV1,
  version: bigint,
): TaskRunProjection {
  return Object.freeze({
    runId,
    createdAtMs: databaseTime(1_000),
    observedAtMs: databaseTime(2_000),
    runVersion: taskRunVersion(version),
    state: Object.freeze({
      kind: "ready",
      eligibleAtMs: databaseTime(1_000),
      retry: null,
      cancellation: Object.freeze({ kind: "not_requested" }),
    }),
  });
}

function page(...items: TaskRunProjection[]): TaskRunListPage {
  return Object.freeze({
    observedAtMs: databaseTime(2_000),
    items: Object.freeze(items),
    nextCursor: null,
  });
}
