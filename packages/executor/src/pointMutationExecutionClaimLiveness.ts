import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  Cause,
  Data,
  Duration,
  Effect,
  Exit,
  Fiber,
  Ref,
  Result,
  Semaphore,
  Scope,
} from "effect";

import type {
  PointMutationExecutionClaimLivenessV1,
  PointMutationExecutionClaimLivenessResultV1,
  PointMutationExecutionClaimLivenessV1Error,
} from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";

import type {
  PointMutationExecutionClaimAdmissionV1,
  PointMutationExecutionScopeV1,
  PointMutationExecutionWorkModeV1,
  InvalidPointMutationExecutionClaimV1Error,
} from "./pointMutationExecutionClaim";

type PointMutationExecutionLivenessPhaseV1 =
  | "executing"
  | "finishingInFlight"
  | "finishingCommitted";

export class PointMutationExecutionLivenessConfigurationV1Error
  extends Data.TaggedError(
    "PointMutationExecutionLivenessConfigurationV1Error",
  )<{
    readonly reason:
      | "invalidPersistenceConfiguration"
      | "invalidHeartbeatInterval"
      | "heartbeatIntervalExceedsClaimHeadroom";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionLivenessClosedV1Error
  extends Data.TaggedError("PointMutationExecutionLivenessClosedV1Error")<{
    readonly reason:
      | "failedRootRequiresTerminalization"
      | "claimConsumedBeforeFinishing"
      | "initialPhaseMismatch";
  }> {}

export type PointMutationExecutionLivenessV1Error =
  | InvalidPointMutationExecutionClaimV1Error
  | PointMutationExecutionLivenessConfigurationV1Error
  | PointMutationExecutionLivenessClosedV1Error
  | PointMutationExecutionClaimLivenessV1Error;

export interface PointMutationExecutionLivenessControlV1 {
  /**
   * Arms the only accepted claim-consumption handshake. The supplied effect
   * must be the existing C05-A transition; arming never changes its outcome.
   */
  readonly enterFinishing: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export interface PointMutationExecutionLivenessCoordinatorV1 {
  readonly run: <A, E, R>(
    scope: PointMutationExecutionScopeV1,
    mode: PointMutationExecutionWorkModeV1,
    use: (
      control: PointMutationExecutionLivenessControlV1,
    ) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    E | PointMutationExecutionLivenessV1Error,
    Exclude<R, Scope.Scope>
  >;
}

export interface PointMutationExecutionLivenessCoordinatorOptionsV1 {
  readonly heartbeatIntervalMilliseconds: number;
}

export function createPointMutationExecutionLivenessCoordinatorV1(
  admission: PointMutationExecutionClaimAdmissionV1,
  liveness: PointMutationExecutionClaimLivenessV1,
  options: PointMutationExecutionLivenessCoordinatorOptionsV1,
): PointMutationExecutionLivenessCoordinatorV1 {
  const configuration =
    validatePointMutationExecutionLivenessConfigurationV1Result(
      liveness,
      options,
    );

  const run: PointMutationExecutionLivenessCoordinatorV1["run"] = Effect.fn(
    "PointMutationExecutionLiveness.run",
  )(function* (scope, mode, use) {
    const config = yield* Effect.fromResult(configuration);
    // Inspect the already-admitted same-factory scope before the first yield
    // owned by the caller's expensive execution/finishing flow.
    const claim = yield* Effect.fromResult(admission.inspect(scope, mode));
    const renewalInput = Object.freeze({
      selector: claim.selector,
      executionClaim: Object.freeze({
        claimOwner: claim.observation.claimOwner,
        claimFence: claim.observation.claimFence,
      }),
    });
    const phase = yield* Ref.make<PointMutationExecutionLivenessPhaseV1>(
      "executing",
    );
    const renewalGate = Semaphore.makeUnsafe(1);
    const control: PointMutationExecutionLivenessControlV1 = Object.freeze({
      enterFinishing: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        renewalGate.withPermit(
          Ref.set(phase, "finishingInFlight").pipe(
            Effect.andThen(
              Effect.onExit(effect, (exit) =>
                Exit.isSuccess(exit)
                  ? Ref.set(phase, "finishingCommitted")
                  : Effect.void
              ),
            ),
          ),
        ),
    });

    yield* requireLiveRenewal(
      yield* liveness.renewEffect(renewalInput),
      mode,
      "executing",
      true,
    );

    const heartbeat = Effect.forever(
      Effect.sleep(Duration.millis(config.heartbeatIntervalMilliseconds)).pipe(
        Effect.andThen(Effect.gen(function* () {
          const disposition = yield* renewalGate.withPermit(
            Effect.gen(function* () {
              if ((yield* Ref.get(phase)) === "finishingCommitted") {
                return "park" as const;
              }
              const result = yield* liveness.renewEffect(renewalInput);
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

  return Object.freeze({ run });
}

export function validatePointMutationExecutionLivenessConfigurationV1Result(
  liveness: PointMutationExecutionClaimLivenessV1,
  options: PointMutationExecutionLivenessCoordinatorOptionsV1,
): Result.Result<
  Readonly<{
    readonly heartbeatIntervalMilliseconds: number;
  }>,
  PointMutationExecutionLivenessConfigurationV1Error
> {
  if (Result.isFailure(liveness.configuration)) {
    return Result.fail(
      new PointMutationExecutionLivenessConfigurationV1Error({
        reason: "invalidPersistenceConfiguration",
        cause: liveness.configuration.failure,
      }),
    );
  }
  const heartbeat = options.heartbeatIntervalMilliseconds;
  if (!isPositiveSafeInteger(heartbeat)) {
    return Result.fail(
      new PointMutationExecutionLivenessConfigurationV1Error({
        reason: "invalidHeartbeatInterval",
      }),
    );
  }
  const doubled = heartbeat * 2;
  if (
    !Number.isSafeInteger(doubled) ||
    doubled > liveness.configuration.success.claimDurationMilliseconds
  ) {
    return Result.fail(
      new PointMutationExecutionLivenessConfigurationV1Error({
        reason: "heartbeatIntervalExceedsClaimHeadroom",
      }),
    );
  }
  return Result.succeed(Object.freeze({
    heartbeatIntervalMilliseconds: heartbeat,
  }));
}

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
          (mode === "finishOnly" && result.phase !== "sealed"))
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
