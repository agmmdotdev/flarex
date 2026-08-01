import { Effect, Scope } from "effect";

export interface PrivateApplicationRevisionReadinessSettlementPortV1<
  Ready,
  Failure,
> {
  readonly settleApplicationRevisionReadinessV1: (
    revisionId: string,
  ) => Effect.Effect<Ready, Failure, Scope.Scope>;
}

export interface PrivateApplicationRevisionReadinessCoordinatorV1<
  Ready,
  Failure,
> {
  readonly settle: (
    revisionId: string,
  ) => Effect.Effect<Ready, Failure, Scope.Scope>;
}

/**
 * Private deployment composition root for non-activating readiness.
 *
 * The coordinator deliberately owns no persistence, locator, R2, verdict, or
 * activation authority. It consumes only the scoped settlement capability
 * supplied by the target-native S03-D4 owner and preserves its exact E/R
 * channels.
 */
export function makePrivateApplicationRevisionReadinessCoordinatorV1<
  Ready,
  Failure,
>(
  port: PrivateApplicationRevisionReadinessSettlementPortV1<Ready, Failure>,
): PrivateApplicationRevisionReadinessCoordinatorV1<Ready, Failure> {
  return Object.freeze({
    settle: Effect.fn("DeploymentCoordinator.settleRevisionReadiness")(
      (revisionId: string) =>
        port.settleApplicationRevisionReadinessV1(revisionId),
    ),
  });
}
