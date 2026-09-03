import { isCanonicalIsoInstant } from "@flarex/time/iso-instant";
import { compareUtf16Strings, isNonBlankString } from "@flarex/utils/strings";
import { Brand, Effect, Result } from "effect";
import {
  isJsonObjectFromUnknown,
  type JsonObject,
} from "flarex-protocol/json";

import { copyCapturedFrameworkSchemaArtifactEvidence } from
  "../frameworkSchema/artifact/canonical";
import type { FrameworkSchemaArtifactIdentity } from
  "../frameworkSchema/artifact/model";
import {
  capturePrivateCanonicalValue,
  verifyStoredPrivateCanonicalValue,
} from
  "../frameworkSchema/privateCanonicalValue";
import { hasExactOwnDataKeys } from "../exactOwnDataKeys";
import { isCapturedRelationalPhysicalLayout } from
  "../relationalSchema/physical/canonical";
import {
  RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
  type RelationalPhysicalForeignKey,
  type RelationalPhysicalIndex,
  type RelationalPhysicalLayout,
  type RelationalPhysicalTable,
} from "../relationalSchema/physical/model";
import { FrameworkMigrationValueError } from "./errors";
import {
  capturedAuthorityForAttempt,
  capturedAuthorityForStepReceipt,
  capturedFrameworkMigrationTerminalAdmission,
  capturedPlanForAdmission,
  capturedPlanForStep,
  isCapturedFrameworkMigrationAttemptTerminalAuthority,
  isCapturedFreshRelationalMigrationPlanAuthority,
  registerCapturedFrameworkMigrationAttemptStart,
  registerCapturedFrameworkMigrationAttemptTerminal,
  registerCapturedFrameworkMigrationPlanAdmission,
  registerCapturedFrameworkMigrationStepReceipt,
  registerCapturedFreshRelationalMigrationPlan,
} from "./authority";
import type {
  CanonicalNonNegativeInt64,
  FrameworkMigrationAttemptId,
  FrameworkMigrationAttemptStartSha256,
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationCollisionHeadSha256,
  FrameworkMigrationConditionSha256,
  FrameworkMigrationEventSha256,
  FrameworkMigrationLeaseOwnerId,
  FrameworkMigrationPlanAdmissionSha256,
  FrameworkMigrationPlanSha256,
  FrameworkMigrationStepId,
  FrameworkMigrationStepReceiptSha256,
  FrameworkMigrationStepSha256,
  RelationalPhysicalProjectionSha256,
} from "./identity";
import {
  FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
  FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
  FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
  FRAMEWORK_MIGRATION_PLAN_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_VERSION,
  FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_FORMAT,
  FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_VERSION,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
  type CaptureFrameworkMigrationPlanAdmissionInput,
  type CaptureFreshRelationalMigrationPlanInput,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationAttemptOutcome,
  type FrameworkMigrationAttemptStartFrame,
  type FrameworkMigrationAttemptTerminalFrame,
  type FrameworkMigrationCollisionCoordinate,
  type FrameworkMigrationCollisionHeadFrame,
  type FrameworkMigrationCondition,
  type FrameworkMigrationCurrentAttempt,
  type FrameworkMigrationDependencyReceipt,
  type FrameworkMigrationEventFrame,
  type FrameworkMigrationEventToken,
  type FrameworkMigrationPlanAdmissionFrame,
  type FrameworkMigrationStep,
  type FrameworkMigrationStepReceiptFrame,
  type FrameworkMigrationStepReference,
  type FreshRelationalMigrationPlan,
  type FreshRelationalMigrationPlanFrame,
  type RelationalStructuralOperation,
} from "./model";
import {
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
  MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
} from "./targetNamespace";
import { isStoredMigrationNonEventFrame } from "./storedValidation";

export const MAX_FRAMEWORK_MIGRATION_PLAN_STEPS = 66_000;
export const MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES = 8_388_608;
export const MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES = 1_048_576;

const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const NON_NEGATIVE_INT64 = /^(?:0|[1-9][0-9]{0,18})$/;
const MAX_INT64_TEXT = "9223372036854775807";
const STEP_ID = /^step_[0-9a-f]{32}$/;
const UTF8 = new TextEncoder();

const EVENT_KEYS = Object.freeze({
  planAdmitted: Object.freeze([
    "format",
    "version",
    "collision",
    "sequence",
    "previousEvent",
    "recordedAt",
    "kind",
    "admissionSha256",
  ]),
  attemptStarted: Object.freeze([
    "format",
    "version",
    "collision",
    "sequence",
    "previousEvent",
    "recordedAt",
    "kind",
    "attemptStartSha256",
  ]),
  leaseRenewed: Object.freeze([
    "format",
    "version",
    "collision",
    "sequence",
    "previousEvent",
    "recordedAt",
    "kind",
    "attemptId",
    "attemptFence",
    "leaseOwnerId",
    "leaseExpiresAt",
  ]),
  stepCompleted: Object.freeze([
    "format",
    "version",
    "collision",
    "sequence",
    "previousEvent",
    "recordedAt",
    "kind",
    "stepReceiptSha256",
  ]),
  attemptTerminated: Object.freeze([
    "format",
    "version",
    "collision",
    "sequence",
    "previousEvent",
    "recordedAt",
    "kind",
    "terminalSha256",
  ]),
  installationPublished: Object.freeze([
    "format",
    "version",
    "collision",
    "sequence",
    "previousEvent",
    "recordedAt",
    "kind",
    "installationReceiptSha256",
  ]),
  readinessPublished: Object.freeze([
    "format",
    "version",
    "collision",
    "sequence",
    "previousEvent",
    "recordedAt",
    "kind",
    "readinessSha256",
  ]),
} satisfies Readonly<Record<
  FrameworkMigrationEventFrame["kind"],
  readonly string[]
>>);

const brandPlanSha256 = Brand.nominal<FrameworkMigrationPlanSha256>();
const brandStepSha256 = Brand.nominal<FrameworkMigrationStepSha256>();
const brandConditionSha256 =
  Brand.nominal<FrameworkMigrationConditionSha256>();
const brandProjectionSha256 =
  Brand.nominal<RelationalPhysicalProjectionSha256>();
const brandStepId = Brand.nominal<FrameworkMigrationStepId>();
const brandAdmissionSha256 =
  Brand.nominal<FrameworkMigrationPlanAdmissionSha256>();
const brandCollisionHeadSha256 =
  Brand.nominal<FrameworkMigrationCollisionHeadSha256>();
const brandAttemptStartSha256 =
  Brand.nominal<FrameworkMigrationAttemptStartSha256>();
const brandStepReceiptSha256 =
  Brand.nominal<FrameworkMigrationStepReceiptSha256>();
const brandTerminalSha256 =
  Brand.nominal<FrameworkMigrationAttemptTerminalSha256>();
const brandEventSha256 = Brand.nominal<FrameworkMigrationEventSha256>();
const brandAttemptId = Brand.nominal<FrameworkMigrationAttemptId>();
const brandLeaseOwnerId = Brand.nominal<FrameworkMigrationLeaseOwnerId>();
const brandNonNegativeInt64 = Brand.nominal<CanonicalNonNegativeInt64>();

export const captureFreshRelationalMigrationPlan = Effect.fn(
  "FrameworkMigrationPlan.captureFreshRelational",
)(function* (
  input: CaptureFreshRelationalMigrationPlanInput,
): Effect.fn.Return<
  FreshRelationalMigrationPlan,
  FrameworkMigrationValueError
> {
  if (
    copyCapturedFrameworkSchemaArtifactEvidence(input.artifact) === undefined ||
    !isCapturedRelationalPhysicalLayout(input.physicalLayout) ||
    input.artifact.identity.owner !== "system" ||
    input.artifact.dependencies.length !== 0 ||
    input.artifact.provenance.kind !== "synthetic" ||
    !sameArtifactIdentity(
      input.artifact.identity,
      input.physicalLayout.frame.artifact,
    )
  ) {
    return yield* Effect.fail(
      FrameworkMigrationValueError.unsupportedArtifact(),
    );
  }

  const layout = input.physicalLayout;
  const collision = collisionCoordinate(layout);
  const steps: FrameworkMigrationStep[] = [];
  const tableSteps = new Map<string, FrameworkMigrationStepReference>();

  for (const table of layout.frame.tables) {
    const projection = createTableProjection(table);
    const projectionSha256 = yield* hashProjection("table", projection);
    const operation = Object.freeze({
      codec: Object.freeze({
        format: "flarex.relational-create-table",
        version: 1,
      }),
      table: projection,
      expectedTableSha256: projectionSha256,
    } satisfies RelationalStructuralOperation);
    const step = yield* captureStep(
      steps.length,
      Object.freeze([]),
      operation,
    );
    steps.push(step);
    tableSteps.set(table.identity.tableId, stepReference(step));
  }

  for (const table of layout.frame.tables) {
    const tableDependency = tableSteps.get(table.identity.tableId);
    if (tableDependency === undefined) {
      return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
        "capturePlan",
      ));
    }
    for (const index of table.indexes) {
      const projectionSha256 = yield* hashProjection("index", index);
      const operation = Object.freeze({
        codec: Object.freeze({
          format: "flarex.relational-create-index",
          version: 1,
        }),
        index,
        expectedIndexSha256: projectionSha256,
      } satisfies RelationalStructuralOperation);
      steps.push(yield* captureStep(
        steps.length,
        Object.freeze([tableDependency]),
        operation,
      ));
    }
  }

  for (const foreignKey of layout.frame.foreignKeys) {
    const dependencies = yield* Effect.fromResult(
      foreignKeyDependencies(foreignKey, tableSteps),
    );
    const projectionSha256 = yield* hashProjection(
      "foreignKey",
      foreignKey,
    );
    const operation = Object.freeze({
      codec: Object.freeze({
        format: "flarex.relational-add-foreign-key",
        version: 1,
      }),
      foreignKey,
      expectedForeignKeySha256: projectionSha256,
    } satisfies RelationalStructuralOperation);
    steps.push(yield* captureStep(
      steps.length,
      dependencies,
      operation,
    ));
  }

  const validationDependencies = Object.freeze(steps.map(stepReference));
  const validationOperation = Object.freeze({
    codec: Object.freeze({
      format: "flarex.relational-validate-structure",
      version: 1,
    }),
    expectedLayoutSha256: layout.layoutSha256,
  } satisfies RelationalStructuralOperation);
  steps.push(yield* captureStep(
    steps.length,
    validationDependencies,
    validationOperation,
  ));
  if (steps.length > MAX_FRAMEWORK_MIGRATION_PLAN_STEPS) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "capturePlan",
    ));
  }
  if (!stepsHaveUniqueIdentities(steps)) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "capturePlan",
    ));
  }

  const requiredStepSet = yield* capturePrivateCanonicalValue(
    Object.freeze({
      format: FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_FORMAT,
      version: FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_VERSION,
      steps: Object.freeze(steps.map(stepReference)),
    }),
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    migrationErrorPolicy("capturePlan"),
  );

  const frame = Object.freeze({
    format: FRAMEWORK_MIGRATION_PLAN_FORMAT,
    version: FRAMEWORK_MIGRATION_PLAN_VERSION,
    artifact: copyArtifactIdentity(input.artifact.identity),
    physicalLocator: copyLocator(layout.frame.physicalLocator),
    targetNamespace: layout.targetNamespace.frame,
    collision,
    baseInstallation: null,
    physicalLayout: layout.frame,
    physicalLayoutSha256: layout.layoutSha256,
    steps: Object.freeze(steps),
  } satisfies FreshRelationalMigrationPlanFrame);
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
    migrationErrorPolicy("capturePlan"),
  );
  const plan = Object.freeze({
    frame,
    migrationPlanSha256: brandPlanSha256(captured.sha256Hex),
    requiredStepSetSha256: requiredStepSet.sha256Hex,
    canonicalJson: captured.canonicalJson,
    physicalLayout: layout,
    targetNamespace: layout.targetNamespace,
  });
  registerCapturedFreshRelationalMigrationPlan(plan);
  return plan;
});

export function isCapturedFreshRelationalMigrationPlan(
  value: FreshRelationalMigrationPlan,
): boolean {
  return isCapturedFreshRelationalMigrationPlanAuthority(value);
}

export const captureFrameworkMigrationPlanAdmission = Effect.fn(
  "FrameworkMigrationPlanAdmission.capture",
)(function* (
  input: CaptureFrameworkMigrationPlanAdmissionInput,
): Effect.fn.Return<
  CapturedFrameworkMigrationValue<
    FrameworkMigrationPlanAdmissionFrame,
    FrameworkMigrationPlanAdmissionSha256
  >,
  FrameworkMigrationValueError
> {
  if (
    !isCapturedFreshRelationalMigrationPlanAuthority(input.plan) ||
    !isCanonicalIsoInstant(input.admittedAt) ||
    (input.previousPlanSha256 !== null &&
      !isSha256(input.previousPlanSha256)) ||
    !sameAssignments(
      input.nameAssignments,
      input.plan.physicalLayout.nameAssignments,
    )
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const frame = Object.freeze({
    format: FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
    version: FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
    collision: input.plan.frame.collision,
    planSha256: input.plan.migrationPlanSha256,
    artifact: input.plan.frame.artifact,
    physicalLocator: input.plan.frame.physicalLocator,
    targetNamespace: input.plan.frame.targetNamespace,
    baseInstallation: null,
    nameAssignments: Object.freeze(
      input.plan.physicalLayout.nameAssignments.map(assignment =>
      Object.freeze({
        spelling: assignment.frame.spelling,
        assignmentSha256: assignment.assignmentSha256,
      })
      ),
    ),
    previousPlanSha256: input.previousPlanSha256,
    admissionProfile: "synthetic-system-fresh",
    admittedAt: input.admittedAt,
  } satisfies FrameworkMigrationPlanAdmissionFrame);
  const captured = yield* captureLedgerValue(frame, brandAdmissionSha256);
  registerCapturedFrameworkMigrationPlanAdmission(captured, input.plan);
  return captured;
});

export function isCapturedFrameworkMigrationPlanAdmission(
  value: CapturedFrameworkMigrationValue<
    FrameworkMigrationPlanAdmissionFrame,
    FrameworkMigrationPlanAdmissionSha256
  >,
): boolean {
  return capturedPlanForAdmission(value) !== undefined;
}

export interface CaptureFrameworkMigrationCollisionHeadInput {
  readonly admission: CapturedFrameworkMigrationValue<
    FrameworkMigrationPlanAdmissionFrame,
    FrameworkMigrationPlanAdmissionSha256
  >;
  readonly headRevision: unknown;
  readonly attemptFence: unknown;
  readonly currentAttempt: Readonly<{
    readonly attemptId: unknown;
    readonly attemptFence: unknown;
    readonly leaseOwnerId: unknown;
    readonly leaseExpiresAt: unknown;
  }> | null;
  readonly lastEvent: FrameworkMigrationEventToken | null;
  readonly updatedAt: unknown;
}

export const captureFrameworkMigrationCollisionHead = Effect.fn(
  "FrameworkMigrationCollisionHead.capture",
)(function* (
  input: CaptureFrameworkMigrationCollisionHeadInput,
): Effect.fn.Return<
  CapturedFrameworkMigrationValue<
    FrameworkMigrationCollisionHeadFrame,
    FrameworkMigrationCollisionHeadSha256
  >,
  FrameworkMigrationValueError
> {
  if (capturedPlanForAdmission(input.admission) === undefined) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const headRevision = yield* Effect.fromResult(nonNegativeInt64(
    input.headRevision,
  ));
  const attemptFence = yield* Effect.fromResult(nonNegativeInt64(
    input.attemptFence,
  ));
  const currentAttempt = yield* Effect.fromResult(
    captureCurrentAttempt(input.currentAttempt),
  );
  if (
    (currentAttempt !== null && currentAttempt.attemptFence !== attemptFence) ||
    !isEventTokenOrNull(input.lastEvent)
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const updatedAt = yield* Effect.fromResult(canonicalInstant(input.updatedAt));
  const frame = Object.freeze({
    format: FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
    version: FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
    collision: input.admission.frame.collision,
    headRevision,
    currentPlan: Object.freeze({
      planSha256: input.admission.frame.planSha256,
      admissionSha256: input.admission.sha256,
    }),
    attemptFence,
    currentAttempt,
    lastEvent: copyEventToken(input.lastEvent),
    updatedAt,
  } satisfies FrameworkMigrationCollisionHeadFrame);
  return yield* captureLedgerValue(frame, brandCollisionHeadSha256);
});

export interface CaptureFrameworkMigrationAttemptStartInput {
  readonly admission: CapturedFrameworkMigrationValue<
    FrameworkMigrationPlanAdmissionFrame,
    FrameworkMigrationPlanAdmissionSha256
  >;
  readonly attemptId: unknown;
  readonly attemptFence: unknown;
  readonly leaseOwnerId: unknown;
  readonly leaseExpiresAt: unknown;
  readonly previousAttemptId: unknown | null;
  readonly startedAt: unknown;
}

export const captureFrameworkMigrationAttemptStart = Effect.fn(
  "FrameworkMigrationAttemptStart.capture",
)(function* (
  input: CaptureFrameworkMigrationAttemptStartInput,
): Effect.fn.Return<
  CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptStartFrame,
    FrameworkMigrationAttemptStartSha256
  >,
  FrameworkMigrationValueError
> {
  const plan = capturedPlanForAdmission(input.admission);
  if (plan === undefined) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const frame = Object.freeze({
    format: FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
    version: FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
    collision: input.admission.frame.collision,
    planSha256: input.admission.frame.planSha256,
    admissionSha256: input.admission.sha256,
    attemptId: yield* Effect.fromResult(attemptId(input.attemptId)),
    attemptFence: yield* Effect.fromResult(nonNegativeInt64(
      input.attemptFence,
    )),
    leaseOwnerId: yield* Effect.fromResult(leaseOwnerId(input.leaseOwnerId)),
    leaseExpiresAt: yield* Effect.fromResult(canonicalInstant(
      input.leaseExpiresAt,
    )),
    previousAttemptId: input.previousAttemptId === null
      ? null
      : yield* Effect.fromResult(attemptId(input.previousAttemptId)),
    startedAt: yield* Effect.fromResult(canonicalInstant(input.startedAt)),
  } satisfies FrameworkMigrationAttemptStartFrame);
  const attempt = yield* captureLedgerValue(frame, brandAttemptStartSha256);
  registerCapturedFrameworkMigrationAttemptStart(attempt, {
    admission: input.admission,
    plan,
  });
  return attempt;
});

export interface CaptureFrameworkMigrationStepReceiptInput {
  readonly attempt: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptStartFrame,
    FrameworkMigrationAttemptStartSha256
  >;
  readonly step: FrameworkMigrationStep;
  readonly dependencyReceipts: readonly CapturedFrameworkMigrationValue<
    FrameworkMigrationStepReceiptFrame,
    FrameworkMigrationStepReceiptSha256
  >[];
  readonly observedPostconditionSha256: unknown;
  readonly completedAt: unknown;
}

export const captureFrameworkMigrationStepReceipt = Effect.fn(
  "FrameworkMigrationStepReceipt.capture",
)(function* (
  input: CaptureFrameworkMigrationStepReceiptInput,
): Effect.fn.Return<
  CapturedFrameworkMigrationValue<
    FrameworkMigrationStepReceiptFrame,
    FrameworkMigrationStepReceiptSha256
  >,
  FrameworkMigrationValueError
> {
  const attemptAuthority = capturedAuthorityForAttempt(input.attempt);
  if (
    attemptAuthority === undefined ||
    capturedPlanForStep(input.step) !== attemptAuthority.plan ||
    !Array.isArray(input.dependencyReceipts) ||
    !isSha256(input.observedPostconditionSha256) ||
    input.observedPostconditionSha256 !== input.step.postconditionSha256 ||
    input.dependencyReceipts.length !== input.step.dependencies.length
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const authenticatedDependencies: FrameworkMigrationDependencyReceipt[] = [];
  for (const receipt of input.dependencyReceipts) {
    const receiptAuthority = capturedAuthorityForStepReceipt(receipt);
    if (
      receiptAuthority === undefined ||
      receiptAuthority.attempt !== input.attempt
    ) {
      return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
        "captureLedgerValue",
      ));
    }
    authenticatedDependencies.push(Object.freeze({
      stepId: receiptAuthority.step.stepId,
      stepReceiptSha256: receipt.sha256,
    }));
  }
  const dependencyReceipts = Object.freeze(
    authenticatedDependencies.toSorted((left, right) => compareUtf16Strings(
      left.stepId,
      right.stepId,
    )),
  );
  const expectedDependencies = input.step.dependencies.toSorted((left, right) =>
    compareUtf16Strings(left.stepId, right.stepId)
  );
  if (
    dependencyReceipts.some((receipt, index) =>
      !isStepId(receipt.stepId) ||
      !isSha256(receipt.stepReceiptSha256) ||
      receipt.stepId !== expectedDependencies[index]?.stepId ||
      (index > 0 &&
        receipt.stepId === dependencyReceipts[index - 1]?.stepId)
    )
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const frame = Object.freeze({
    format: FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
    version: FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
    collision: input.attempt.frame.collision,
    planSha256: input.attempt.frame.planSha256,
    attemptId: input.attempt.frame.attemptId,
    attemptFence: input.attempt.frame.attemptFence,
    stepId: input.step.stepId,
    stepSha256: input.step.stepSha256,
    dependencyReceipts,
    preconditionSha256: input.step.preconditionSha256,
    postconditionSha256: input.step.postconditionSha256,
    observedPostconditionSha256: brandConditionSha256(
      input.observedPostconditionSha256,
    ),
    completedAt: yield* Effect.fromResult(canonicalInstant(input.completedAt)),
  } satisfies FrameworkMigrationStepReceiptFrame);
  const receipt = yield* captureLedgerValue(frame, brandStepReceiptSha256);
  registerCapturedFrameworkMigrationStepReceipt(receipt, {
    attempt: input.attempt,
    step: input.step,
  });
  return receipt;
});

export interface CaptureFrameworkMigrationAttemptTerminalInput {
  readonly attempt: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptStartFrame,
    FrameworkMigrationAttemptStartSha256
  >;
  readonly outcome: FrameworkMigrationAttemptOutcome;
  readonly stepReceipts: readonly CapturedFrameworkMigrationValue<
    FrameworkMigrationStepReceiptFrame,
    FrameworkMigrationStepReceiptSha256
  >[];
  readonly terminalAt: unknown;
}

export const captureFrameworkMigrationAttemptTerminal = Effect.fn(
  "FrameworkMigrationAttemptTerminal.capture",
)(function* (
  input: CaptureFrameworkMigrationAttemptTerminalInput,
): Effect.fn.Return<
  CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptTerminalFrame,
    FrameworkMigrationAttemptTerminalSha256
  >,
  FrameworkMigrationValueError
> {
  const attemptAuthority = capturedAuthorityForAttempt(input.attempt);
  if (attemptAuthority === undefined || !Array.isArray(input.stepReceipts)) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const outcome = yield* Effect.fromResult(captureAttemptOutcome(input.outcome));
  if (
    (outcome.kind === "succeeded" &&
      (outcome.requiredStepSetSha256 !==
          attemptAuthority.plan.requiredStepSetSha256 ||
        input.stepReceipts.length !==
          attemptAuthority.plan.frame.steps.length)) ||
    input.stepReceipts.length > attemptAuthority.plan.frame.steps.length
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  for (let index = 0; index < input.stepReceipts.length; index += 1) {
    const receipt = input.stepReceipts[index];
    const receiptAuthority = receipt === undefined
      ? undefined
      : capturedAuthorityForStepReceipt(receipt);
    if (
      receiptAuthority === undefined ||
      receiptAuthority.attempt !== input.attempt ||
      receiptAuthority.step !== attemptAuthority.plan.frame.steps[index]
    ) {
      return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
        "captureLedgerValue",
      ));
    }
  }
  const lastStepReceiptSha256 = input.stepReceipts.at(-1)?.sha256 ?? null;
  const frame = Object.freeze({
    format: FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
    version: FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
    collision: input.attempt.frame.collision,
    planSha256: input.attempt.frame.planSha256,
    attemptId: input.attempt.frame.attemptId,
    attemptFence: input.attempt.frame.attemptFence,
    outcome,
    lastStepReceiptSha256,
    terminalAt: yield* Effect.fromResult(canonicalInstant(input.terminalAt)),
  } satisfies FrameworkMigrationAttemptTerminalFrame);
  const terminal = yield* captureLedgerValue(frame, brandTerminalSha256);
  registerCapturedFrameworkMigrationAttemptTerminal(
    terminal,
    {
      admission: attemptAuthority.admission,
      attempt: input.attempt,
      stepReceipts: input.stepReceipts,
    },
  );
  return terminal;
});

export function isCapturedFrameworkMigrationAttemptTerminal(
  value: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptTerminalFrame,
    FrameworkMigrationAttemptTerminalSha256
  >,
): boolean {
  return isCapturedFrameworkMigrationAttemptTerminalAuthority(value);
}

export function capturedFrameworkMigrationTerminalMatchesAdmission(
  value: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptTerminalFrame,
    FrameworkMigrationAttemptTerminalSha256
  >,
  admission: CapturedFrameworkMigrationValue<
    FrameworkMigrationPlanAdmissionFrame,
    FrameworkMigrationPlanAdmissionSha256
  >,
): boolean {
  return capturedFrameworkMigrationTerminalAdmission(value) === admission;
}

export type CaptureFrameworkMigrationEventInput = FrameworkMigrationEventFrame;

export const captureFrameworkMigrationEvent = Effect.fn(
  "FrameworkMigrationEvent.capture",
)(function* (
  input: CaptureFrameworkMigrationEventInput,
): Effect.fn.Return<
  CapturedFrameworkMigrationValue<
    FrameworkMigrationEventFrame,
    FrameworkMigrationEventSha256
  >,
  FrameworkMigrationValueError
> {
  if (
    input.format !== FRAMEWORK_MIGRATION_EVENT_FORMAT ||
    input.version !== FRAMEWORK_MIGRATION_EVENT_VERSION ||
    !isCanonicalIsoInstant(input.recordedAt) ||
    !isCanonicalNonNegativeInt64(input.sequence) ||
    !isCollisionCoordinate(input.collision) ||
    !isEventTokenOrNull(input.previousEvent) ||
    !hasExactEventKeys(input) ||
    !isEventVariantValid(input)
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.invalidInput(
      "captureLedgerValue",
    ));
  }
  const common = {
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: copyCollision(input.collision),
    sequence: input.sequence,
    previousEvent: copyEventToken(input.previousEvent),
    recordedAt: input.recordedAt,
  } as const;
  const frame: FrameworkMigrationEventFrame = (() => {
    switch (input.kind) {
      case "planAdmitted":
        return Object.freeze({
          ...common,
          kind: input.kind,
          admissionSha256: input.admissionSha256,
        });
      case "attemptStarted":
        return Object.freeze({
          ...common,
          kind: input.kind,
          attemptStartSha256: input.attemptStartSha256,
        });
      case "leaseRenewed":
        return Object.freeze({
          ...common,
          kind: input.kind,
          attemptId: input.attemptId,
          attemptFence: input.attemptFence,
          leaseOwnerId: input.leaseOwnerId,
          leaseExpiresAt: input.leaseExpiresAt,
        });
      case "stepCompleted":
        return Object.freeze({
          ...common,
          kind: input.kind,
          stepReceiptSha256: input.stepReceiptSha256,
        });
      case "attemptTerminated":
        return Object.freeze({
          ...common,
          kind: input.kind,
          terminalSha256: input.terminalSha256,
        });
      case "installationPublished":
        return Object.freeze({
          ...common,
          kind: input.kind,
          installationReceiptSha256: input.installationReceiptSha256,
        });
      case "readinessPublished":
        return Object.freeze({
          ...common,
          kind: input.kind,
          readinessSha256: input.readinessSha256,
        });
    }
  })();
  return yield* captureLedgerValue(frame, brandEventSha256);
});

export function classifyFrameworkMigrationPlanReplay(
  left: FreshRelationalMigrationPlan,
  right: FreshRelationalMigrationPlan,
): "exact" | "differentPlan" | "digestCollision" {
  if (left.migrationPlanSha256 !== right.migrationPlanSha256) {
    return "differentPlan";
  }
  return left.canonicalJson === right.canonicalJson
    ? "exact"
    : "digestCollision";
}

export type StoredFrameworkMigrationValueKind =
  | "targetNamespace"
  | "plan"
  | "planAdmission"
  | "collisionHead"
  | "attemptStart"
  | "stepReceipt"
  | "attemptTerminal"
  | "event";

export interface VerifyStoredFrameworkMigrationValueInput {
  readonly kind: StoredFrameworkMigrationValueKind;
  readonly canonicalBytes: unknown;
  readonly sha256Hex: unknown;
}

export const verifyStoredFrameworkMigrationValue = Effect.fn(
  "FrameworkMigrationValue.verifyStored",
)(function* (
  input: VerifyStoredFrameworkMigrationValueInput,
): Effect.fn.Return<JsonObject, FrameworkMigrationValueError> {
  const contract = storedMigrationContract(input.kind);
  const frame = yield* verifyStoredPrivateCanonicalValue({
    canonicalBytes: input.canonicalBytes,
    sha256Hex: input.sha256Hex,
    expectedFormat: contract.format,
    expectedVersion: contract.version,
    maximumCanonicalBytes: contract.maximumBytes,
    expectedKeys: contract.keys,
    validateFrame: candidate => input.kind === "event"
      ? isStoredEventFrame(candidate)
      : isStoredMigrationNonEventFrame(input.kind, candidate),
  }, {
    storedCorruption: FrameworkMigrationValueError.storedStateCorrupt,
    hashFailure: cause => FrameworkMigrationValueError.resourceFailure(
      "decodeStoredValue",
      cause,
    ),
  });
  if (input.kind === "event" && !isStoredEventFrame(frame)) {
    return yield* Effect.fail(FrameworkMigrationValueError.storedStateCorrupt());
  }
  if (
    input.kind !== "event" &&
    !isStoredMigrationNonEventFrame(input.kind, frame)
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.storedStateCorrupt());
  }
  if (
    input.kind === "plan" &&
    !(yield* validateStoredMigrationPlanDigests(frame))
  ) {
    return yield* Effect.fail(FrameworkMigrationValueError.storedStateCorrupt());
  }
  return frame;
});

const validateStoredMigrationPlanDigests = Effect.fn(
  "FrameworkMigrationValue.validateStoredPlanDigests",
)(function* (
  frame: JsonObject,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  if (
    !isJsonObjectFromUnknown(frame.physicalLayout) ||
    !isSha256(frame.physicalLayoutSha256) ||
    !Array.isArray(frame.steps)
  ) return false;
  const layout = yield* capturePrivateCanonicalValue(
    frame.physicalLayout,
    MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
    storedMigrationHashPolicy(),
  );
  if (layout.sha256Hex !== frame.physicalLayoutSha256) return false;
  for (const candidate of frame.steps) {
    if (!isJsonObjectFromUnknown(candidate)) return false;
    const valid = yield* validateStoredMigrationStepDigests(
      candidate,
      frame.physicalLayoutSha256,
    );
    if (!valid) return false;
  }
  return true;
});

const validateStoredMigrationStepDigests = Effect.fn(
  "FrameworkMigrationValue.validateStoredStepDigests",
)(function* (
  step: JsonObject,
  physicalLayoutSha256: string,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  if (
    !isJsonObjectFromUnknown(step.precondition) ||
    !isJsonObjectFromUnknown(step.postcondition) ||
    !isJsonObjectFromUnknown(step.operation) ||
    typeof step.stepId !== "string" ||
    !isSha256(step.stepSha256) ||
    !isSha256(step.preconditionSha256) ||
    !isSha256(step.postconditionSha256)
  ) return false;
  const precondition = yield* capturePrivateCanonicalValue(
    step.precondition,
    4_096,
    storedMigrationHashPolicy(),
  );
  const postcondition = yield* capturePrivateCanonicalValue(
    step.postcondition,
    4_096,
    storedMigrationHashPolicy(),
  );
  if (
    precondition.sha256Hex !== step.preconditionSha256 ||
    postcondition.sha256Hex !== step.postconditionSha256 ||
    !(yield* validateStoredOperationProjection(
      step.operation,
      physicalLayoutSha256,
    ))
  ) return false;
  const { stepId: _stepId, stepSha256: _stepSha256, ...body } = step;
  const capturedStep = yield* capturePrivateCanonicalValue(
    Object.freeze(body),
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    storedMigrationHashPolicy(),
  );
  return capturedStep.sha256Hex === step.stepSha256 &&
    step.stepId === `step_${capturedStep.sha256Hex.slice(0, 32)}`;
});

const validateStoredOperationProjection = Effect.fn(
  "FrameworkMigrationValue.validateStoredOperationProjection",
)(function* (
  operation: JsonObject,
  physicalLayoutSha256: string,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  if (!isJsonObjectFromUnknown(operation.codec)) return false;
  const format = operation.codec.format;
  if (format === "flarex.relational-validate-structure") {
    return operation.expectedLayoutSha256 === physicalLayoutSha256;
  }
  const projectionKind = format === "flarex.relational-create-table"
    ? "table"
    : format === "flarex.relational-create-index"
    ? "index"
    : format === "flarex.relational-add-foreign-key"
    ? "foreignKey"
    : undefined;
  const projection = projectionKind === "table"
    ? operation.table
    : projectionKind === "index"
    ? operation.index
    : projectionKind === "foreignKey"
    ? operation.foreignKey
    : undefined;
  const expected = projectionKind === "table"
    ? operation.expectedTableSha256
    : projectionKind === "index"
    ? operation.expectedIndexSha256
    : projectionKind === "foreignKey"
    ? operation.expectedForeignKeySha256
    : undefined;
  if (
    projectionKind === undefined ||
    !isJsonObjectFromUnknown(projection) ||
    !isSha256(expected)
  ) return false;
  const captured = yield* capturePrivateCanonicalValue(
    Object.freeze({ kind: projectionKind, value: projection }),
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    storedMigrationHashPolicy(),
  );
  return captured.sha256Hex === expected;
});

function collisionCoordinate(
  layout: RelationalPhysicalLayout,
): FrameworkMigrationCollisionCoordinate {
  return Object.freeze({
    targetNamespace: layout.targetNamespace.frame,
    owner: "system",
    lineageId: layout.frame.artifact.lineageId,
    physicalNamespaceProfile: RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
  });
}

function createTableProjection(
  table: RelationalPhysicalTable,
): Omit<RelationalPhysicalTable, "indexes"> & JsonObject {
  return Object.freeze({
    identity: table.identity,
    name: table.name,
    scopeColumn: table.scopeColumn,
    columns: table.columns,
    keys: table.keys,
    checks: table.checks,
  });
}

function foreignKeyDependencies(
  foreignKey: RelationalPhysicalForeignKey,
  tableSteps: ReadonlyMap<string, FrameworkMigrationStepReference>,
): Result.Result<
  readonly FrameworkMigrationStepReference[],
  FrameworkMigrationValueError
> {
  const sourceTableId = foreignKey.kind === "scopeAuthorityForeignKey"
    ? foreignKey.table.tableId
    : foreignKey.sourceTable.tableId;
  const source = tableSteps.get(sourceTableId);
  if (source === undefined) {
    return Result.fail(FrameworkMigrationValueError.invalidInput(
      "capturePlan",
    ));
  }
  if (foreignKey.kind === "scopeAuthorityForeignKey") {
    return Result.succeed(Object.freeze([source]));
  }
  const target = tableSteps.get(foreignKey.targetTable.tableId);
  if (target === undefined) {
    return Result.fail(FrameworkMigrationValueError.invalidInput(
      "capturePlan",
    ));
  }
  const dependencies = source.stepId === target.stepId
    ? [source]
    : [source, target].toSorted((left, right) => compareUtf16Strings(
        left.stepId,
        right.stepId,
      ));
  return Result.succeed(Object.freeze(dependencies));
}

function structuralOperationPolicy(
  operation: RelationalStructuralOperation,
): Result.Result<Readonly<{
  readonly phase: FrameworkMigrationStep["phase"];
  readonly preconditionKind: FrameworkMigrationCondition["kind"];
  readonly projectionKind: FrameworkMigrationCondition["projectionKind"];
  readonly projectionSha256: string;
}>, FrameworkMigrationValueError> {
  const format = operation.codec.format;
  switch (format) {
    case "flarex.relational-create-table": {
      const projectionSha256 = operation.expectedTableSha256;
      if (!isSha256(projectionSha256)) return invalidStructuralOperation();
      return Result.succeed(Object.freeze({
        phase: "expansion",
        preconditionKind: "absentOrExact",
        projectionKind: "table",
        projectionSha256,
      }));
    }
    case "flarex.relational-create-index": {
      const projectionSha256 = operation.expectedIndexSha256;
      if (!isSha256(projectionSha256)) return invalidStructuralOperation();
      return Result.succeed(Object.freeze({
        phase: "expansion",
        preconditionKind: "absentOrExact",
        projectionKind: "index",
        projectionSha256,
      }));
    }
    case "flarex.relational-add-foreign-key": {
      const projectionSha256 = operation.expectedForeignKeySha256;
      if (!isSha256(projectionSha256)) return invalidStructuralOperation();
      return Result.succeed(Object.freeze({
        phase: "expansion",
        preconditionKind: "absentOrExact",
        projectionKind: "foreignKey",
        projectionSha256,
      }));
    }
    case "flarex.relational-validate-structure": {
      const projectionSha256 = operation.expectedLayoutSha256;
      if (!isSha256(projectionSha256)) return invalidStructuralOperation();
      return Result.succeed(Object.freeze({
        phase: "validation",
        preconditionKind: "exact",
        projectionKind: "layout",
        projectionSha256,
      }));
    }
  }
}

function invalidStructuralOperation(): Result.Result<
  never,
  FrameworkMigrationValueError
> {
  return Result.fail(FrameworkMigrationValueError.invalidInput("capturePlan"));
}

const captureStep = Effect.fn("FrameworkMigrationStep.capture")(
  function* (
    ordinal: number,
    dependencies: readonly FrameworkMigrationStepReference[],
    operation: RelationalStructuralOperation,
  ): Effect.fn.Return<FrameworkMigrationStep, FrameworkMigrationValueError> {
    const policy = yield* Effect.fromResult(structuralOperationPolicy(operation));
    const precondition = Object.freeze({
      kind: policy.preconditionKind,
      projectionKind: policy.projectionKind,
      projectionSha256: policy.projectionSha256,
    } satisfies FrameworkMigrationCondition);
    const postcondition = Object.freeze({
      kind: "exact",
      projectionKind: policy.projectionKind,
      projectionSha256: policy.projectionSha256,
    } satisfies FrameworkMigrationCondition);
    const preconditionSha256 = yield* hashCondition(precondition);
    const postconditionSha256 = yield* hashCondition(postcondition);
    const body = Object.freeze({
      ordinal,
      phase: policy.phase,
      transactionMode: "transactionBound",
      dependencies,
      precondition,
      preconditionSha256,
      postcondition,
      postconditionSha256,
      executionCapability: "postgres-transactional-relational-structure",
      replayPolicy: "exactReceipt",
      checkpointPolicy: "afterStep",
      operation,
    } as const satisfies JsonObject);
    const captured = yield* capturePrivateCanonicalValue(
      body,
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
      migrationErrorPolicy("capturePlan"),
    );
    const stepSha256 = brandStepSha256(captured.sha256Hex);
    return Object.freeze({
      stepId: brandStepId(`step_${captured.sha256Hex.slice(0, 32)}`),
      stepSha256,
      ...body,
    });
  },
);

const hashProjection = Effect.fn("FrameworkMigrationPlan.hashProjection")(
  function* (
    kind: "table" | "index" | "foreignKey",
    value: RelationalPhysicalTable | RelationalPhysicalIndex |
      RelationalPhysicalForeignKey | (Omit<RelationalPhysicalTable, "indexes"> &
        JsonObject),
  ): Effect.fn.Return<
    RelationalPhysicalProjectionSha256,
    FrameworkMigrationValueError
  > {
    const frame = Object.freeze({ kind, value } satisfies JsonObject);
    const captured = yield* capturePrivateCanonicalValue(
      frame,
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
      migrationErrorPolicy("capturePlan"),
    );
    return brandProjectionSha256(captured.sha256Hex);
  },
);

const hashCondition = Effect.fn("FrameworkMigrationPlan.hashCondition")(
  function* (
    condition: FrameworkMigrationCondition,
  ): Effect.fn.Return<
    FrameworkMigrationConditionSha256,
    FrameworkMigrationValueError
  > {
    const captured = yield* capturePrivateCanonicalValue(
      condition,
      4_096,
      migrationErrorPolicy("capturePlan"),
    );
    return brandConditionSha256(captured.sha256Hex);
  },
);

function captureLedgerValue<Frame extends JsonObject, Sha>(
  frame: Frame,
  brand: (value: string) => Sha,
): Effect.Effect<
  CapturedFrameworkMigrationValue<Frame, Sha>,
  FrameworkMigrationValueError
> {
  return Effect.map(
    capturePrivateCanonicalValue(
      frame,
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
      migrationErrorPolicy("captureLedgerValue"),
    ),
    captured => Object.freeze({
      frame,
      sha256: brand(captured.sha256Hex),
      canonicalJson: captured.canonicalJson,
    }),
  );
}

function captureCurrentAttempt(
  input: CaptureFrameworkMigrationCollisionHeadInput["currentAttempt"],
): Result.Result<
  FrameworkMigrationCurrentAttempt | null,
  FrameworkMigrationValueError
> {
  if (input === null) return Result.succeed(null);
  return Result.gen(function* () {
    return Object.freeze({
      attemptId: yield* attemptId(input.attemptId),
      attemptFence: yield* nonNegativeInt64(input.attemptFence),
      leaseOwnerId: yield* leaseOwnerId(input.leaseOwnerId),
      leaseExpiresAt: yield* canonicalInstant(input.leaseExpiresAt),
    });
  });
}

function captureAttemptOutcome(
  input: unknown,
): Result.Result<FrameworkMigrationAttemptOutcome, FrameworkMigrationValueError> {
  try {
    if (
      hasExactOwnDataKeys(input, ["kind", "requiredStepSetSha256"]) &&
      input.kind === "succeeded" &&
      isSha256(input.requiredStepSetSha256)
    ) {
      return Result.succeed(Object.freeze({
        kind: input.kind,
        requiredStepSetSha256: input.requiredStepSetSha256,
      }));
    }
    if (
      hasExactOwnDataKeys(input, ["kind", "reason", "evidenceSha256"]) &&
      input.kind === "failed" &&
      isFrameworkMigrationFailureReason(input.reason) &&
      isSha256(input.evidenceSha256)
    ) {
      return Result.succeed(Object.freeze({
        kind: input.kind,
        reason: input.reason,
        evidenceSha256: input.evidenceSha256,
      }));
    }
    if (
      hasExactOwnDataKeys(input, ["kind", "evidenceSha256"]) &&
      input.kind === "decisionUncertain" &&
      isSha256(input.evidenceSha256)
    ) {
      return Result.succeed(Object.freeze({
        kind: input.kind,
        evidenceSha256: input.evidenceSha256,
      }));
    }
  } catch {
    return invalidLedgerResult();
  }
  return invalidLedgerResult();
}

function isFrameworkMigrationFailureReason(
  input: unknown,
): input is Extract<
  FrameworkMigrationAttemptOutcome,
  { readonly kind: "failed" }
>["reason"] {
  return input === "operationFailed" ||
    input === "validationFailed" ||
    input === "leaseLost" ||
    input === "superseded";
}

function sameAssignments(
  left: readonly Readonly<{
    readonly canonicalJson: string;
    readonly assignmentSha256: string;
    readonly frame: Readonly<{ readonly spelling: string }>;
  }>[],
  right: readonly Readonly<{
    readonly canonicalJson: string;
    readonly assignmentSha256: string;
    readonly frame: Readonly<{ readonly spelling: string }>;
  }>[],
): boolean {
  return left.length === right.length && left.every((value, index) =>
    value.canonicalJson === right[index]?.canonicalJson &&
    value.assignmentSha256 === right[index]?.assignmentSha256 &&
    value.frame.spelling === right[index]?.frame.spelling
  );
}

function sameArtifactIdentity(
  left: Readonly<{ deploymentId: string; owner: string; lineageId: string;
    artifactSha256: string }>,
  right: Readonly<{ deploymentId: string; owner: string; lineageId: string;
    artifactSha256: string }>,
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.owner === right.owner &&
    left.lineageId === right.lineageId &&
    left.artifactSha256 === right.artifactSha256;
}

function copyArtifactIdentity(
  identity: FrameworkSchemaArtifactIdentity,
): Readonly<FrameworkSchemaArtifactIdentity> & JsonObject {
  return Object.freeze({
    deploymentId: identity.deploymentId,
    owner: identity.owner,
    lineageId: identity.lineageId,
    artifactSha256: identity.artifactSha256,
  } satisfies JsonObject);
}

function copyLocator(
  locator: FreshRelationalMigrationPlanFrame["physicalLocator"],
) {
  return Object.freeze({
    kind: locator.kind,
    databaseKey: locator.databaseKey,
    schemaName: locator.schemaName,
  });
}

function copyCollision(
  collision: FrameworkMigrationCollisionCoordinate,
): FrameworkMigrationCollisionCoordinate {
  return Object.freeze({
    targetNamespace: Object.freeze({
      format: collision.targetNamespace.format,
      version: collision.targetNamespace.version,
      deploymentId: collision.targetNamespace.deploymentId,
      physicalDatabaseIdentity:
        collision.targetNamespace.physicalDatabaseIdentity,
      schemaName: collision.targetNamespace.schemaName,
    }),
    owner: collision.owner,
    lineageId: collision.lineageId,
    physicalNamespaceProfile: collision.physicalNamespaceProfile,
  });
}

function copyEventToken(
  token: FrameworkMigrationEventToken | null,
): FrameworkMigrationEventToken | null {
  return token === null
    ? null
    : Object.freeze({
        sequence: token.sequence,
        eventSha256: token.eventSha256,
      });
}

function stepsHaveUniqueIdentities(
  steps: readonly FrameworkMigrationStep[],
): boolean {
  const stepIds = new Set<string>();
  const stepDigests = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.stepId) || stepDigests.has(step.stepSha256)) {
      return false;
    }
    stepIds.add(step.stepId);
    stepDigests.add(step.stepSha256);
  }
  return true;
}

function hasExactEventKeys(input: unknown): boolean {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, "kind");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      return false;
    }
    const keys = eventKeys(descriptor.value);
    return keys !== undefined && hasExactOwnDataKeys(input, keys);
  } catch {
    return false;
  }
}

function isStoredEventFrame(frame: JsonObject): boolean {
  if (
    !hasExactEventKeys(frame) ||
    frame.format !== FRAMEWORK_MIGRATION_EVENT_FORMAT ||
    frame.version !== FRAMEWORK_MIGRATION_EVENT_VERSION ||
    !isCanonicalNonNegativeInt64(frame.sequence) ||
    !isCanonicalIsoInstant(frame.recordedAt) ||
    !isCollisionCoordinate(frame.collision) ||
    !isEventTokenOrNull(frame.previousEvent)
  ) {
    return false;
  }
  switch (frame.kind) {
    case "planAdmitted":
      return isSha256(frame.admissionSha256);
    case "attemptStarted":
      return isSha256(frame.attemptStartSha256);
    case "leaseRenewed":
      return identityText(frame.attemptId) &&
        isCanonicalNonNegativeInt64(frame.attemptFence) &&
        identityText(frame.leaseOwnerId) &&
        isCanonicalIsoInstant(frame.leaseExpiresAt);
    case "stepCompleted":
      return isSha256(frame.stepReceiptSha256);
    case "attemptTerminated":
      return isSha256(frame.terminalSha256);
    case "installationPublished":
      return isSha256(frame.installationReceiptSha256);
    case "readinessPublished":
      return isSha256(frame.readinessSha256);
    default:
      return false;
  }
}

export function isStoredFrameworkMigrationEventFrame(
  frame: JsonObject,
): frame is FrameworkMigrationEventFrame {
  return isStoredEventFrame(frame);
}

function isEventVariantValid(input: FrameworkMigrationEventFrame): boolean {
  switch (input.kind) {
    case "planAdmitted":
      return isSha256(input.admissionSha256);
    case "attemptStarted":
      return isSha256(input.attemptStartSha256);
    case "leaseRenewed":
      return identityText(input.attemptId) &&
        isCanonicalNonNegativeInt64(input.attemptFence) &&
        identityText(input.leaseOwnerId) &&
        isCanonicalIsoInstant(input.leaseExpiresAt);
    case "stepCompleted":
      return isSha256(input.stepReceiptSha256);
    case "attemptTerminated":
      return isSha256(input.terminalSha256);
    case "installationPublished":
      return isSha256(input.installationReceiptSha256);
    case "readinessPublished":
      return isSha256(input.readinessSha256);
  }
}

function eventKeys(input: string): readonly string[] | undefined {
  switch (input) {
    case "planAdmitted":
    case "attemptStarted":
    case "leaseRenewed":
    case "stepCompleted":
    case "attemptTerminated":
    case "installationPublished":
    case "readinessPublished":
      return EVENT_KEYS[input];
    default:
      return undefined;
  }
}

function isCollisionCoordinate(input: unknown): boolean {
  try {
    return hasExactOwnDataKeys(input, [
      "targetNamespace",
      "owner",
      "lineageId",
      "physicalNamespaceProfile",
    ]) &&
      isTargetNamespaceFrame(input.targetNamespace) &&
      (input.owner === "system" || input.owner === "medusa") &&
      identityText(input.lineageId) &&
      input.physicalNamespaceProfile === RELATIONAL_PHYSICAL_NAMESPACE_PROFILE;
  } catch {
    return false;
  }
}

function isTargetNamespaceFrame(input: unknown): boolean {
  try {
    return hasExactOwnDataKeys(input, [
      "format",
      "version",
      "deploymentId",
      "physicalDatabaseIdentity",
      "schemaName",
    ]) &&
      input.format === FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT &&
      input.version === FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION &&
      identityText(input.deploymentId) &&
      identityText(input.physicalDatabaseIdentity) &&
      identityTextWithin(input.schemaName, 63);
  } catch {
    return false;
  }
}

function isEventTokenOrNull(
  input: unknown,
): input is FrameworkMigrationEventToken | null {
  if (input === null) return true;
  try {
    return hasExactOwnDataKeys(input, ["sequence", "eventSha256"]) &&
      isCanonicalNonNegativeInt64(input.sequence) &&
      isSha256(input.eventSha256);
  } catch {
    return false;
  }
}

function stepReference(
  step: FrameworkMigrationStep,
): FrameworkMigrationStepReference {
  return Object.freeze({
    stepId: step.stepId,
    stepSha256: step.stepSha256,
  });
}

function nonNegativeInt64(
  input: unknown,
): Result.Result<CanonicalNonNegativeInt64, FrameworkMigrationValueError> {
  return isCanonicalNonNegativeInt64(input)
    ? Result.succeed(brandNonNegativeInt64(input))
    : invalidLedgerResult();
}

function isCanonicalNonNegativeInt64(input: unknown): input is string {
  return typeof input === "string" &&
    NON_NEGATIVE_INT64.test(input) &&
    (input.length < MAX_INT64_TEXT.length || input <= MAX_INT64_TEXT);
}

function attemptId(
  input: unknown,
): Result.Result<FrameworkMigrationAttemptId, FrameworkMigrationValueError> {
  return identityText(input)
    ? Result.succeed(brandAttemptId(input))
    : invalidLedgerResult();
}

function leaseOwnerId(
  input: unknown,
): Result.Result<FrameworkMigrationLeaseOwnerId, FrameworkMigrationValueError> {
  return identityText(input)
    ? Result.succeed(brandLeaseOwnerId(input))
    : invalidLedgerResult();
}

function identityText(input: unknown): input is string {
  return identityTextWithin(input, 512);
}

function identityTextWithin(
  input: unknown,
  maximumUtf8Bytes: number,
): input is string {
  return isNonBlankString(input) &&
    !input.includes("\0") &&
    isWellFormedUtf16(input) &&
    UTF8.encode(input).byteLength <= maximumUtf8Bytes;
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function canonicalInstant(
  input: unknown,
): Result.Result<
  import("@flarex/time/iso-instant").CanonicalIsoInstant,
  FrameworkMigrationValueError
> {
  return isCanonicalIsoInstant(input)
    ? Result.succeed(input)
    : invalidLedgerResult();
}

function isSha256(input: unknown): input is string {
  return typeof input === "string" && LOWERCASE_SHA256.test(input);
}

function isStepId(input: unknown): input is string {
  return typeof input === "string" && STEP_ID.test(input);
}

function invalidLedgerResult(): Result.Result<
  never,
  FrameworkMigrationValueError
> {
  return Result.fail(FrameworkMigrationValueError.invalidInput(
    "captureLedgerValue",
  ));
}

function migrationErrorPolicy(
  operation: "capturePlan" | "captureLedgerValue",
) {
  return Object.freeze({
    invalidInput: () => FrameworkMigrationValueError.invalidInput(operation),
    hashFailure: (cause: unknown) =>
      FrameworkMigrationValueError.resourceFailure(operation, cause),
  });
}

function storedMigrationHashPolicy() {
  return Object.freeze({
    invalidInput: FrameworkMigrationValueError.storedStateCorrupt,
    hashFailure: (cause: unknown) =>
      FrameworkMigrationValueError.resourceFailure("decodeStoredValue", cause),
  });
}

function storedMigrationContract(kind: StoredFrameworkMigrationValueKind) {
  switch (kind) {
    case "targetNamespace":
      return Object.freeze({
        format: FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
        version: FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
        maximumBytes: MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "deploymentId",
          "physicalDatabaseIdentity",
          "schemaName",
        ]),
      });
    case "plan":
      return Object.freeze({
        format: FRAMEWORK_MIGRATION_PLAN_FORMAT,
        version: FRAMEWORK_MIGRATION_PLAN_VERSION,
        maximumBytes: MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
        keys: Object.freeze([
          "format",
          "version",
          "artifact",
          "physicalLocator",
          "targetNamespace",
          "collision",
          "baseInstallation",
          "physicalLayout",
          "physicalLayoutSha256",
          "steps",
        ]),
      });
    case "planAdmission":
      return ledgerStoredContract(
        FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
        FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
        [
          "format",
          "version",
          "collision",
          "planSha256",
          "artifact",
          "physicalLocator",
          "targetNamespace",
          "baseInstallation",
          "nameAssignments",
          "previousPlanSha256",
          "admissionProfile",
          "admittedAt",
        ],
      );
    case "collisionHead":
      return ledgerStoredContract(
        FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
        FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
        [
          "format",
          "version",
          "collision",
          "headRevision",
          "currentPlan",
          "attemptFence",
          "currentAttempt",
          "lastEvent",
          "updatedAt",
        ],
      );
    case "attemptStart":
      return ledgerStoredContract(
        FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
        FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
        [
          "format",
          "version",
          "collision",
          "planSha256",
          "admissionSha256",
          "attemptId",
          "attemptFence",
          "leaseOwnerId",
          "leaseExpiresAt",
          "previousAttemptId",
          "startedAt",
        ],
      );
    case "stepReceipt":
      return ledgerStoredContract(
        FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
        FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
        [
          "format",
          "version",
          "collision",
          "planSha256",
          "attemptId",
          "attemptFence",
          "stepId",
          "stepSha256",
          "dependencyReceipts",
          "preconditionSha256",
          "postconditionSha256",
          "observedPostconditionSha256",
          "completedAt",
        ],
      );
    case "attemptTerminal":
      return ledgerStoredContract(
        FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
        FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
        [
          "format",
          "version",
          "collision",
          "planSha256",
          "attemptId",
          "attemptFence",
          "outcome",
          "lastStepReceiptSha256",
          "terminalAt",
        ],
      );
    case "event":
      return Object.freeze({
        format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
        version: FRAMEWORK_MIGRATION_EVENT_VERSION,
        maximumBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
        keys: undefined,
      });
  }
}

function ledgerStoredContract(
  format: string,
  version: number,
  keys: readonly string[],
) {
  return Object.freeze({
    format,
    version,
    maximumBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    keys: Object.freeze(keys),
  });
}
