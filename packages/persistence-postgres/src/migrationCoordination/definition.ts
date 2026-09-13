import { commerceSchemaPlanStepLimit } from "../commerceTransaction/profile";
import { captureFreshRelationalMigrationPlan } from "./canonical";
import { captureAdditiveRelationalMigrationPlan } from "./additivePlan";
import { authenticateFrameworkMigrationBaseEffect } from "./baseRepository";
import { getFrameworkSchemaArtifactEffect } from "../frameworkSchema/artifact/read";
import { authenticateStoredRelationalSchemaArtifactEffect } from "../relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../relationalSchema/physical/canonical";
import type { FrameworkMigrationBaseInstallation } from "./model";
import { readFrameworkMigrationCollisionDomainInTransactionEffect, readFrameworkSchemaTargetNamespaceInTransactionEffect } from "./targetCollisionRepository";
import { frameworkMigrationTargetSnapshot, runFrameworkMigrationTargetTransactionEffect, withFrameworkMigrationRawTransactionEffect } from "./targetSession";
import { coordinatorError, type FrameworkMigrationCoordinatorFailure, type RunFreshFrameworkMigrationCoordinatorInput } from "./coordinatorContracts";
import { FrameworkMigrationRepositoryError } from "./repositoryErrors";
import { ordinaryRequest } from "./coordinatorJournal";
import { isStoredMigrationBaseInstallation } from "./storedValidation";
import { Effect, Option } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { capturedStepForPlan } from "./authority";
import type { FrameworkMigrationStep, RelationalMigrationPlan } from "./model";
import { issueRelationalStructuralRunnerTokenEffect,
  type RelationalStructuralRunnerToken } from "./relationalStructuralRunner";
import type { FrameworkMigrationTarget } from "./targetSession";

/** Immutable execution values only. No stored rows, live lease, session, or
 * committed-progress authority is retained in this prepared definition. */
export interface PreparedFrameworkMigrationDefinition {
  readonly plan: RelationalMigrationPlan;
  readonly runner: RelationalStructuralRunnerToken;
  readonly steps: readonly Readonly<{
    readonly step: FrameworkMigrationStep;
    readonly dependencyOrdinals: readonly number[];
  }>[];
}

export const prepareFrameworkMigrationDefinition = Effect.fn("FrameworkMigrationDefinition.prepare")(
  function* (target: FrameworkMigrationTarget, plan: RelationalMigrationPlan) {
    // Issuance authenticates the captured plan/target and resolves every fixed
    // structural handler. It is the existing authority owner for this work.
    const runner = yield* issueRelationalStructuralRunnerTokenEffect(target, plan);
    const steps = plan.frame.steps.map(step => Object.freeze({ step,
      dependencyOrdinals: Object.freeze(step.dependencies.toSorted((left, right) =>
        compareUtf16Strings(left.stepId, right.stepId)).map(reference => {
        const ordinal = capturedStepForPlan(plan, reference.stepId)?.ordinal;
        // An issued plan has already established an ordered dependency graph.
        if (ordinal === undefined || ordinal >= step.ordinal) throw new Error("Captured migration dependency invariant failed");
        return ordinal;
      })),
    }));
    return Object.freeze({ plan, runner, steps: Object.freeze(steps) } satisfies PreparedFrameworkMigrationDefinition);
  },
);

export type FrameworkMigrationDefinitionSelection = Pick<RunFreshFrameworkMigrationCoordinatorInput,
  "artifactRepository" | "artifactIdentity" | "target" | "commerceProfile" | "lockTimeoutMilliseconds" | "statementTimeoutMilliseconds">;

/** The canonical base-reference validator owns its exact protocol shape. Capture
 * the nested value before the first asynchronous definition lookup. */
export const captureFrameworkMigrationBaseReferenceEffect = Effect.fn("FrameworkMigrationDefinition.captureBase")(
  (input: unknown) => Effect.suspend(() => isStoredMigrationBaseInstallation(input)
    ? Effect.succeed(Object.freeze({ ...input, identity: Object.freeze({ ...input.identity,
      artifact: Object.freeze({ ...input.identity.artifact }), physicalLocator: Object.freeze({ ...input.identity.physicalLocator }),
      targetNamespace: Object.freeze({ ...input.identity.targetNamespace }),
    }) }))
    : Effect.fail(coordinatorError("prepare", "invalidInput", "Additive migration requires an exact base reference"))),
);

/** Resolve the exact admitted definition without creating target metadata. Base
 * authentication reuses its existing bounded authority owner. */
export const loadFrameworkMigrationPlanEffect = Effect.fn("FrameworkMigrationDefinition.load")(
  function* (input: FrameworkMigrationDefinitionSelection, base?: FrameworkMigrationBaseInstallation): Effect.fn.Return<
    RelationalMigrationPlan, FrameworkMigrationCoordinatorFailure
  > {
    if (base !== undefined && input.commerceProfile !== undefined) return yield* Effect.fail(coordinatorError("prepare", "invalidInput", "Commerce admits only fresh installation"));
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
          const target = yield* readFrameworkSchemaTargetNamespaceInTransactionEffect(raw, candidate.targetNamespace);
          if (Option.isNone(target)) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal("readPlan"));
          const collision = yield* readFrameworkMigrationCollisionDomainInTransactionEffect(raw, target.value, candidate.frame.collision);
          if (Option.isNone(collision)) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal("readPlan"));
          return yield* authenticateFrameworkMigrationBaseEffect(raw, collision.value, base, "readPlan");
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
    return plan;
  },
);
