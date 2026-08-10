import { Context, type Effect } from "effect";

import type {
  TaskComputeCancellationErrorV1,
  TaskComputeDispatchErrorV1,
} from "../Errors.js";
import type {
  TaskComputeCancellationReceiptV1,
  TaskComputeCancellationRequestV1,
  TaskComputeDispatchAcceptanceV1,
  TaskComputeDispatchRequestV1,
} from "../Model.js";

export interface TaskComputeProviderShape {
  readonly dispatch: (
    request: TaskComputeDispatchRequestV1,
  ) => Effect.Effect<TaskComputeDispatchAcceptanceV1, TaskComputeDispatchErrorV1>;
  readonly requestCancellation: (
    request: TaskComputeCancellationRequestV1,
  ) => Effect.Effect<TaskComputeCancellationReceiptV1, TaskComputeCancellationErrorV1>;
}

export class TaskComputeProvider extends Context.Service<
  TaskComputeProvider,
  TaskComputeProviderShape
>()("FlarexDurableTask/TaskComputeProvider") {}
