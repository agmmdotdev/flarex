import type { Brand } from "effect";

import type {
  PersistedTaskRequestedEffectV1,
  TaskAttemptIdV1,
  TaskDatabaseTimeMsV1,
  TaskExecutionFenceV1,
  TaskLeaseVersionV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../runAttempt/Model.js";
import type {
  TaskRunAttemptDueKindV1,
  TaskRequestedEffectPersistenceCursorV1,
} from "../runAttempt/PersistenceProjection.js";

export const MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1 = 100;

export type TaskSystemReadPageSizeV1 = Brand.Branded<
  number,
  "FlarexDurableTask/TaskSystemReadPageSizeV1"
>;

export interface TaskDueDiscoveryCursorV1 {
  readonly version: 1;
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly throughMs: TaskDatabaseTimeMsV1;
  readonly dueAtMs: TaskDatabaseTimeMsV1;
  readonly runId: TaskRunIdV1;
}

export interface TaskDueDiscoveryRequestV1 {
  readonly version: 1;
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly pageSize: TaskSystemReadPageSizeV1;
  readonly cursor: TaskDueDiscoveryCursorV1 | null;
}

export type TaskDueDiscoveryCandidateV1 =
  | Readonly<{
      readonly kind: "start_attempt";
      readonly dueAtMs: TaskDatabaseTimeMsV1;
      readonly runId: TaskRunIdV1;
      readonly expectedRunVersion: TaskRunVersionV1;
    }>
  | Readonly<{
      readonly kind: "handle_lease_expiry";
      readonly dueAtMs: TaskDatabaseTimeMsV1;
      readonly runId: TaskRunIdV1;
      readonly attemptId: TaskAttemptIdV1;
      readonly executionFence: TaskExecutionFenceV1;
      readonly expectedLeaseVersion: TaskLeaseVersionV1;
    }>;

export interface TaskDueDiscoveryPageV1 {
  readonly version: 1;
  readonly dueKind: TaskRunAttemptDueKindV1;
  readonly throughMs: TaskDatabaseTimeMsV1;
  readonly candidates: ReadonlyArray<TaskDueDiscoveryCandidateV1>;
  readonly nextCursor: TaskDueDiscoveryCursorV1 | null;
}

export interface TaskRequestedEffectPageCursorV1 {
  readonly version: 1;
  readonly runId: TaskRunIdV1;
  readonly throughSequence: TaskRequestedEffectPersistenceCursorV1;
  readonly afterSequence: TaskRequestedEffectPersistenceCursorV1;
}

export interface TaskRequestedEffectPageRequestV1 {
  readonly version: 1;
  readonly runId: TaskRunIdV1;
  readonly pageSize: TaskSystemReadPageSizeV1;
  readonly cursor: TaskRequestedEffectPageCursorV1 | null;
}

export interface TaskRequestedEffectPageV1 {
  readonly version: 1;
  readonly runId: TaskRunIdV1;
  readonly throughSequence: TaskRequestedEffectPersistenceCursorV1;
  readonly effects: ReadonlyArray<PersistedTaskRequestedEffectV1>;
  readonly nextCursor: TaskRequestedEffectPageCursorV1 | null;
}
