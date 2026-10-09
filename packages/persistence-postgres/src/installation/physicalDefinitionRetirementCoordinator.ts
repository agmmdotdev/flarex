import { Effect } from "effect";

import {
  PhysicalDefinitionLifecyclePinnedError,
  beginPhysicalDefinitionDrainingEffect,
  finalizePhysicalDefinitionRetirementEffect,
  inspectPhysicalDefinitionLifecycleEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
  type FinalizePhysicalDefinitionRetirementError,
  type InspectPhysicalDefinitionLifecycleError,
  type PhysicalDefinitionLifecyclePort,
  type PhysicalDefinitionLifecycleRetirementResult,
  type PhysicalDefinitionLifecycleSubject,
  type PhysicalDefinitionLifecycleTransitionResult,
  type PreparedPhysicalDefinitionLifecycleSubject,
  type PreparePhysicalDefinitionLifecycleSubjectError,
  type StoredPhysicalDefinitionLifecycle,
  type TransitionPhysicalDefinitionLifecycleError,
} from "./physicalDefinitionLifecycle";
import type { PhysicalDefinitionRetirementPin } from
  "./physicalDefinitionRetirementPins";

export type PhysicalDefinitionRetirementCoordinatorError =
  | PreparePhysicalDefinitionLifecycleSubjectError
  | InspectPhysicalDefinitionLifecycleError
  | TransitionPhysicalDefinitionLifecycleError
  | Exclude<
      FinalizePhysicalDefinitionRetirementError,
      PhysicalDefinitionLifecyclePinnedError
    >;

export type PhysicalDefinitionRetirementStepResult =
  | Readonly<{
      readonly status: "draining";
      readonly disposition:
        PhysicalDefinitionLifecycleTransitionResult["disposition"];
      readonly lifecycle: StoredPhysicalDefinitionLifecycle;
    }>
  | Readonly<{
      readonly status: "waiting";
      readonly reason: "pinned";
      readonly lifecycle: StoredPhysicalDefinitionLifecycle;
      readonly pin: PhysicalDefinitionRetirementPin;
    }>
  | Readonly<{
      readonly status: "retired";
      readonly disposition:
        PhysicalDefinitionLifecycleRetirementResult["disposition"];
      readonly lifecycle: StoredPhysicalDefinitionLifecycle;
    }>
  | Readonly<{
      readonly status: "blocked";
      readonly reason: "reactivating";
      readonly lifecycle: StoredPhysicalDefinitionLifecycle;
    }>;

/**
 * Performs exactly one explicitly requested retirement step. The caller owns
 * every wake; this operation creates no timer, queue, route, or background
 * process.
 *
 * A persisted draining or retired row is accepted only after replaying the
 * request that produced that state. That replay binds a cold invocation to the
 * original prepared definition and schema-binding set before finalization or
 * completion is reported.
 */
export const runPhysicalDefinitionRetirementStepEffect = Effect.fn(
  "PhysicalDefinitionRetirementCoordinator.runStep",
)(function* (
  port: PhysicalDefinitionLifecyclePort,
  subject: PhysicalDefinitionLifecycleSubject,
): Effect.fn.Return<
  PhysicalDefinitionRetirementStepResult,
  PhysicalDefinitionRetirementCoordinatorError
> {
  const prepared = yield* preparePhysicalDefinitionLifecycleSubjectEffect(
    port,
    subject,
  );
  const inspected = yield* inspectPhysicalDefinitionLifecycleEffect(prepared);

  if (inspected.status === "implicitActive") {
    const draining = yield* beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 0n },
    );
    return drainingResult(draining);
  }

  const lifecycle = inspected.lifecycle;
  switch (lifecycle.lifecycle) {
    case "active": {
      const draining = yield* beginPhysicalDefinitionDrainingEffect(
        prepared,
        { expectedTransitionFence: lifecycle.transitionFence },
      );
      return drainingResult(draining);
    }
    case "draining": {
      yield* beginPhysicalDefinitionDrainingEffect(prepared, {
        expectedTransitionFence: lifecycle.transitionFence - 1n,
      });
      return yield* finalizeResultEffect(prepared, lifecycle);
    }
    case "retired": {
      const retired = yield* finalizePhysicalDefinitionRetirementEffect(
        prepared,
        { expectedTransitionFence: lifecycle.transitionFence - 1n },
      ).pipe(
        Effect.catchTag(
          "PhysicalDefinitionLifecyclePinnedError",
          error => Effect.die(error),
        ),
      );
      return retiredResult(retired);
    }
    case "reactivating":
      return Object.freeze({
        status: "blocked" as const,
        reason: "reactivating" as const,
        lifecycle,
      });
  }
});

function finalizeResultEffect(
  prepared: PreparedPhysicalDefinitionLifecycleSubject,
  lifecycle: StoredPhysicalDefinitionLifecycle,
): Effect.Effect<
  PhysicalDefinitionRetirementStepResult,
  Exclude<
    FinalizePhysicalDefinitionRetirementError,
    PhysicalDefinitionLifecyclePinnedError
  >
> {
  return finalizePhysicalDefinitionRetirementEffect(prepared, {
    expectedTransitionFence: lifecycle.transitionFence,
  }).pipe(
    Effect.map(retiredResult),
    Effect.catchTag(
      "PhysicalDefinitionLifecyclePinnedError",
      error => Effect.succeed(Object.freeze({
        status: "waiting" as const,
        reason: "pinned" as const,
        lifecycle,
        pin: error.pin,
      })),
    ),
  );
}

function drainingResult(
  transition: PhysicalDefinitionLifecycleTransitionResult,
): PhysicalDefinitionRetirementStepResult {
  return Object.freeze({
    status: "draining" as const,
    disposition: transition.disposition,
    lifecycle: transition.lifecycle,
  });
}

function retiredResult(
  transition: PhysicalDefinitionLifecycleRetirementResult,
): PhysicalDefinitionRetirementStepResult {
  return Object.freeze({
    status: "retired" as const,
    disposition: transition.disposition,
    lifecycle: transition.lifecycle,
  });
}
