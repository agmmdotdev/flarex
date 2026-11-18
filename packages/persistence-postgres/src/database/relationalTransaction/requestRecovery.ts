import { Cause, Effect } from "effect";

export interface RequestRecoveryPolicy<Failure> {
  readonly hasRequestKey: boolean;
  readonly projectFailure: (failure: unknown) => Failure;
  readonly isDecisionUncertain: (failure: Failure) => boolean;
  /** Participant-owned local state only; runs before recovery-only re-entry. */
  readonly beforeRecovery?: (failure: Failure) => void;
}

/** Reconciles an uncertain outcome once. It never retries business execution. */
export const runWithRequestRecovery = Effect.fn("RelationalRequest.recover")(
  <Value, InputFailure, Failure, Requirements>(
    attempt: (recoverOnly: boolean) => Effect.Effect<Value, InputFailure, Requirements>,
    policy: RequestRecoveryPolicy<Failure>,
  ): Effect.Effect<Value, Failure, Requirements> =>
    attempt(false).pipe(Effect.catchCause(foreignCause => {
      const cause = Cause.map(foreignCause, policy.projectFailure);
      const reason = cause.reasons[0];
      if (policy.hasRequestKey && cause.reasons.length === 1 &&
        reason !== undefined && Cause.isFailReason(reason) &&
        policy.isDecisionUncertain(reason.error)) {
        policy.beforeRecovery?.(reason.error);
        return attempt(true).pipe(Effect.catchCause(recovery =>
          Effect.failCause(Cause.combine(cause, Cause.map(recovery, policy.projectFailure)))));
      }
      return Effect.failCause(cause);
    })),
);
