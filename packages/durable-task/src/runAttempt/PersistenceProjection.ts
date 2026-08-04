import { Brand } from "effect";
import type {
  RunAttemptPhaseV1,
  TaskAttemptIdV1,
  TaskCancellationGenerationV1,
  TaskDatabaseTimeMsV1,
  TaskDefinitionRevisionIdV1,
  TaskExecutionFenceV1,
  TaskLeaseVersionV1,
  TaskRunAttemptAggregateV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "./Model.js";

export type TaskRequestedEffectPersistenceCursorV1 = Brand.Branded<
  bigint,
  "FlarexDurableTask/TaskRequestedEffectPersistenceCursorV1"
>;

export type TaskRunAttemptDueKindV1 =
  | "start_attempt"
  | "handle_lease_expiry";

export interface TaskRunAttemptPersistenceProjectionV1 {
  readonly version: "flarex.task-run-attempt-persistence-projection.v1";
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly runVersion: TaskRunVersionV1;
  readonly phase: RunAttemptPhaseV1;
  readonly dueKind: TaskRunAttemptDueKindV1 | null;
  readonly dueAtMs: TaskDatabaseTimeMsV1 | null;
  readonly currentAttemptId: TaskAttemptIdV1 | null;
  readonly executionFenceBasis: TaskExecutionFenceV1 | null;
  readonly currentLeaseVersion: TaskLeaseVersionV1 | null;
  readonly currentLeaseExpiresAtMs: TaskDatabaseTimeMsV1 | null;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
  readonly requestedEffectSequence: TaskRequestedEffectPersistenceCursorV1;
}

const taskRequestedEffectPersistenceCursor =
  Brand.nominal<TaskRequestedEffectPersistenceCursorV1>();

export function projectTaskRunAttemptPersistenceV1(
  aggregate: TaskRunAttemptAggregateV1,
): TaskRunAttemptPersistenceProjectionV1 {
  const requestedEffectSequence = taskRequestedEffectPersistenceCursor(
    aggregate.requestedEffectCursor.kind === "none"
      ? 0n
      : aggregate.requestedEffectCursor.lastSequence,
  );
  const common = {
    version: "flarex.task-run-attempt-persistence-projection.v1" as const,
    runId: aggregate.runId,
    taskDefinitionRevisionId: aggregate.taskDefinitionRevisionId,
    runVersion: aggregate.runVersion,
    phase: aggregate.phase,
    cancellationGeneration: aggregate.cancellation.generation,
    requestedEffectSequence,
  };
  switch (aggregate.phase) {
    case "ready":
      return Object.freeze({
        ...common,
        dueKind: "start_attempt",
        dueAtMs: aggregate.ready.eligibleAtMs,
        currentAttemptId: null,
        executionFenceBasis: aggregate.ready.kind === "initial"
          ? null
          : aggregate.ready.acceptedRetry.previousAttempt.executionFence,
        currentLeaseVersion: null,
        currentLeaseExpiresAtMs: null,
      });
    case "attempt_granted":
    case "executing":
      return Object.freeze({
        ...common,
        dueKind: "handle_lease_expiry",
        dueAtMs: aggregate.currentAttempt.lease.expiresAtMs,
        currentAttemptId: aggregate.currentAttempt.attemptId,
        executionFenceBasis: aggregate.currentAttempt.executionFence,
        currentLeaseVersion: aggregate.currentAttempt.lease.version,
        currentLeaseExpiresAtMs: aggregate.currentAttempt.lease.expiresAtMs,
      });
    case "retry_waiting":
      return Object.freeze({
        ...common,
        dueKind: "start_attempt",
        dueAtMs: aggregate.retry.notBeforeMs,
        currentAttemptId: null,
        executionFenceBasis: aggregate.retry.previousAttempt.executionFence,
        currentLeaseVersion: null,
        currentLeaseExpiresAtMs: null,
      });
    case "terminal":
      return Object.freeze({
        ...common,
        dueKind: null,
        dueAtMs: null,
        currentAttemptId: null,
        executionFenceBasis: null,
        currentLeaseVersion: null,
        currentLeaseExpiresAtMs: null,
      });
  }
}
