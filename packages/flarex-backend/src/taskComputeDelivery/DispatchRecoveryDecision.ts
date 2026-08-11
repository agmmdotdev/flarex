/**
 * Seam adaptation of Trigger.dev's WarmStartVerificationService.verify.
 *
 * Trigger source: third_party/trigger.dev/upstream/apps/supervisor/src/services/warmStartVerificationService.ts
 * Pinned commit: f10bc23785e569e5d917318cf2033aabdbe96a0b.
 */
export type TaskComputeDispatchRecoveryObservation =
  | Readonly<{ readonly kind: "state_moved" }>
  | Readonly<{ readonly kind: "state_unchanged" }>
  | Readonly<{ readonly kind: "probe_uncertain" }>;

export type TaskComputeDispatchRecoveryDecision =
  | Readonly<{ readonly kind: "do_not_replay"; readonly reason: "state_moved" }>
  | Readonly<{ readonly kind: "replay_same_identity" }>
  | Readonly<{
      readonly kind: "do_not_decide";
      readonly reason: "probe_uncertain";
    }>;

export function decideTaskComputeDispatchRecovery(
  observation: TaskComputeDispatchRecoveryObservation,
): TaskComputeDispatchRecoveryDecision {
  switch (observation.kind) {
    case "state_moved":
      return Object.freeze({
        kind: "do_not_replay" as const,
        reason: "state_moved" as const,
      });
    case "state_unchanged":
      return Object.freeze({ kind: "replay_same_identity" as const });
    case "probe_uncertain":
      return Object.freeze({
        kind: "do_not_decide" as const,
        reason: "probe_uncertain" as const,
      });
  }
}
