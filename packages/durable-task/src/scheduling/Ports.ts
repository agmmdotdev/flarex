import type { Effect } from "effect";
import type { TaskRetryJitterV1, TaskRunIdV1 } from "../runAttempt/Model.js";
import type {
  TaskDueDiscoveryCandidateV1,
  TaskDueDiscoveryPageV1,
  TaskDueDiscoveryRequestV1,
} from "../runRead/Model.js";
import type { TaskDueCandidateHandlingReceiptV1 } from "./Model.js";

/** A dynamically selected, scope-bound due-work source. */
export interface TaskDueWorkSourceV1<Failure> {
  readonly discoverDueRuns: (
    request: TaskDueDiscoveryRequestV1,
  ) => Effect.Effect<TaskDueDiscoveryPageV1, Failure>;
}

/** A dynamically selected, scope-bound lifecycle adapter. */
export interface TaskDueCandidateHandlerV1<Failure> {
  readonly handle: (
    candidate: TaskDueDiscoveryCandidateV1,
  ) => Effect.Effect<TaskDueCandidateHandlingReceiptV1, Failure>;
}

/** Supplies the one accepted retry-jitter sample captured by a winning start. */
export interface TaskRetryJitterSourceV1 {
  readonly nextRetryJitter: (
    runId: TaskRunIdV1,
  ) => Effect.Effect<TaskRetryJitterV1, never>;
}
