import { Brand, Effect } from "effect";

import { capturedAuthorityForFrameworkSchemaInstallation,
  capturedAuthorityForFrameworkSchemaReadiness } from "../frameworkSchema/installation/authority";
import type { CaptureFrameworkSchemaReadinessInput,
  CapturedFrameworkSchemaInstallationValue, FrameworkSchemaReadinessFrame } from "../frameworkSchema/installation/model";
import { capturePrivateCanonicalValue } from "../frameworkSchema/privateCanonicalValue";
import { registerCapturedFreshRelationalMigrationPlan } from "./authority";
import { captureFreshRelationalMigrationPlan, captureRelationalMigrationStep,
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES } from "./canonical";
import { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationPlanSha256, FrameworkSchemaReadinessSha256 } from "./identity";
import { FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_FORMAT,
  FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_VERSION,
  type AdditiveRelationalMigrationPlan, type AdditiveRelationalMigrationPlanFrame,
  type CaptureFreshRelationalMigrationPlanInput, type FrameworkMigrationStep,
  type FrameworkMigrationStepReference } from "./model";
import { isAdditiveLayout, samePrivateJson } from "./storedValidation";
import { hasRelationalOperationCodec } from "./operation";

export interface CaptureAdditiveRelationalMigrationPlanInput
  extends CaptureFreshRelationalMigrationPlanInput {
  readonly baseInstallation: CaptureFrameworkSchemaReadinessInput["installation"];
  readonly baseReadiness: CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaReadinessFrame, FrameworkSchemaReadinessSha256>;
}

const brandPlanSha256 = Brand.nominal<FrameworkMigrationPlanSha256>();
const errorPolicy = {
  invalidInput: () => FrameworkMigrationValueError.invalidInput("capturePlan"),
  hashFailure: (cause: unknown) => FrameworkMigrationValueError.resourceFailure("capturePlan", cause),
};

/** Captured base evidence is comparison data; repositories must authenticate it on the target. */
export const captureAdditiveRelationalMigrationPlan = Effect.fn(
  "FrameworkMigrationPlan.captureAdditive",
)(function* (input: CaptureAdditiveRelationalMigrationPlanInput): Effect.fn.Return<
  AdditiveRelationalMigrationPlan, FrameworkMigrationValueError
> {
  const authority = capturedAuthorityForFrameworkSchemaInstallation(input.baseInstallation);
  const readinessAuthority = capturedAuthorityForFrameworkSchemaReadiness(input.baseReadiness);
  if (authority === undefined || readinessAuthority === undefined ||
    authority.plan.frame.version !== 1 ||
    readinessAuthority.installation.canonicalJson !== input.baseInstallation.canonicalJson ||
    input.baseReadiness.frame.validatedStructureSha256 !== authority.plan.physicalLayout.layoutSha256) {
    return yield* Effect.fail(errorPolicy.invalidInput());
  }
  const fresh = yield* captureFreshRelationalMigrationPlan(input);
  const base = authority.plan;
  if (!isAdditiveLayout(base.frame.physicalLayout, fresh.frame.physicalLayout)) {
    return yield* Effect.fail(errorPolicy.invalidInput());
  }
  const steps: FrameworkMigrationStep[] = [];
  const verification = yield* captureRelationalMigrationStep(0, Object.freeze([]), Object.freeze({
    codec: Object.freeze({ format: "flarex.relational-verify-base-structure", version: 1 }),
    physicalLayout: base.frame.physicalLayout,
    expectedLayoutSha256: base.physicalLayout.layoutSha256,
  }));
  steps.push(verification);
  const replacements = new Map<string, FrameworkMigrationStepReference>();
  for (const step of fresh.frame.steps) {
    const operation = step.operation;
    const retained = hasRelationalOperationCodec(operation, "flarex.relational-create-table")
      ? base.frame.physicalLayout.tables.some(t => t.name === operation.table.name)
      : hasRelationalOperationCodec(operation, "flarex.relational-create-index")
      ? base.frame.physicalLayout.tables.some(t => t.indexes.some(i => samePrivateJson(i, operation.index)))
      : hasRelationalOperationCodec(operation, "flarex.relational-add-foreign-key")
      ? base.frame.physicalLayout.foreignKeys.some(f => samePrivateJson(f, operation.foreignKey))
      : false;
    if (retained) {
      replacements.set(step.stepId, reference(verification));
      continue;
    }
    const dependencies: FrameworkMigrationStepReference[] = [];
    if (operation.codec.format === "flarex.relational-validate-structure") {
      dependencies.push(...steps.map(reference));
    } else {
      for (const dependency of step.dependencies) {
        const replacement = replacements.get(dependency.stepId);
        if (replacement === undefined) return yield* Effect.fail(errorPolicy.invalidInput());
        if (!dependencies.some(d => d.stepId === replacement.stepId)) dependencies.push(replacement);
      }
      dependencies.sort((a, b) => a.stepId < b.stepId ? -1 : a.stepId > b.stepId ? 1 : 0);
    }
    const captured = yield* captureRelationalMigrationStep(steps.length,
      Object.freeze(dependencies), operation);
    steps.push(captured);
    replacements.set(step.stepId, reference(captured));
  }
  const frame: AdditiveRelationalMigrationPlanFrame = Object.freeze({
    ...fresh.frame,
    version: 2,
    baseInstallation: Object.freeze({
      identity: input.baseInstallation.frame.identity,
      installationReceiptSha256: input.baseInstallation.sha256,
      readinessSha256: input.baseReadiness.sha256,
      physicalLayoutSha256: base.physicalLayout.layoutSha256,
    }),
    steps: Object.freeze(steps),
  });
  const captured = yield* capturePrivateCanonicalValue(frame,
    MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES, errorPolicy);
  const required = yield* capturePrivateCanonicalValue({
    format: FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_FORMAT,
    version: FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_VERSION,
    steps: Object.freeze(steps.map(reference)),
  }, MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES, errorPolicy);
  const plan = Object.freeze({ frame, migrationPlanSha256: brandPlanSha256(captured.sha256Hex),
    canonicalJson: captured.canonicalJson, requiredStepSetSha256: required.sha256Hex,
    physicalLayout: fresh.physicalLayout, targetNamespace: fresh.targetNamespace });
  registerCapturedFreshRelationalMigrationPlan(plan, "ordinary");
  return plan;
});

function reference(step: FrameworkMigrationStep): FrameworkMigrationStepReference {
  return Object.freeze({ stepId: step.stepId, stepSha256: step.stepSha256 });
}
