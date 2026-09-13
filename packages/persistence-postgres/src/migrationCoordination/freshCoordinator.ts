/**
 * Existing coordinator entry point and bounded run orchestration. Lifecycle operations
 * remain source-private; no new package exports or execution profile are introduced.
 */
import { captureFrameworkMigrationBaseReferenceEffect, loadFrameworkMigrationPlanEffect, prepareFrameworkMigrationDefinition } from "./definition";
import {
  withFrameworkMigrationPlanVerification,
} from "./canonical";
import { withAdditiveMigrationGraphLimits } from "./graphLimits";
import { Effect, Option } from "effect";
import type { FrameworkMigrationBaseInstallation } from "./model";
import {
  type FrameworkMigrationCoordinatorFailure,
  type RunFreshFrameworkMigrationCoordinatorInput,
  type RunAdditiveFrameworkMigrationCoordinatorInput,
  type FrameworkMigrationPendingResult,
  type FreshFrameworkMigrationCoordinatorResult,
  coordinatorError,
} from "./coordinatorContracts";
import { type FrameworkMigrationClaim, readFrameworkMigrationClaimProgressEffect } from "./coordinatorClaim";
import {
  prepareCoordinatorDefinitionWithRecoveryEffect,
  claimCoordinatorAttemptEffect,
} from "./coordinatorPreparation";
import { executeNextFrameworkMigrationStepEffect } from "./coordinatorStep";
import { finalizeFrameworkMigrationClaimEffect, readReadyResultEffect } from "./coordinatorFinalization";

export {
  FrameworkMigrationCoordinatorError,
  type FrameworkMigrationCoordinatorFailure,
  type RunFreshFrameworkMigrationCoordinatorInput,
  type RunAdditiveFrameworkMigrationCoordinatorInput,
  type FrameworkMigrationReadyResult,
  type FrameworkMigrationPendingResult,
  type FrameworkMigrationBusyResult,
  type FrameworkMigrationNotReadyResult,
  type FreshFrameworkMigrationCoordinatorResult,
  type ExecuteNextFrameworkMigrationStepResult,
} from "./coordinatorContracts";
export {
  type FrameworkMigrationClaim,
  readFrameworkMigrationClaimProgressEffect,
} from "./coordinatorClaim";
export { executeNextFrameworkMigrationStepEffect } from "./coordinatorStep";
export { finalizeFrameworkMigrationClaimEffect } from "./coordinatorFinalization";

export const runFreshFrameworkMigrationCoordinatorEffect = Effect.fn(
  "FreshFrameworkMigrationCoordinator.run",
)((input: RunFreshFrameworkMigrationCoordinatorInput): Effect.Effect<
  FreshFrameworkMigrationCoordinatorResult, FrameworkMigrationCoordinatorFailure
> => runCoordinatorEffect(input));

export const runAdditiveFrameworkMigrationCoordinatorEffect = Effect.fn("AdditiveFrameworkMigrationCoordinator.run")(
  (input: RunAdditiveFrameworkMigrationCoordinatorInput): Effect.Effect<
    FreshFrameworkMigrationCoordinatorResult, FrameworkMigrationCoordinatorFailure
  > => Effect.gen(function* () {
    const base = yield* captureFrameworkMigrationBaseReferenceEffect(input.baseInstallation);
    return yield* withAdditiveMigrationGraphLimits(runCoordinatorEffect(input, base));
  }),
);

const runCoordinatorEffect = Effect.fn("FrameworkMigrationCoordinator.run")((input: RunFreshFrameworkMigrationCoordinatorInput,
  base?: FrameworkMigrationBaseInstallation): Effect.Effect<FreshFrameworkMigrationCoordinatorResult,
    FrameworkMigrationCoordinatorFailure> => Effect.suspend(() => {
  const timeout = input.runTimeoutMilliseconds ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 300_000) {
    return Effect.fail(coordinatorError("prepare", "invalidInput", "Invalid fresh coordinator run budget"));
  }
  // Interruption is not evidence of non-commit. The target owns settlement and
  // cleanup; a later run reconstructs the exact durable prefix or readiness.
  return Effect.raceFirst(runFreshCoordinatorWithinBudgetEffect(input, base),
    Effect.sleep(timeout).pipe(Effect.andThen(Effect.fail(coordinatorError(
      "prepare", "resourceFailure", "Fresh coordinator run deadline expired; resume from durable state",
    )))));
}), withFrameworkMigrationPlanVerification);

const runFreshCoordinatorWithinBudgetEffect = Effect.fn(
  "FreshFrameworkMigrationCoordinator.runWithinBudget",
)(function* (
  input: RunFreshFrameworkMigrationCoordinatorInput,
  base?: FrameworkMigrationBaseInstallation,
): Effect.fn.Return<
  FreshFrameworkMigrationCoordinatorResult,
  FrameworkMigrationCoordinatorFailure
> {
  const maximumSteps = input.maximumStepsPerRun ?? 16;
  if (base !== undefined && input.commerceProfile !== undefined) return yield* Effect.fail(coordinatorError("prepare", "invalidInput", "Commerce admits only fresh installation"));
  if (
    !isIdentityText(input.attemptId) ||
    !isIdentityText(input.leaseOwnerId) ||
    !isPositiveBoundedInteger(input.leaseDurationMilliseconds) ||
    !isPositiveBoundedInteger(input.lockTimeoutMilliseconds) ||
    !isPositiveBoundedInteger(input.statementTimeoutMilliseconds) ||
    !Number.isSafeInteger(maximumSteps) || maximumSteps < 0 || maximumSteps > 16
  ) {
    return yield* Effect.fail(coordinatorError(
      "prepare",
      "invalidInput",
      "Framework migration coordinator input is invalid",
    ));
  }
  const plan = yield* loadFrameworkMigrationPlanEffect(input, base);
  const definition = yield* prepareFrameworkMigrationDefinition(input.target, plan);

  const prepared = yield* prepareCoordinatorDefinitionWithRecoveryEffect(input, plan);
  const existingReady = yield* readReadyResultEffect(
    input.target,
    prepared,
    input,
  );
  if (Option.isSome(existingReady)) return existingReady.value;

  const claimResult = yield* claimCoordinatorAttemptEffect(
    input,
    prepared,
    definition,
  );
  if (claimResult.kind === "busy" || claimResult.kind === "ready") {
    return claimResult;
  }
  return yield* advanceFrameworkMigrationClaimBatchEffect(claimResult.claim, maximumSteps);
});

/** Continue the same prepared claim. Every step still opens its own transaction
 * and rechecks durable authority; this retains no live transaction across batches. */
export const advanceFrameworkMigrationClaimBatchEffect = Effect.fn("FrameworkMigrationCoordinator.advanceBatch")(
  function* (claim: FrameworkMigrationClaim, maximumSteps: number): Effect.fn.Return<
    FreshFrameworkMigrationCoordinatorResult, FrameworkMigrationCoordinatorFailure
  > {
    if (!Number.isSafeInteger(maximumSteps) || maximumSteps < 0 || maximumSteps > 16) {
      return yield* Effect.fail(coordinatorError("step", "invalidInput", "Invalid coordinator batch size"));
    }
    let completed = 0;
    let lastProgress: FrameworkMigrationPendingResult | undefined;
    while (completed < maximumSteps) {
      const progress = yield* executeNextFrameworkMigrationStepEffect(
        claim,
      );
      if (progress.kind === "complete") {
        return yield* finalizeFrameworkMigrationClaimEffect(claim);
      }
      if (progress.kind === "not_ready") return progress;
      lastProgress = Object.freeze({
        kind: "pending",
        claim: claim,
        completedStepCount: progress.completedStepCount,
        requiredStepCount: progress.requiredStepCount,
      });
      completed += 1;
    }
    if (lastProgress !== undefined) return lastProgress;
    const status = yield* readFrameworkMigrationClaimProgressEffect(
      claim,
    );
    return status.completedStepCount === status.requiredStepCount
      ? yield* finalizeFrameworkMigrationClaimEffect(claim)
      : Object.freeze({
        kind: "pending",
        claim: claim,
        ...status,
      });
});

function isPositiveBoundedInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 600_000;
}

function isIdentityText(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024 &&
    !value.includes("\0");
}
