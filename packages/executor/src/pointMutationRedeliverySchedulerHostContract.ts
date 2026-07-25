import type { Effect } from "effect";

/**
 * The lifecycle-free scheduler capability consumed by a platform event host.
 * The host deliberately does not interpret the scheduler's domain result.
 */
export interface PointMutationRedeliverySchedulerHostRunV1<Failure> {
  readonly runEffect: () => Effect.Effect<unknown, Failure, never>;
}
