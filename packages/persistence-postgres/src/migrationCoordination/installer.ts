import { Effect, Result, Schema } from "effect";
import type { FrameworkSchemaArtifactRepository } from "../frameworkSchema/artifact/repository";
import { withFrameworkMigrationPlanVerification } from "./canonical";
import { coordinatorError, type FrameworkMigrationCoordinatorFailure,
  type FreshFrameworkMigrationCoordinatorResult, type RunFreshFrameworkMigrationCoordinatorInput,
  type RunAdditiveFrameworkMigrationCoordinatorInput } from "./coordinatorContracts";
import { advanceFrameworkMigrationClaimBatchEffect, finalizeFrameworkMigrationClaimEffect,
  runFreshFrameworkMigrationCoordinatorEffect, runAdditiveFrameworkMigrationCoordinatorEffect } from "./freshCoordinator";
import type { FrameworkMigrationTarget } from "./targetSession";
import { captureFrameworkMigrationBaseReferenceEffect, loadFrameworkMigrationPlanEffect,
  type FrameworkMigrationDefinitionSelection } from "./definition";
import { inspectFrameworkMigrationEffect } from "./inspect";
import { verifyFrameworkMigrationEffect } from "./verify";
import { withAdditiveMigrationGraphLimits } from "./graphLimits";

const timeout = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 600_000 }));
const FrameworkInstallerPolicySchema = Schema.Struct({
  leaseDurationMilliseconds: timeout,
  lockTimeoutMilliseconds: timeout,
  statementTimeoutMilliseconds: timeout,
  runTimeoutMilliseconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 300_000 })),
  maximumStepsPerCall: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 })),
});
const decodePolicy = Schema.decodeUnknownResult(FrameworkInstallerPolicySchema);
export type FrameworkInstallerPolicy = typeof FrameworkInstallerPolicySchema.Type;

export type FrameworkFreshInstallationRequest = Pick<RunFreshFrameworkMigrationCoordinatorInput,
  "artifactIdentity" | "commerceProfile" | "attemptId" | "leaseOwnerId">;
export type FrameworkAdditiveInstallationRequest = FrameworkFreshInstallationRequest &
  Pick<RunAdditiveFrameworkMigrationCoordinatorInput, "baseInstallation">;
export type FrameworkInstallationSelection = Pick<FrameworkFreshInstallationRequest, "artifactIdentity" | "commerceProfile"> &
  Readonly<{ baseInstallation?: RunAdditiveFrameworkMigrationCoordinatorInput["baseInstallation"] }>;
export type FrameworkInstallationResult = Exclude<FreshFrameworkMigrationCoordinatorResult, { kind: "pending" }> |
  Readonly<{ kind: "pending"; completedStepCount: number; requiredStepCount: number }>;

/** Trusted, source-private construction. Borrow existing capabilities; do not
 * acquire a connection, admit artifacts, or expose the repository or claim. */
export function makeFrameworkInstaller(input: Readonly<{
  target: FrameworkMigrationTarget;
  artifactRepository: FrameworkSchemaArtifactRepository;
  policy: FrameworkInstallerPolicy;
}>) {
  const target = input.target;
  const artifactRepository = input.artifactRepository;
  return decodePolicy(input.policy).pipe(
    Result.mapError(cause => coordinatorError("prepare", "invalidInput", "Invalid framework installer policy", cause)),
    Result.map(decoded => {
      const policy = Object.freeze(decoded);
      const withinBudget = <Value>(effect: Effect.Effect<Value, FrameworkMigrationCoordinatorFailure>) =>
        Effect.raceFirst(effect, Effect.sleep(policy.runTimeoutMilliseconds).pipe(Effect.andThen(
          Effect.fail(coordinatorError("prepare", "resourceFailure", "Framework installer call deadline expired")),
        ))).pipe(withFrameworkMigrationPlanVerification);
      const definitionInput = (selection: FrameworkInstallationSelection): FrameworkMigrationDefinitionSelection => ({
        target, artifactRepository, artifactIdentity: selection.artifactIdentity,
        ...(selection.commerceProfile === undefined ? {} : { commerceProfile: selection.commerceProfile }),
        lockTimeoutMilliseconds: policy.lockTimeoutMilliseconds, statementTimeoutMilliseconds: policy.statementTimeoutMilliseconds,
      });
      const loadSelection = Effect.fn("FrameworkInstaller.loadSelection")(function* (selection: FrameworkInstallationSelection) {
        if (selection.baseInstallation === undefined) return yield* loadFrameworkMigrationPlanEffect(definitionInput(selection));
        const base = yield* captureFrameworkMigrationBaseReferenceEffect(selection.baseInstallation);
        return yield* withAdditiveMigrationGraphLimits(loadFrameworkMigrationPlanEffect(definitionInput(selection), base));
      });
      const firstBatch = Math.min(16, policy.maximumStepsPerCall);
      const coordinatorInput = (request: FrameworkFreshInstallationRequest): RunFreshFrameworkMigrationCoordinatorInput => ({
        artifactIdentity: request.artifactIdentity,
        ...(request.commerceProfile === undefined ? {} : { commerceProfile: request.commerceProfile }),
        attemptId: request.attemptId, leaseOwnerId: request.leaseOwnerId,
        target, artifactRepository, ...policy, maximumStepsPerRun: firstBatch,
      });
      const run = Effect.fn("FrameworkInstaller.install")((initial: Effect.Effect<
        FreshFrameworkMigrationCoordinatorResult, FrameworkMigrationCoordinatorFailure>): Effect.Effect<
          FrameworkInstallationResult, FrameworkMigrationCoordinatorFailure
        > => Effect.gen(function* () {
          let result = yield* initial;
          let remaining = policy.maximumStepsPerCall - firstBatch;
          while (result.kind === "pending" && remaining > 0) {
            const batchSize = Math.min(16, remaining);
            result = yield* advanceFrameworkMigrationClaimBatchEffect(result.claim, batchSize);
            remaining -= batchSize;
          }
          if (result.kind !== "pending") return result;
          // Final publication does not consume another structural step. Preserve
          // the established finalizer's full verification and uncertain recovery.
          if (result.completedStepCount === result.requiredStepCount) {
            return yield* finalizeFrameworkMigrationClaimEffect(result.claim);
          }
          return Object.freeze({ kind: "pending", completedStepCount: result.completedStepCount,
            requiredStepCount: result.requiredStepCount });
        }).pipe(withinBudget));
      return Object.freeze({
        installFresh: Effect.fn("FrameworkInstaller.installFresh")((request: FrameworkFreshInstallationRequest) =>
          run(runFreshFrameworkMigrationCoordinatorEffect(coordinatorInput(request)))),
        installAdditive: Effect.fn("FrameworkInstaller.installAdditive")((request: FrameworkAdditiveInstallationRequest) =>
          run(runAdditiveFrameworkMigrationCoordinatorEffect({ ...coordinatorInput(request), baseInstallation: request.baseInstallation }))),
        inspect: Effect.fn("FrameworkInstaller.inspect")(function* (selection: FrameworkInstallationSelection) {
          const plan = yield* loadSelection(selection);
          return yield* inspectFrameworkMigrationEffect(target, plan, policy);
        }, withinBudget),
        verify: Effect.fn("FrameworkInstaller.verify")(function* (selection: FrameworkInstallationSelection) {
          const plan = yield* loadSelection(selection);
          const verification = verifyFrameworkMigrationEffect(target, plan, policy);
          return yield* plan.frame.version === 2 ? withAdditiveMigrationGraphLimits(verification) : verification;
        }, withinBudget),
      });
    }),
  );
}
