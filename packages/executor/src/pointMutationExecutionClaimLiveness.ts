import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  Data,
  Effect,
  Result,
  Scope,
} from "effect";

import type {
  PointMutationExecutionClaimLivenessV1,
  PointMutationExecutionClaimLivenessV1Error,
} from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";

import type {
  PointMutationExecutionClaimAdmissionV1,
  PointMutationExecutionScopeV1,
  PointMutationExecutionWorkModeV1,
  InvalidPointMutationExecutionClaimV1Error,
} from "./pointMutationExecutionClaim";

import { superviseExecutionClaimWork, requireInitialLiveRenewal, PointMutationExecutionLivenessClosedV1Error } from "./pointMutationExecutionClaimSupervision";
export { PointMutationExecutionLivenessClosedV1Error } from "./pointMutationExecutionClaimSupervision";
export type { PointMutationExecutionLivenessControlV1 } from "./pointMutationExecutionClaimSupervision";
import type { PointMutationExecutionLivenessControlV1 } from "./pointMutationExecutionClaimSupervision";

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


export type PointMutationExecutionLivenessV1Error =
  | InvalidPointMutationExecutionClaimV1Error
  | PointMutationExecutionLivenessConfigurationV1Error
  | PointMutationExecutionLivenessClosedV1Error
  | PointMutationExecutionClaimLivenessV1Error;

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
    const claim = yield* Effect.fromResult(admission.inspect(scope, mode));
    const renewal = Effect.suspend(() => liveness.renewEffect({ selector: claim.selector,
      executionClaim: { claimOwner: claim.observation.claimOwner, claimFence: claim.observation.claimFence } }));
    yield* requireInitialLiveRenewal(yield* renewal, mode);
    return yield* superviseExecutionClaimWork(renewal, config.heartbeatIntervalMilliseconds, mode, use);
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
  return liveness.configuration.pipe(
    Result.mapError((cause) =>
      new PointMutationExecutionLivenessConfigurationV1Error({
        reason: "invalidPersistenceConfiguration",
        cause,
      }),
    ),
    Result.flatMap((configuration) => {
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
        doubled > configuration.claimDurationMilliseconds
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
    }),
  );
}
