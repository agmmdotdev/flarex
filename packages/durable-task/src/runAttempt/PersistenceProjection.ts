import { Brand } from "effect";
import type {
  ApplicationTaskRunAttemptAggregateV1,
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
import type { ApplicationTaskRuntimeTargetSha256V1 } from
  "../runCreation/Model.js";

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

export type ApplicationTaskRunAttemptPersistenceProjectionV1 = Omit<
  TaskRunAttemptPersistenceProjectionV1,
  "taskDefinitionRevisionId"
> & Readonly<{
  readonly applicationTaskRuntimeTargetSha256:
    ApplicationTaskRuntimeTargetSha256V1;
}>;

const taskRequestedEffectPersistenceCursor =
  Brand.nominal<TaskRequestedEffectPersistenceCursorV1>();

export function projectTaskRunAttemptPersistenceV1(
  aggregate: TaskRunAttemptAggregateV1,
): TaskRunAttemptPersistenceProjectionV1 {
  return Object.freeze({
    ...projectCurrentTaskRunAttemptPersistence(aggregate),
    taskDefinitionRevisionId: aggregate.taskDefinitionRevisionId,
  });
}

export function projectApplicationTaskRunAttemptPersistenceV1(
  aggregate: ApplicationTaskRunAttemptAggregateV1,
): ApplicationTaskRunAttemptPersistenceProjectionV1 {
  const projected = projectCurrentTaskRunAttemptPersistence(aggregate);
  return Object.freeze({
    ...projected,
    applicationTaskRuntimeTargetSha256:
      aggregate.applicationTaskRuntimeTargetSha256,
  });
}

function projectCurrentTaskRunAttemptPersistence(
  aggregate: TaskRunAttemptAggregateV1 | ApplicationTaskRunAttemptAggregateV1,
): Omit<TaskRunAttemptPersistenceProjectionV1, "taskDefinitionRevisionId"> {
  const requestedEffectSequence = taskRequestedEffectPersistenceCursor(
    aggregate.requestedEffectCursor.kind === "none"
      ? 0n
      : aggregate.requestedEffectCursor.lastSequence,
  );
  const common = {
    version: "flarex.task-run-attempt-persistence-projection.v1" as const,
    runId: aggregate.runId,
    runVersion: aggregate.runVersion,
    phase: aggregate.phase,
    cancellationGeneration: aggregate.cancellation.generation,
    requestedEffectSequence,
  };
  switch (aggregate.phase) {
    case "ready": return Object.freeze({
      ...common,
      dueKind: "start_attempt" as const,
      dueAtMs: aggregate.ready.eligibleAtMs,
      currentAttemptId: null,
      executionFenceBasis: aggregate.ready.kind === "initial"
        ? null
        : aggregate.ready.acceptedRetry.previousAttempt.executionFence,
      currentLeaseVersion: null,
      currentLeaseExpiresAtMs: null,
    });
    case "attempt_granted":
    case "executing": return Object.freeze({
      ...common,
      dueKind: "handle_lease_expiry" as const,
      dueAtMs: aggregate.currentAttempt.lease.expiresAtMs,
      currentAttemptId: aggregate.currentAttempt.attemptId,
      executionFenceBasis: aggregate.currentAttempt.executionFence,
      currentLeaseVersion: aggregate.currentAttempt.lease.version,
      currentLeaseExpiresAtMs: aggregate.currentAttempt.lease.expiresAtMs,
    });
    case "retry_waiting": return Object.freeze({
      ...common,
      dueKind: "start_attempt" as const,
      dueAtMs: aggregate.retry.notBeforeMs,
      currentAttemptId: null,
      executionFenceBasis: aggregate.retry.previousAttempt.executionFence,
      currentLeaseVersion: null,
      currentLeaseExpiresAtMs: null,
    });
    case "terminal": return Object.freeze({
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
