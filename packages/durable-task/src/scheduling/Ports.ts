import type { Effect } from "effect";
import type {
  PersistedTaskRequestedEffectV1,
  TaskRequestedEffectV1,
  TaskRetryJitterV1,
  TaskRunIdV1,
} from "../runAttempt/Model.js";
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

type TaskRetryRequestedEffectV1 = Extract<
  TaskRequestedEffectV1,
  { readonly kind: "continue_retry" | "wake_retry" }
>;

type TaskWakeRetryRequestedEffectV1 =
  Omit<TaskRetryRequestedEffectV1, "kind"> & {
    readonly kind: "wake_retry";
  };

type TaskLeaseExpiryWakeRequestedEffectV1 = Extract<
  TaskRequestedEffectV1,
  { readonly kind: "wake_lease_expiry" }
>;

export type TaskWakeRequestedEffectV1 =
  Omit<PersistedTaskRequestedEffectV1, "effect"> & {
    readonly effect:
      | TaskWakeRetryRequestedEffectV1
      | TaskLeaseExpiryWakeRequestedEffectV1;
  };

/** Publishes only non-authoritative retry and lease-expiry wake hints. */
export interface TaskWakeHintPublisherV1<Failure> {
  readonly publish: (
    requested: TaskWakeRequestedEffectV1,
  ) => Effect.Effect<void, Failure>;
}
