/** Package-private execution-claim supervision mechanics. This owns no admission,
 * permission minting or initial renewal. Each execution profile supplies its real
 * accepting boundary before invoking these shared lifetime mechanics. */
import { Cause, Data, Duration, Effect, Exit, Fiber, Ref, Semaphore } from "effect";
import type { PointMutationExecutionClaimLivenessResultV1, PointMutationExecutionClaimLivenessV1Error } from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";
import type { PointMutationExecutionWorkModeV1 } from "./pointMutationExecutionClaim";
type PointMutationExecutionLivenessPhaseV1 = "executing" | "settlementInFlight" | "settled";
export class PointMutationExecutionLivenessClosedV1Error
  extends Data.TaggedError("PointMutationExecutionLivenessClosedV1Error")<{
    readonly reason:
      | "failedRootRequiresTerminalization"
      | "claimConsumedBeforeFinishing"
      | "initialPhaseMismatch";
  }> {}

export interface PointMutationExecutionLivenessControlV1 {
  /** Keeps renewal serialized with the finite root's final SQL decision. */
  readonly enterSettlement: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  /**
   * Arms the only accepted claim-consumption handshake. The supplied effect
   * must be the existing C05-A transition; arming never changes its outcome.
   */
  readonly enterFinishing: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export const superviseExecutionClaimWork = Effect.fn("PointMutationExecutionLiveness.superviseAdmittedWork")(
  function* <A, E, R>(renewal: Effect.Effect<PointMutationExecutionClaimLivenessResultV1, PointMutationExecutionClaimLivenessV1Error>,
    heartbeatIntervalMilliseconds: number, mode: PointMutationExecutionWorkModeV1,
    use: (control: PointMutationExecutionLivenessControlV1) => Effect.Effect<A, E, R>) {
    const phase = yield* Ref.make<PointMutationExecutionLivenessPhaseV1>(
      "executing",
    );
    const renewalGate = Semaphore.makeUnsafe(1);
    const enterSettlement = <Output, Failure, Requirements>(effect: Effect.Effect<Output, Failure, Requirements>) =>
        renewalGate.withPermit(
          Ref.set(phase, "settlementInFlight").pipe(
            Effect.andThen(
              Effect.onExit(effect, (exit) =>
                Exit.isSuccess(exit)
                  ? Ref.set(phase, "settled")
                  : Effect.void
              ),
            ),
          ),
        );
    const control: PointMutationExecutionLivenessControlV1 = Object.freeze({
      enterSettlement,
      enterFinishing: enterSettlement,
    });

    const heartbeat = Effect.forever(
      Effect.sleep(Duration.millis(heartbeatIntervalMilliseconds)).pipe(
        Effect.andThen(Effect.gen(function* () {
          const disposition = yield* renewalGate.withPermit(
            Effect.gen(function* () {
              if ((yield* Ref.get(phase)) === "settled") {
                return "park" as const;
              }
              const result = yield* renewal;
              const settledPhase = yield* Ref.get(phase);
              yield* requireLiveRenewal(
                result,
                mode,
                settledPhase,
                false,
              );
              return "continue" as const;
            }),
          );
          if (disposition === "park") return yield* Effect.never;
        })),
      ),
    );

    return yield* superviseLiveness(use(control), heartbeat);
  });

export const requireInitialLiveRenewal = (result: PointMutationExecutionClaimLivenessResultV1,
  mode: PointMutationExecutionWorkModeV1) => requireLiveRenewal(result, mode, "executing", true);

const requireLiveRenewal = Effect.fn(
  "PointMutationExecutionLiveness.requireLiveRenewal",
)(function* (
  result: PointMutationExecutionClaimLivenessResultV1,
  mode: PointMutationExecutionWorkModeV1,
  phase: PointMutationExecutionLivenessPhaseV1,
  initial: boolean,
) {
  switch (result.kind) {
    case "renewed":
      if (
        initial &&
        ((mode === "execute" && result.phase !== "open") ||
          (mode === "finishOnly" && result.phase !== "sealed") ||
          (mode === "replaceRelationConflict" &&
            result.phase !== "relationConflicted"))
      ) {
        return yield* Effect.fail(
          new PointMutationExecutionLivenessClosedV1Error({
            reason: "initialPhaseMismatch",
          }),
        );
      }
      return;
    case "terminalizationRequired":
      return yield* Effect.fail(
        new PointMutationExecutionLivenessClosedV1Error({
          reason: "failedRootRequiresTerminalization",
        }),
      );
    case "consumedByFinishing":
      if (phase !== "executing") return yield* Effect.never;
      return yield* Effect.fail(
        new PointMutationExecutionLivenessClosedV1Error({
          reason: "claimConsumedBeforeFinishing",
        }),
      );
  }
});

type SupervisedWinner<A, E, LivenessError> =
  | Readonly<{ readonly source: "body"; readonly exit: Exit.Exit<A, E> }>
  | Readonly<{
      readonly source: "heartbeat";
      readonly exit: Exit.Exit<never, LivenessError>;
    }>;

const superviseLiveness = Effect.fn(
  "PointMutationExecutionLiveness.supervise",
)(function* <A, E, R, LivenessError>(
  body: Effect.Effect<A, E, R>,
  heartbeat: Effect.Effect<never, LivenessError>,
) {
  return yield* Effect.scoped(Effect.gen(function* () {
    const bodyFiber = yield* Effect.forkScoped(body);
    const heartbeatFiber = yield* Effect.forkScoped(heartbeat);
    const winner = yield* Effect.raceFirst(
      Fiber.await(bodyFiber).pipe(
        Effect.map((exit): SupervisedWinner<A, E, LivenessError> =>
          Object.freeze({ source: "body", exit })
        ),
      ),
      Fiber.await(heartbeatFiber).pipe(
        Effect.map((exit): SupervisedWinner<A, E, LivenessError> =>
          Object.freeze({ source: "heartbeat", exit })
        ),
      ),
    );

    if (winner.source === "body") {
      yield* Fiber.interrupt(heartbeatFiber);
      const heartbeatExit = yield* Fiber.await(heartbeatFiber);
      if (
        Exit.isFailure(heartbeatExit) &&
        !isOnlyInterruption(heartbeatExit.cause)
      ) {
        const cause = Exit.isFailure(winner.exit)
          ? Cause.combine(winner.exit.cause, heartbeatExit.cause)
          : heartbeatExit.cause;
        return yield* Effect.failCause(cause);
      }
      return yield* winner.exit;
    }

    yield* Fiber.interrupt(bodyFiber);
    const bodyExit = yield* Fiber.await(bodyFiber);
    if (Exit.isSuccess(winner.exit)) {
      return yield* Effect.die(
        new Error("execution-claim heartbeat completed unexpectedly"),
      );
    }
    const cause = Exit.isFailure(bodyExit) && !isOnlyInterruption(bodyExit.cause)
      ? Cause.combine(winner.exit.cause, bodyExit.cause)
      : winner.exit.cause;
    return yield* Effect.failCause(cause);
  }));
});

function isOnlyInterruption<E>(cause: Cause.Cause<E>): boolean {
  return cause.reasons.length > 0 &&
    cause.reasons.every(Cause.isInterruptReason);
}
