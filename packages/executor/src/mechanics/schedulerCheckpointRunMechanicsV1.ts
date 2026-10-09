import { Cause, Effect, Exit } from "effect";

/**
 * Operation-local state shared by scheduler runners. `cleanupAllowed` is true
 * only while the last settled scheduler observation proves that release is a
 * safe cleanup rather than a guess about an in-flight database decision.
 */
export interface SchedulerCheckpointCleanupStateV1<Run> {
  readonly run: Run;
  cleanupAllowed: boolean;
}

export function retrySchedulerCheckpointOnceOnConfirmedRollbackV1<
  A,
  E,
  Rollback extends E,
>(
  operation: () => Effect.Effect<A, E, never>,
  isConfirmedRollback: (error: E) => error is Rollback,
  retryAdmitted: () => Effect.Effect<boolean, never, never>,
): Effect.Effect<A, E, never> {
  return operation().pipe(Effect.catch((error) => {
    if (!isConfirmedRollback(error)) return Effect.fail(error);
    return retryAdmitted().pipe(Effect.flatMap((admitted) =>
      admitted ? operation() : Effect.fail(error)
    ));
  }));
}

export function runWithSchedulerCheckpointCleanupV1<
  Run,
  Value,
  Failure,
  Requirements,
  ReleaseFailure,
  ReleaseRequirements,
>(
  state: SchedulerCheckpointCleanupStateV1<Run>,
  body: Effect.Effect<Value, Failure, Requirements>,
  release: (
    run: Run,
  ) => Effect.Effect<unknown, ReleaseFailure, ReleaseRequirements>,
): Effect.Effect<
  Value,
  Failure | ReleaseFailure,
  Requirements | ReleaseRequirements
> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(restore(body));
      if (Exit.isSuccess(exit)) return exit.value;
      if (!state.cleanupAllowed) return yield* Effect.failCause(exit.cause);

      state.cleanupAllowed = false;
      const cleanupExit = yield* Effect.exit(release(state.run));
      return yield* Exit.isSuccess(cleanupExit)
        ? Effect.failCause(exit.cause)
        : Effect.failCause(Cause.combine(exit.cause, cleanupExit.cause));
    })
  );
}
