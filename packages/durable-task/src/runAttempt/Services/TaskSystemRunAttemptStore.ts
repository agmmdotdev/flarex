// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Context, type Effect, type Result } from "effect";
import type { RunAttemptDecisionErrorV1, TaskSystemRunAttemptStoreErrorV1 } from "../Errors.js";
import type {
  ApplicationTaskRunAttemptDecisionV1,
  ApplicationTaskSystemRunAttemptDecisionInputV1,
  ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
  ApplicationTaskSystemRunAttemptTransactionReceiptV1,
  TaskSystemRunAttemptInspectionRequestV1,
  TaskSystemRunAttemptInspectionSnapshotV1,
  TaskSystemRunAttemptDecisionInputV1,
  TaskRunAttemptDecisionV1,
  RunAttemptMutationOperationV1,
  TaskRunIdV1,
  TaskSystemRunAttemptTransactionReceiptV1,
} from "../Model.js";

export interface ApplicationTaskSystemRunAttemptTransactionV1<Outcome> {
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly decide: (
    input: ApplicationTaskSystemRunAttemptDecisionInputV1,
  ) => Result.Result<
    ApplicationTaskRunAttemptDecisionV1<Outcome>,
    RunAttemptDecisionErrorV1
  >;
}

export interface ApplicationTaskSystemRunAttemptStoreShape {
  readonly transactRunAttempt: <Outcome>(
    request: ApplicationTaskSystemRunAttemptTransactionV1<Outcome>,
  ) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<Outcome>,
    RunAttemptDecisionErrorV1 | TaskSystemRunAttemptStoreErrorV1
  >;
  readonly inspectRunAttempt: (
    request: TaskSystemRunAttemptInspectionRequestV1,
  ) => Effect.Effect<
    ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
    TaskSystemRunAttemptStoreErrorV1
  >;
}

export interface TaskSystemRunAttemptTransactionV1<Outcome> {
  readonly operation: RunAttemptMutationOperationV1;
  readonly runId: TaskRunIdV1;
  readonly decide: (
    input: TaskSystemRunAttemptDecisionInputV1,
  ) => Result.Result<TaskRunAttemptDecisionV1<Outcome>, RunAttemptDecisionErrorV1>;
}

export interface TaskSystemRunAttemptStoreShape {
  readonly transactRunAttempt: <Outcome>(
    request: TaskSystemRunAttemptTransactionV1<Outcome>,
  ) => Effect.Effect<
    TaskSystemRunAttemptTransactionReceiptV1<Outcome>,
    RunAttemptDecisionErrorV1 | TaskSystemRunAttemptStoreErrorV1
  >;
  readonly inspectRunAttempt: (
    request: TaskSystemRunAttemptInspectionRequestV1,
  ) => Effect.Effect<
    TaskSystemRunAttemptInspectionSnapshotV1,
    TaskSystemRunAttemptStoreErrorV1
  >;
}

/**
 * A dynamically selected, scope-bound Task System capability. Hosts must not
 * provide one instance across tenant scopes.
 */
export class TaskSystemRunAttemptStore extends Context.Service<
  TaskSystemRunAttemptStore,
  TaskSystemRunAttemptStoreShape
>()("FlarexDurableTask/TaskSystemRunAttemptStore") {}
