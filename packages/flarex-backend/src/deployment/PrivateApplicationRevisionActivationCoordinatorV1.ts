import { Effect, Scope } from "effect";

export interface PrivateApplicationRevisionActivationPortV1<
  Activated,
  Active,
  ExpectedActive,
  ActivationContext,
  ActivateFailure,
  ReadFailure,
> {
  readonly activateApplicationRevisionV1: (
    revisionId: string,
    expectedActiveRevision: ExpectedActive | null,
    context: ActivationContext,
  ) => Effect.Effect<Activated, ActivateFailure, Scope.Scope>;
  readonly readActiveApplicationRevisionV1: (
    context: ActivationContext,
  ) => Effect.Effect<Active, ReadFailure, Scope.Scope>;
}

export interface PrivateApplicationRevisionActivationCoordinatorV1<
  Activated,
  Active,
  ExpectedActive,
  ActivationContext,
  ActivateFailure,
  ReadFailure,
> {
  readonly activate: (
    revisionId: string,
    expectedActiveRevision: ExpectedActive | null,
    context: ActivationContext,
  ) => Effect.Effect<Activated, ActivateFailure, Scope.Scope>;
  readonly readActive: (
    context: ActivationContext,
  ) => Effect.Effect<Active, ReadFailure, Scope.Scope>;
}

/**
 * Private deployment composition root for FSV05 activation and coherent reads.
 *
 * This coordinator owns no locator, persistence, readiness, activation, CAS,
 * routing, or runtime-selection authority. It preserves the supplied port's
 * exact scoped lifetime and typed failure channels.
 */
export function makePrivateApplicationRevisionActivationCoordinatorV1<
  Activated,
  Active,
  ExpectedActive,
  ActivationContext,
  ActivateFailure,
  ReadFailure,
>(
  port: PrivateApplicationRevisionActivationPortV1<
    Activated,
    Active,
    ExpectedActive,
    ActivationContext,
    ActivateFailure,
    ReadFailure
  >,
): PrivateApplicationRevisionActivationCoordinatorV1<
  Activated,
  Active,
  ExpectedActive,
  ActivationContext,
  ActivateFailure,
  ReadFailure
> {
  return Object.freeze({
    activate: Effect.fn("DeploymentCoordinator.activateApplicationRevision")(
      (
        revisionId: string,
        expectedActiveRevision: ExpectedActive | null,
        context: ActivationContext,
      ) => port.activateApplicationRevisionV1(
        revisionId,
        expectedActiveRevision,
        context,
      ),
    ),
    readActive: Effect.fn("DeploymentCoordinator.readActiveApplicationRevision")(
      (context: ActivationContext) =>
        port.readActiveApplicationRevisionV1(context),
    ),
  });
}
