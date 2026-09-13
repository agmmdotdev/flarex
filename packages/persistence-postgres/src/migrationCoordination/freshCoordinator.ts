/**
 * Existing coordinator entry point and bounded run orchestration. Lifecycle operations
 * remain source-private; no new package exports or execution profile are introduced.
 */
import { prepareFrameworkMigrationDefinition } from "./definition";
import {
  withFrameworkMigrationPlanVerification,
  captureFreshRelationalMigrationPlan,
} from "./canonical";
import { withAdditiveMigrationGraphLimits } from "./graphLimits";
import { isStoredMigrationBaseInstallation } from "./storedValidation";
import { commerceSchemaPlanStepLimit } from "../commerceTransaction/profile";
import { Effect, Option } from "effect";
import { captureAdditiveRelationalMigrationPlan } from "./additivePlan";
import { authenticateFrameworkMigrationBaseEffect } from "./baseRepository";
import { getFrameworkSchemaArtifactEffect } from "../frameworkSchema/artifact/read";
import { authenticateStoredRelationalSchemaArtifactEffect } from "../relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../relationalSchema/physical/canonical";
import type { RelationalMigrationPlan, FrameworkMigrationBaseInstallation } from "./model";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "./targetCollisionRepository";
import {
  frameworkMigrationTargetSnapshot,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
} from "./targetSession";
import {
  type FrameworkMigrationCoordinatorFailure,
  type RunFreshFrameworkMigrationCoordinatorInput,
  type RunAdditiveFrameworkMigrationCoordinatorInput,
  type FrameworkMigrationPendingResult,
  type FreshFrameworkMigrationCoordinatorResult,
  coordinatorError,
} from "./coordinatorContracts";
import { readFrameworkMigrationClaimProgressEffect } from "./coordinatorClaim";
import { ordinaryRequest } from "./coordinatorJournal";
import {
  prepareCoordinatorGraphWithRecoveryEffect,
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
  > => Effect.suspend(() => isStoredMigrationBaseInstallation(input.baseInstallation)
    ? withAdditiveMigrationGraphLimits(runCoordinatorEffect(input, Object.freeze({ ...input.baseInstallation,
      identity: Object.freeze({ ...input.baseInstallation.identity,
        artifact: Object.freeze({ ...input.baseInstallation.identity.artifact }),
        physicalLocator: Object.freeze({ ...input.baseInstallation.identity.physicalLocator }),
        targetNamespace: Object.freeze({ ...input.baseInstallation.identity.targetNamespace }),
      }),
    })))
    : Effect.fail(coordinatorError("prepare", "invalidInput", "Additive migration requires an exact base reference"))),
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
  const artifact = yield* getFrameworkSchemaArtifactEffect(
    input.artifactRepository,
    input.artifactIdentity,
  );
  if (artifact === null) {
    return yield* Effect.fail(coordinatorError(
      "prepare",
      "artifactMissing",
      "Exact framework schema artifact is absent",
    ));
  }
  const snapshot = frameworkMigrationTargetSnapshot(input.target);
  if (snapshot === undefined) {
    return yield* Effect.fail(coordinatorError(
      "prepare",
      "invalidInput",
      "Framework migration target authority is invalid",
    ));
  }
  const relationalArtifact = yield*
    authenticateStoredRelationalSchemaArtifactEffect(artifact);
  const physicalLayout = yield* captureRelationalPhysicalLayout({
    artifact: relationalArtifact.artifact,
    physicalLocator: snapshot.physicalLocator,
    targetNamespace: snapshot.namespace,
  });
  let plan: RelationalMigrationPlan = yield* captureFreshRelationalMigrationPlan({
    artifact,
    physicalLayout,
    ...(input.commerceProfile === undefined ? {} : { commerceProfile: input.commerceProfile }),
  });
  if (base !== undefined) {
    const candidate = plan;
    const readiness = yield* runFrameworkMigrationTargetTransactionEffect(input.target, ordinaryRequest(input),
      transaction => withFrameworkMigrationRawTransactionEffect(transaction, input.target, raw => Effect.gen(function* () {
        const target = yield* ensureFrameworkSchemaTargetNamespaceInTransactionEffect(raw, candidate.targetNamespace);
        const collision = yield* ensureFrameworkMigrationCollisionDomainInTransactionEffect(raw, target, candidate);
        return yield* authenticateFrameworkMigrationBaseEffect(raw, collision, base, "readPlan");
      })));
    if (readiness.installation.plan.plan.frame.steps.length > 7) {
      return yield* Effect.fail(coordinatorError("prepare", "invalidInput", "Additive base exceeds seven steps"));
    }
    plan = yield* captureAdditiveRelationalMigrationPlan({ artifact, physicalLayout,
      baseInstallation: readiness.installation.installation, baseReadiness: readiness.readiness });
    if (plan.frame.steps.length > 8) return yield* Effect.fail(coordinatorError("prepare", "invalidInput", "Additive plan exceeds eight steps"));
  }
  const planStepLimit = commerceSchemaPlanStepLimit(input.commerceProfile);
  if (plan.frame.steps.length > planStepLimit) {
    return yield* Effect.fail(coordinatorError("prepare", "invalidInput",
      `Fresh coordinator execution supports at most ${planStepLimit} plan steps`));
  }
  const definition = yield* prepareFrameworkMigrationDefinition(input.target, plan);

  const graph = yield* prepareCoordinatorGraphWithRecoveryEffect(input, plan);
  const existingReady = yield* readReadyResultEffect(
    input.target,
    graph,
    input,
  );
  if (Option.isSome(existingReady)) return existingReady.value;

  const claimResult = yield* claimCoordinatorAttemptEffect(
    input,
    graph,
    definition,
  );
  if (claimResult.kind === "busy" || claimResult.kind === "ready") {
    return claimResult;
  }
  let completed = 0;
  let lastProgress: FrameworkMigrationPendingResult | undefined;
  while (completed < maximumSteps) {
    const progress = yield* executeNextFrameworkMigrationStepEffect(
      claimResult.claim,
    );
    if (progress.kind === "complete") {
      return yield* finalizeFrameworkMigrationClaimEffect(claimResult.claim);
    }
    if (progress.kind === "not_ready") return progress;
    lastProgress = Object.freeze({
      kind: "pending",
      claim: claimResult.claim,
      completedStepCount: progress.completedStepCount,
      requiredStepCount: progress.requiredStepCount,
    });
    completed += 1;
  }
  if (lastProgress !== undefined) return lastProgress;
  const status = yield* readFrameworkMigrationClaimProgressEffect(
    claimResult.claim,
  );
  return status.completedStepCount === status.requiredStepCount
    ? yield* finalizeFrameworkMigrationClaimEffect(claimResult.claim)
    : Object.freeze({
      kind: "pending",
      claim: claimResult.claim,
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
