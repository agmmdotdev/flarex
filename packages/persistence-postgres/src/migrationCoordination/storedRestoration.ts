import { compareUtf16Strings } from "@flarex/utils/strings";
import { Brand, Effect } from "effect";

import { compareFrameworkSchemaArtifactIdentities } from
  "../frameworkSchema/artifact/policy";
import { capturePrivateCanonicalValue } from
  "../frameworkSchema/privateCanonicalValue";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
  storedDateMatchesCanonicalInstant,
  type StoredCanonicalMetadataColumns,
} from "../frameworkSchema/privateStoredMetadataValue";
import {
  MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
  MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES,
  verifyStoredRelationalPhysicalValue,
} from "../relationalSchema/physical/canonical";
import { RelationalPhysicalValueError } from
  "../relationalSchema/physical/errors";
import {
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT,
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION,
  RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
  type RelationalPhysicalNameAssignment,
} from "../relationalSchema/physical/model";
import {
  restoreStoredRelationalPhysicalLayout as restoreVerifiedRelationalPhysicalLayout,
  restoreStoredRelationalPhysicalNameAssignment as restoreVerifiedRelationalPhysicalNameAssignment,
} from "../relationalSchema/physical/storedRestoration";
import { isStoredRelationalPhysicalNameAssignmentFrame } from
  "../relationalSchema/physical/storedValidation";
import { scopePhysicalLocatorsEqual } from "../scopePhysicalLocator";
import {
  registerCapturedFrameworkMigrationPlanAdmission,
  registerCapturedFrameworkMigrationAttemptStart,
  registerCapturedFrameworkMigrationAttemptTerminal,
  registerCapturedFrameworkMigrationStepReceipt,
  registerCapturedFreshRelationalMigrationPlan,
} from "./authority";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import { FrameworkMigrationValueError } from "./errors";
import type {
  FrameworkMigrationPlanAdmissionSha256,
  FrameworkMigrationAttemptStartSha256,
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationPlanSha256,
  FrameworkMigrationStepReceiptSha256,
  RelationalPhysicalLayoutSha256,
  RelationalPhysicalNameAssignmentSha256,
} from "./identity";
import {
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
  FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
  FRAMEWORK_MIGRATION_PLAN_FORMAT,
  FRAMEWORK_MIGRATION_PLAN_VERSION,
  FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_FORMAT,
  FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_VERSION,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationAttemptStartFrame,
  type FrameworkMigrationAttemptTerminalFrame,
  type FrameworkMigrationCollisionCoordinate,
  type FrameworkMigrationPlanAdmissionFrame,
  type FrameworkMigrationStepReceiptFrame,
  type FreshRelationalMigrationPlan,
} from "./model";
import {
  isStoredCollisionCoordinate,
  isStoredFrameworkMigrationAttemptStartFrame,
  isStoredFrameworkMigrationAttemptTerminalFrame,
  isStoredFrameworkMigrationPlanAdmissionFrame,
  isStoredFrameworkMigrationStepReceiptFrame,
  isStoredFrameworkSchemaTargetNamespaceFrame,
  isStoredFreshRelationalMigrationPlanFrame,
} from "./storedValidation";
import {
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
  MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
  captureFrameworkSchemaTargetNamespace,
  type FrameworkSchemaTargetNamespace,
} from "./targetNamespace";

type StoredCanonicalRow = StoredCanonicalMetadataColumns;

export interface StoredFrameworkSchemaTargetNamespaceRow
  extends StoredCanonicalRow {
  readonly targetNamespaceStorageId: unknown;
  readonly deploymentId: unknown;
  readonly physicalDatabaseIdentity: unknown;
  readonly schemaName: unknown;
  readonly targetNamespaceSha256: unknown;
}

export interface RestoredFrameworkSchemaTargetNamespace {
  readonly storageId: bigint;
  readonly targetNamespace: FrameworkSchemaTargetNamespace;
}

export interface StoredFrameworkMigrationCollisionDomainRow {
  readonly collisionStorageId: unknown;
  readonly targetNamespaceStorageId: unknown;
  readonly physicalDatabaseIdentity: unknown;
  readonly schemaName: unknown;
  readonly owner: unknown;
  readonly lineageId: unknown;
  readonly physicalNamespaceProfile: unknown;
}

export interface RestoredFrameworkMigrationCollisionDomain {
  readonly storageId: bigint;
  readonly targetNamespace: RestoredFrameworkSchemaTargetNamespace;
  readonly coordinate: FrameworkMigrationCollisionCoordinate;
}

export interface StoredRelationalPhysicalNameAssignmentRow
  extends StoredCanonicalRow {
  readonly assignmentStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly physicalDatabaseIdentity: unknown;
  readonly schemaName: unknown;
  readonly spelling: unknown;
  readonly nameSha256: unknown;
  readonly assignmentSha256: unknown;
}

export interface RestoredRelationalPhysicalNameAssignment {
  readonly storageId: bigint;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly assignment: RelationalPhysicalNameAssignment;
}

export interface StoredFrameworkMigrationPlanRow extends StoredCanonicalRow {
  readonly planStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly artifactSha256: unknown;
  readonly locatorKind: unknown;
  readonly locatorDatabaseKey: unknown;
  readonly locatorSchemaName: unknown;
  readonly migrationPlanSha256: unknown;
  readonly requiredStepSetSha256: unknown;
  readonly physicalLayoutSha256: unknown;
}

export interface StoredFrameworkMigrationPlanStepRow {
  readonly planStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly stepOrdinal: unknown;
  readonly stepId: unknown;
  readonly stepSha256: unknown;
  readonly preconditionSha256: unknown;
  readonly postconditionSha256: unknown;
  readonly phase: unknown;
  readonly operationFormat: unknown;
  readonly operationVersion: unknown;
  readonly dependencyCount: unknown;
}

export interface StoredFrameworkMigrationPlanStepDependencyRow {
  readonly planStorageId: unknown;
  readonly sourceStepId: unknown;
  readonly dependencyOrdinal: unknown;
  readonly dependencyStepId: unknown;
  readonly dependencyStepSha256: unknown;
}

export interface RestoredFreshRelationalMigrationPlan {
  readonly storageId: bigint;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: FreshRelationalMigrationPlan;
}

export interface StoredFrameworkMigrationPlanAdmissionRow
  extends StoredCanonicalRow {
  readonly admissionStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly planStorageId: unknown;
  readonly migrationPlanSha256: unknown;
  readonly previousPlanStorageId: unknown;
  readonly previousPlanSha256: unknown;
  readonly admissionSha256: unknown;
  readonly admissionProfile: unknown;
  readonly assignmentCount: unknown;
}

export interface StoredFrameworkMigrationAdmissionAssignmentRow {
  readonly admissionStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly assignmentOrdinal: unknown;
  readonly assignmentStorageId: unknown;
  readonly spelling: unknown;
  readonly assignmentSha256: unknown;
}

export interface RestoredFrameworkMigrationPlanAdmission {
  readonly storageId: bigint;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: CapturedFrameworkMigrationValue<
    FrameworkMigrationPlanAdmissionFrame,
    FrameworkMigrationPlanAdmissionSha256
  >;
}

export interface StoredFrameworkMigrationAttemptStartRow
  extends StoredCanonicalRow {
  readonly attemptStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly planStorageId: unknown;
  readonly migrationPlanSha256: unknown;
  readonly admissionStorageId: unknown;
  readonly admissionSha256: unknown;
  readonly attemptId: unknown;
  readonly attemptFence: unknown;
  readonly leaseOwnerId: unknown;
  readonly leaseExpiresAt: unknown;
  readonly previousAttemptStorageId: unknown;
  readonly previousAttemptId: unknown;
  readonly attemptStartSha256: unknown;
}

export interface RestoredFrameworkMigrationAttemptStart {
  readonly storageId: bigint;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly attempt: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptStartFrame,
    FrameworkMigrationAttemptStartSha256
  >;
}

export interface StoredFrameworkMigrationStepReceiptRow
  extends StoredCanonicalRow {
  readonly receiptStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly planStorageId: unknown;
  readonly attemptStorageId: unknown;
  readonly attemptId: unknown;
  readonly attemptFence: unknown;
  readonly stepId: unknown;
  readonly stepSha256: unknown;
  readonly preconditionSha256: unknown;
  readonly postconditionSha256: unknown;
  readonly observedPostconditionSha256: unknown;
  readonly dependencyCount: unknown;
  readonly stepReceiptSha256: unknown;
}

export interface StoredFrameworkMigrationStepReceiptDependencyRow {
  readonly receiptStorageId: unknown;
  readonly attemptStorageId: unknown;
  readonly dependencyOrdinal: unknown;
  readonly dependencyReceiptStorageId: unknown;
  readonly dependencyStepId: unknown;
  readonly dependencyStepReceiptSha256: unknown;
}

export interface RestoredFrameworkMigrationStepReceipt {
  readonly storageId: bigint;
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly receipt: CapturedFrameworkMigrationValue<
    FrameworkMigrationStepReceiptFrame,
    FrameworkMigrationStepReceiptSha256
  >;
}

export interface StoredFrameworkMigrationAttemptTerminalRow
  extends StoredCanonicalRow {
  readonly terminalStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly planStorageId: unknown;
  readonly attemptStorageId: unknown;
  readonly admissionStorageId: unknown;
  readonly admissionSha256: unknown;
  readonly attemptId: unknown;
  readonly attemptFence: unknown;
  readonly outcomeKind: unknown;
  readonly requiredStepSetSha256: unknown;
  readonly failureReason: unknown;
  readonly evidenceSha256: unknown;
  readonly lastReceiptStorageId: unknown;
  readonly lastStepReceiptSha256: unknown;
  readonly attemptTerminalSha256: unknown;
}

export interface RestoredFrameworkMigrationAttemptTerminal {
  readonly storageId: bigint;
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly terminal: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptTerminalFrame,
    FrameworkMigrationAttemptTerminalSha256
  >;
}

const restoredTargetNamespaces = new WeakSet<
  RestoredFrameworkSchemaTargetNamespace
>();
const restoredCollisions = new WeakSet<
  RestoredFrameworkMigrationCollisionDomain
>();
const restoredAssignments = new WeakSet<
  RestoredRelationalPhysicalNameAssignment
>();
const restoredPlans = new WeakSet<RestoredFreshRelationalMigrationPlan>();
const restoredAdmissions = new WeakSet<
  RestoredFrameworkMigrationPlanAdmission
>();
const restoredAttempts = new WeakSet<RestoredFrameworkMigrationAttemptStart>();
const restoredStepReceipts = new WeakSet<
  RestoredFrameworkMigrationStepReceipt
>();
const restoredTerminals = new WeakSet<
  RestoredFrameworkMigrationAttemptTerminal
>();

const brandAssignmentSha256 =
  Brand.nominal<RelationalPhysicalNameAssignmentSha256>();
const brandLayoutSha256 = Brand.nominal<RelationalPhysicalLayoutSha256>();
const brandPlanSha256 = Brand.nominal<FrameworkMigrationPlanSha256>();
const brandAdmissionSha256 =
  Brand.nominal<FrameworkMigrationPlanAdmissionSha256>();
const brandAttemptStartSha256 =
  Brand.nominal<FrameworkMigrationAttemptStartSha256>();
const brandStepReceiptSha256 =
  Brand.nominal<FrameworkMigrationStepReceiptSha256>();
const brandTerminalSha256 =
  Brand.nominal<FrameworkMigrationAttemptTerminalSha256>();

export const restoreStoredFrameworkSchemaTargetNamespace = Effect.fn(
  "FrameworkSchemaTargetNamespace.restoreStored",
)(function* (
  row: StoredFrameworkSchemaTargetNamespaceRow,
): Effect.fn.Return<
  RestoredFrameworkSchemaTargetNamespace,
  FrameworkMigrationValueError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.targetNamespaceStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  const stored = yield* decodeMigrationCanonical(
    row,
    row.targetNamespaceSha256,
    FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
    FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
    MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "targetNamespace",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  if (
    !isStoredFrameworkSchemaTargetNamespaceFrame(frame) ||
    row.deploymentId !== frame.deploymentId ||
    row.physicalDatabaseIdentity !== frame.physicalDatabaseIdentity ||
    row.schemaName !== frame.schemaName
  ) {
    return yield* corrupt();
  }
  const targetNamespace = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId: frame.deploymentId,
    physicalDatabaseIdentity: frame.physicalDatabaseIdentity,
    schemaName: frame.schemaName,
  });
  if (
    targetNamespace.targetNamespaceSha256 !== stored.sha256Hex ||
    targetNamespace.canonicalJson !== stored.canonicalJson
  ) {
    return yield* corrupt();
  }
  const restored = Object.freeze({ storageId, targetNamespace });
  restoredTargetNamespaces.add(restored);
  return restored;
});

export function isRestoredFrameworkSchemaTargetNamespace(
  input: RestoredFrameworkSchemaTargetNamespace,
): boolean {
  return restoredTargetNamespaces.has(input);
}

export const restoreStoredFrameworkMigrationCollisionDomain = Effect.fn(
  "FrameworkMigrationCollisionDomain.restoreStored",
)(function* (
  row: StoredFrameworkMigrationCollisionDomainRow,
  targetNamespace: RestoredFrameworkSchemaTargetNamespace,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationValueError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.collisionStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !restoredTargetNamespaces.has(targetNamespace) ||
    row.targetNamespaceStorageId !== targetNamespace.storageId ||
    row.physicalDatabaseIdentity !==
      targetNamespace.targetNamespace.frame.physicalDatabaseIdentity ||
    row.schemaName !== targetNamespace.targetNamespace.frame.schemaName
  ) {
    return yield* corrupt();
  }
  const coordinateCandidate = Object.freeze({
    targetNamespace: targetNamespace.targetNamespace.frame,
    owner: row.owner,
    lineageId: row.lineageId,
    physicalNamespaceProfile: row.physicalNamespaceProfile,
  });
  if (
    !isStoredCollisionCoordinate(coordinateCandidate) ||
    coordinateCandidate.physicalNamespaceProfile !==
      RELATIONAL_PHYSICAL_NAMESPACE_PROFILE
  ) {
    return yield* corrupt();
  }
  const coordinate = Object.freeze({
    targetNamespace: targetNamespace.targetNamespace.frame,
    owner: coordinateCandidate.owner,
    lineageId: coordinateCandidate.lineageId,
    physicalNamespaceProfile: RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
  } satisfies FrameworkMigrationCollisionCoordinate);
  const restored = Object.freeze({
    storageId,
    targetNamespace,
    coordinate,
  });
  restoredCollisions.add(restored);
  return restored;
});

export function isRestoredFrameworkMigrationCollisionDomain(
  input: RestoredFrameworkMigrationCollisionDomain,
): boolean {
  return restoredCollisions.has(input);
}

export const restoreStoredRelationalPhysicalNameAssignment = Effect.fn(
  "RelationalPhysicalNameAssignment.restoreStoredMetadata",
)(function* (
  row: StoredRelationalPhysicalNameAssignmentRow,
  collision: RestoredFrameworkMigrationCollisionDomain,
): Effect.fn.Return<
  RestoredRelationalPhysicalNameAssignment,
  FrameworkMigrationValueError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.assignmentStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !restoredCollisions.has(collision) ||
    row.collisionStorageId !== collision.storageId ||
    row.physicalDatabaseIdentity !==
      collision.coordinate.targetNamespace.physicalDatabaseIdentity ||
    row.schemaName !== collision.coordinate.targetNamespace.schemaName
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeMigrationCanonical(
    row,
    row.assignmentSha256,
    RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT,
    RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION,
    MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredRelationalPhysicalValue({
    kind: "nameAssignment",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(mapPhysicalRestorationError));
  const nameSha256 = yield* storedSha256(row.nameSha256);
  if (
    !isStoredRelationalPhysicalNameAssignmentFrame(frame) ||
    !sameTargetFrame(frame.targetNamespace, collision.coordinate.targetNamespace) ||
    frame.name.owner !== collision.coordinate.owner ||
    frame.name.lineageId !== collision.coordinate.lineageId ||
    frame.name.physicalNamespaceProfile !==
      collision.coordinate.physicalNamespaceProfile ||
    row.spelling !== frame.spelling ||
    nameSha256 !== frame.nameSha256
  ) {
    return yield* corrupt();
  }
  const assignment = yield* restoreVerifiedRelationalPhysicalNameAssignment({
    frame,
    assignmentSha256: brandAssignmentSha256(stored.sha256Hex),
    canonicalJson: stored.canonicalJson,
  }).pipe(Effect.mapError(mapPhysicalRestorationError));
  const restored = Object.freeze({ storageId, collision, assignment });
  restoredAssignments.add(restored);
  return restored;
});

export function isRestoredRelationalPhysicalNameAssignment(
  input: RestoredRelationalPhysicalNameAssignment,
): boolean {
  return restoredAssignments.has(input);
}

export interface RestoreStoredFreshRelationalMigrationPlanInput {
  readonly row: StoredFrameworkMigrationPlanRow;
  readonly stepRows: readonly StoredFrameworkMigrationPlanStepRow[];
  readonly dependencyRows:
    readonly StoredFrameworkMigrationPlanStepDependencyRow[];
  readonly targetNamespace: RestoredFrameworkSchemaTargetNamespace;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly nameAssignments:
    readonly RestoredRelationalPhysicalNameAssignment[];
}

export const restoreStoredFreshRelationalMigrationPlan = Effect.fn(
  "FrameworkMigrationPlan.restoreStored",
)(function* (
  input: RestoreStoredFreshRelationalMigrationPlanInput,
): Effect.fn.Return<
  RestoredFreshRelationalMigrationPlan,
  FrameworkMigrationValueError
> {
  const { row } = input;
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.planStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !restoredTargetNamespaces.has(input.targetNamespace) ||
    !restoredCollisions.has(input.collision) ||
    input.collision.targetNamespace !== input.targetNamespace ||
    row.collisionStorageId !== input.collision.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeMigrationCanonical(
    row,
    row.migrationPlanSha256,
    FRAMEWORK_MIGRATION_PLAN_FORMAT,
    FRAMEWORK_MIGRATION_PLAN_VERSION,
    MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "plan",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const artifactSha256 = yield* storedSha256(row.artifactSha256);
  const requiredStepSetSha256 = yield* storedSha256(
    row.requiredStepSetSha256,
  );
  const physicalLayoutSha256 = yield* storedSha256(
    row.physicalLayoutSha256,
  );
  if (
    !isStoredFreshRelationalMigrationPlanFrame(frame) ||
    !sameTargetFrame(
      frame.targetNamespace,
      input.targetNamespace.targetNamespace.frame,
    ) ||
    !sameCollision(frame.collision, input.collision.coordinate) ||
    artifactSha256 !== frame.artifact.artifactSha256 ||
    row.locatorKind !== frame.physicalLocator.kind ||
    row.locatorDatabaseKey !== frame.physicalLocator.databaseKey ||
    row.locatorSchemaName !== frame.physicalLocator.schemaName ||
    physicalLayoutSha256 !== frame.physicalLayoutSha256 ||
    frame.physicalLayoutSha256 !== physicalLayoutSha256 ||
    input.nameAssignments.length !== frame.physicalLayout.nameAssignments.length
  ) {
    return yield* corrupt();
  }
  for (let index = 0; index < input.nameAssignments.length; index += 1) {
    const restored = input.nameAssignments[index];
    if (
      restored === undefined ||
      !restoredAssignments.has(restored) ||
      restored.collision !== input.collision
    ) {
      return yield* corrupt();
    }
  }
  yield* verifyPlanSidecars(
    storageId,
    input.collision.storageId,
    frame.steps,
    input.stepRows,
    input.dependencyRows,
  );
  const requiredStepSet = yield* capturePrivateCanonicalValue(
    Object.freeze({
      format: FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_FORMAT,
      version: FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_VERSION,
      steps: Object.freeze(frame.steps.map(step => Object.freeze({
        stepId: step.stepId,
        stepSha256: step.stepSha256,
      }))),
    }),
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    {
      invalidInput: FrameworkMigrationValueError.storedStateCorrupt,
      hashFailure: cause => FrameworkMigrationValueError.resourceFailure(
        "decodeStoredValue",
        cause,
      ),
    },
  );
  if (requiredStepSet.sha256Hex !== requiredStepSetSha256) {
    return yield* corrupt();
  }
  const layoutEvidence = yield* capturePrivateCanonicalValue(
    frame.physicalLayout,
    MAX_RELATIONAL_PHYSICAL_LAYOUT_CANONICAL_BYTES,
    {
      invalidInput: FrameworkMigrationValueError.storedStateCorrupt,
      hashFailure: cause => FrameworkMigrationValueError.resourceFailure(
        "decodeStoredValue",
        cause,
      ),
    },
  );
  if (layoutEvidence.sha256Hex !== physicalLayoutSha256) {
    return yield* corrupt();
  }
  const physicalLayout = yield* restoreVerifiedRelationalPhysicalLayout({
    frame: frame.physicalLayout,
    layoutSha256: brandLayoutSha256(physicalLayoutSha256),
    canonicalJson: layoutEvidence.canonicalJson,
    nameAssignments: input.nameAssignments.map(value => value.assignment),
    targetNamespace: input.targetNamespace.targetNamespace,
  }).pipe(Effect.mapError(mapPhysicalRestorationError));
  const plan = Object.freeze({
    frame,
    migrationPlanSha256: brandPlanSha256(stored.sha256Hex),
    requiredStepSetSha256,
    canonicalJson: stored.canonicalJson,
    physicalLayout,
    targetNamespace: input.targetNamespace.targetNamespace,
  });
  registerCapturedFreshRelationalMigrationPlan(plan);
  const restored = Object.freeze({
    storageId,
    collision: input.collision,
    plan,
  });
  restoredPlans.add(restored);
  return restored;
});

export function isRestoredFreshRelationalMigrationPlan(
  input: RestoredFreshRelationalMigrationPlan,
): boolean {
  return restoredPlans.has(input);
}

export interface RestoreStoredFrameworkMigrationPlanAdmissionInput {
  readonly row: StoredFrameworkMigrationPlanAdmissionRow;
  readonly assignmentRows:
    readonly StoredFrameworkMigrationAdmissionAssignmentRow[];
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly previousPlan: RestoredFreshRelationalMigrationPlan | null;
  readonly nameAssignments:
    readonly RestoredRelationalPhysicalNameAssignment[];
}

export const restoreStoredFrameworkMigrationPlanAdmission = Effect.fn(
  "FrameworkMigrationPlanAdmission.restoreStored",
)(function* (
  input: RestoreStoredFrameworkMigrationPlanAdmissionInput,
): Effect.fn.Return<
  RestoredFrameworkMigrationPlanAdmission,
  FrameworkMigrationValueError
> {
  const { row } = input;
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.admissionStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !restoredCollisions.has(input.collision) ||
    !restoredPlans.has(input.plan) ||
    input.plan.collision !== input.collision ||
    row.collisionStorageId !== input.collision.storageId ||
    row.planStorageId !== input.plan.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeMigrationCanonical(
    row,
    row.admissionSha256,
    FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT,
    FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "planAdmission",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const planSha256 = yield* storedSha256(row.migrationPlanSha256);
  const previousPlanSha256 = row.previousPlanSha256 === null
    ? null
    : yield* storedSha256(row.previousPlanSha256);
  if (
    !isStoredFrameworkMigrationPlanAdmissionFrame(frame) ||
    !sameCollision(frame.collision, input.collision.coordinate) ||
    compareFrameworkSchemaArtifactIdentities(
      frame.artifact,
      input.plan.plan.frame.artifact,
    ) !== 0 ||
    !scopePhysicalLocatorsEqual(
      frame.physicalLocator,
      input.plan.plan.frame.physicalLocator,
    ) ||
    frame.planSha256 !== input.plan.plan.migrationPlanSha256 ||
    planSha256 !== input.plan.plan.migrationPlanSha256 ||
    row.admissionProfile !== frame.admissionProfile ||
    row.assignmentCount !== frame.nameAssignments.length ||
    !previousPlanProjectionMatches(
      row,
      frame.previousPlanSha256,
      input.previousPlan,
      input.collision,
      previousPlanSha256,
    ) ||
    input.plan.plan.physicalLayout.nameAssignments.length !==
      frame.nameAssignments.length ||
    input.nameAssignments.length !== frame.nameAssignments.length ||
    input.assignmentRows.length !== frame.nameAssignments.length
  ) {
    return yield* corrupt();
  }
  for (let index = 0; index < frame.nameAssignments.length; index += 1) {
    const reference = frame.nameAssignments[index];
    const assignment = input.nameAssignments[index];
    const planAssignment =
      input.plan.plan.physicalLayout.nameAssignments[index];
    const sidecar = input.assignmentRows[index];
    if (
      reference === undefined ||
      assignment === undefined ||
      planAssignment === undefined ||
      sidecar === undefined ||
      !restoredAssignments.has(assignment) ||
      assignment.collision !== input.collision ||
      assignment.assignment.canonicalJson !== planAssignment.canonicalJson ||
      assignment.assignment.assignmentSha256 !==
        planAssignment.assignmentSha256 ||
      assignment.assignment.frame.spelling !== planAssignment.frame.spelling ||
      sidecar.admissionStorageId !== storageId ||
      sidecar.collisionStorageId !== input.collision.storageId ||
      sidecar.assignmentOrdinal !== index ||
      sidecar.assignmentStorageId !== assignment.storageId ||
      sidecar.spelling !== reference.spelling ||
      reference.spelling !== assignment.assignment.frame.spelling ||
      reference.assignmentSha256 !== assignment.assignment.assignmentSha256 ||
      !(yield* storedSha256Equals(
        sidecar.assignmentSha256,
        reference.assignmentSha256,
      ))
    ) {
      return yield* corrupt();
    }
  }
  const admission = Object.freeze({
    frame,
    sha256: brandAdmissionSha256(stored.sha256Hex),
    canonicalJson: stored.canonicalJson,
  });
  registerCapturedFrameworkMigrationPlanAdmission(admission, input.plan.plan);
  const restored = Object.freeze({
    storageId,
    collision: input.collision,
    plan: input.plan,
    admission,
  });
  restoredAdmissions.add(restored);
  return restored;
});

export function isRestoredFrameworkMigrationPlanAdmission(
  input: RestoredFrameworkMigrationPlanAdmission,
): boolean {
  return restoredAdmissions.has(input);
}

export interface RestoreStoredFrameworkMigrationAttemptStartInput {
  readonly row: StoredFrameworkMigrationAttemptStartRow;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly previousAttempt: RestoredFrameworkMigrationAttemptStart | null;
}

export const restoreStoredFrameworkMigrationAttemptStart = Effect.fn(
  "FrameworkMigrationAttemptStart.restoreStored",
)(function* (
  input: RestoreStoredFrameworkMigrationAttemptStartInput,
): Effect.fn.Return<
  RestoredFrameworkMigrationAttemptStart,
  FrameworkMigrationValueError
> {
  const { row } = input;
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.attemptStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !restoredCollisions.has(input.collision) ||
    !restoredPlans.has(input.plan) ||
    !restoredAdmissions.has(input.admission) ||
    input.plan.collision !== input.collision ||
    input.admission.collision !== input.collision ||
    input.admission.plan !== input.plan ||
    row.collisionStorageId !== input.collision.storageId ||
    row.planStorageId !== input.plan.storageId ||
    row.admissionStorageId !== input.admission.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeMigrationCanonical(
    row,
    row.attemptStartSha256,
    FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
    FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "attemptStart",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const attemptFence = yield* Effect.fromResult(
    decodeStoredNonNegativeInt64TextResult(
      row.attemptFence,
      FrameworkMigrationValueError.storedStateCorrupt,
    ),
  );
  if (
    !isStoredFrameworkMigrationAttemptStartFrame(frame) ||
    !sameCollision(frame.collision, input.collision.coordinate) ||
    !(yield* storedSha256Equals(
      row.migrationPlanSha256,
      input.plan.plan.migrationPlanSha256,
    )) ||
    !(yield* storedSha256Equals(
      row.admissionSha256,
      input.admission.admission.sha256,
    )) ||
    frame.planSha256 !== input.plan.plan.migrationPlanSha256 ||
    frame.admissionSha256 !== input.admission.admission.sha256 ||
    row.attemptId !== frame.attemptId ||
    attemptFence !== frame.attemptFence ||
    row.leaseOwnerId !== frame.leaseOwnerId ||
    !storedDateMatchesCanonicalInstant(row.leaseExpiresAt, frame.leaseExpiresAt) ||
    !previousAttemptProjectionMatches(
      row,
      frame.previousAttemptId,
      input.previousAttempt,
      input.collision,
    )
  ) {
    return yield* corrupt();
  }
  const attempt = Object.freeze({
    frame,
    sha256: brandAttemptStartSha256(stored.sha256Hex),
    canonicalJson: stored.canonicalJson,
  });
  registerCapturedFrameworkMigrationAttemptStart(attempt, {
    admission: input.admission.admission,
    plan: input.plan.plan,
  });
  const restored = Object.freeze({
    storageId,
    collision: input.collision,
    plan: input.plan,
    admission: input.admission,
    attempt,
  });
  restoredAttempts.add(restored);
  return restored;
});

export function isRestoredFrameworkMigrationAttemptStart(
  input: RestoredFrameworkMigrationAttemptStart,
): boolean {
  return restoredAttempts.has(input);
}

export interface RestoreStoredFrameworkMigrationStepReceiptInput {
  readonly row: StoredFrameworkMigrationStepReceiptRow;
  readonly dependencyRows:
    readonly StoredFrameworkMigrationStepReceiptDependencyRow[];
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly dependencyReceipts:
    readonly RestoredFrameworkMigrationStepReceipt[];
}

export const restoreStoredFrameworkMigrationStepReceipt = Effect.fn(
  "FrameworkMigrationStepReceipt.restoreStored",
)(function* (
  input: RestoreStoredFrameworkMigrationStepReceiptInput,
): Effect.fn.Return<
  RestoredFrameworkMigrationStepReceipt,
  FrameworkMigrationValueError
> {
  const { row } = input;
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.receiptStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !restoredCollisions.has(input.collision) ||
    !restoredPlans.has(input.plan) ||
    !restoredAttempts.has(input.attempt) ||
    input.attempt.collision !== input.collision ||
    input.attempt.plan !== input.plan ||
    row.collisionStorageId !== input.collision.storageId ||
    row.planStorageId !== input.plan.storageId ||
    row.attemptStorageId !== input.attempt.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeMigrationCanonical(
    row,
    row.stepReceiptSha256,
    FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
    FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "stepReceipt",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const step = isStoredFrameworkMigrationStepReceiptFrame(frame)
    ? input.plan.plan.frame.steps.find(candidate =>
      candidate.stepId === frame.stepId
    )
    : undefined;
  const expectedDependencies = step?.dependencies.toSorted((left, right) =>
    compareUtf16Strings(left.stepId, right.stepId)
  );
  const attemptFence = yield* Effect.fromResult(
    decodeStoredNonNegativeInt64TextResult(
      row.attemptFence,
      FrameworkMigrationValueError.storedStateCorrupt,
    ),
  );
  if (
    !isStoredFrameworkMigrationStepReceiptFrame(frame) ||
    step === undefined ||
    !sameCollision(frame.collision, input.collision.coordinate) ||
    frame.planSha256 !== input.plan.plan.migrationPlanSha256 ||
    frame.attemptId !== input.attempt.attempt.frame.attemptId ||
    frame.attemptFence !== input.attempt.attempt.frame.attemptFence ||
    row.attemptId !== frame.attemptId ||
    attemptFence !== frame.attemptFence ||
    row.stepId !== step.stepId ||
    row.dependencyCount !== frame.dependencyReceipts.length ||
    expectedDependencies?.length !== frame.dependencyReceipts.length ||
    !(yield* storedSha256Equals(row.stepSha256, step.stepSha256)) ||
    !(yield* storedSha256Equals(
      row.preconditionSha256,
      step.preconditionSha256,
    )) ||
    !(yield* storedSha256Equals(
      row.postconditionSha256,
      step.postconditionSha256,
    )) ||
    !(yield* storedSha256Equals(
      row.observedPostconditionSha256,
      step.postconditionSha256,
    )) ||
    frame.stepSha256 !== step.stepSha256 ||
    frame.preconditionSha256 !== step.preconditionSha256 ||
    frame.postconditionSha256 !== step.postconditionSha256 ||
    frame.observedPostconditionSha256 !== step.postconditionSha256 ||
    input.dependencyRows.length !== frame.dependencyReceipts.length ||
    input.dependencyReceipts.length !== frame.dependencyReceipts.length
  ) {
    return yield* corrupt();
  }
  for (let index = 0; index < frame.dependencyReceipts.length; index += 1) {
    const reference = frame.dependencyReceipts[index];
    const plannedDependency = expectedDependencies[index];
    const dependency = input.dependencyReceipts[index];
    const dependencyRow = input.dependencyRows[index];
    if (
      reference === undefined ||
      plannedDependency === undefined ||
      dependency === undefined ||
      dependencyRow === undefined ||
      !restoredStepReceipts.has(dependency) ||
      reference.stepId !== plannedDependency.stepId ||
      dependency.receipt.frame.stepSha256 !== plannedDependency.stepSha256 ||
      dependency.attempt !== input.attempt ||
      dependency.receipt.frame.stepId !== reference.stepId ||
      dependency.receipt.sha256 !== reference.stepReceiptSha256 ||
      dependencyRow.receiptStorageId !== storageId ||
      dependencyRow.attemptStorageId !== input.attempt.storageId ||
      dependencyRow.dependencyOrdinal !== index ||
      dependencyRow.dependencyReceiptStorageId !== dependency.storageId ||
      dependencyRow.dependencyStepId !== reference.stepId ||
      !(yield* storedSha256Equals(
        dependencyRow.dependencyStepReceiptSha256,
        reference.stepReceiptSha256,
      ))
    ) {
      return yield* corrupt();
    }
  }
  const receipt = Object.freeze({
    frame,
    sha256: brandStepReceiptSha256(stored.sha256Hex),
    canonicalJson: stored.canonicalJson,
  });
  registerCapturedFrameworkMigrationStepReceipt(receipt, {
    attempt: input.attempt.attempt,
    step,
  });
  const restored = Object.freeze({
    storageId,
    attempt: input.attempt,
    receipt,
  });
  restoredStepReceipts.add(restored);
  return restored;
});

export function isRestoredFrameworkMigrationStepReceipt(
  input: RestoredFrameworkMigrationStepReceipt,
): boolean {
  return restoredStepReceipts.has(input);
}

export interface RestoreStoredFrameworkMigrationAttemptTerminalInput {
  readonly row: StoredFrameworkMigrationAttemptTerminalRow;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly attempt: RestoredFrameworkMigrationAttemptStart;
  readonly stepReceipts: readonly RestoredFrameworkMigrationStepReceipt[];
}

export const restoreStoredFrameworkMigrationAttemptTerminal = Effect.fn(
  "FrameworkMigrationAttemptTerminal.restoreStored",
)(function* (
  input: RestoreStoredFrameworkMigrationAttemptTerminalInput,
): Effect.fn.Return<
  RestoredFrameworkMigrationAttemptTerminal,
  FrameworkMigrationValueError
> {
  const { row } = input;
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.terminalStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !restoredCollisions.has(input.collision) ||
    !restoredPlans.has(input.plan) ||
    !restoredAdmissions.has(input.admission) ||
    !restoredAttempts.has(input.attempt) ||
    input.admission.collision !== input.collision ||
    input.admission.plan !== input.plan ||
    input.attempt.collision !== input.collision ||
    input.attempt.plan !== input.plan ||
    input.attempt.admission !== input.admission ||
    row.collisionStorageId !== input.collision.storageId ||
    row.planStorageId !== input.plan.storageId ||
    row.attemptStorageId !== input.attempt.storageId ||
    row.admissionStorageId !== input.admission.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeMigrationCanonical(
    row,
    row.attemptTerminalSha256,
    FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT,
    FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "attemptTerminal",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const attemptFence = yield* Effect.fromResult(
    decodeStoredNonNegativeInt64TextResult(
      row.attemptFence,
      FrameworkMigrationValueError.storedStateCorrupt,
    ),
  );
  if (
    !isStoredFrameworkMigrationAttemptTerminalFrame(frame) ||
    !sameCollision(frame.collision, input.collision.coordinate) ||
    frame.planSha256 !== input.plan.plan.migrationPlanSha256 ||
    frame.attemptId !== input.attempt.attempt.frame.attemptId ||
    frame.attemptFence !== input.attempt.attempt.frame.attemptFence ||
    row.attemptId !== frame.attemptId ||
    attemptFence !== frame.attemptFence ||
    row.outcomeKind !== frame.outcome.kind ||
    !(yield* storedSha256Equals(
      row.admissionSha256,
      input.admission.admission.sha256,
    )) ||
    !(yield* terminalOutcomeProjectionMatches(row, frame, input.plan)) ||
    input.stepReceipts.length > input.plan.plan.frame.steps.length
  ) {
    return yield* corrupt();
  }
  for (let index = 0; index < input.stepReceipts.length; index += 1) {
    const receipt = input.stepReceipts[index];
    const step = input.plan.plan.frame.steps[index];
    if (
      receipt === undefined ||
      step === undefined ||
      !restoredStepReceipts.has(receipt) ||
      receipt.attempt !== input.attempt ||
      receipt.receipt.frame.stepId !== step.stepId
    ) {
      return yield* corrupt();
    }
  }
  if (
    frame.outcome.kind === "succeeded" &&
    input.stepReceipts.length !== input.plan.plan.frame.steps.length
  ) {
    return yield* corrupt();
  }
  const lastReceipt = input.stepReceipts.at(-1) ?? null;
  if (
    frame.lastStepReceiptSha256 !== (lastReceipt?.receipt.sha256 ?? null) ||
    row.lastReceiptStorageId !== (lastReceipt?.storageId ?? null) ||
    !(yield* nullableStoredSha256Equals(
      row.lastStepReceiptSha256,
      frame.lastStepReceiptSha256,
    ))
  ) {
    return yield* corrupt();
  }
  const terminal = Object.freeze({
    frame,
    sha256: brandTerminalSha256(stored.sha256Hex),
    canonicalJson: stored.canonicalJson,
  });
  registerCapturedFrameworkMigrationAttemptTerminal(
    terminal,
    input.admission.admission,
  );
  const restored = Object.freeze({
    storageId,
    attempt: input.attempt,
    terminal,
  });
  restoredTerminals.add(restored);
  return restored;
});

export function isRestoredFrameworkMigrationAttemptTerminal(
  input: RestoredFrameworkMigrationAttemptTerminal,
): boolean {
  return restoredTerminals.has(input);
}

const decodeMigrationCanonical = Effect.fn(
  "FrameworkMigrationValue.decodeStoredMetadata",
)(function* (
  row: StoredCanonicalRow,
  sha256Bytes: unknown,
  format: string,
  version: number,
  maximumCanonicalBytes: number,
): Effect.fn.Return<
  Readonly<{
    readonly sha256Hex: string;
    readonly canonicalBytes: Uint8Array;
    readonly canonicalJson: string;
  }>,
  FrameworkMigrationValueError
> {
  return yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    sha256Bytes,
    { format, version, maximumCanonicalBytes },
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
});

const storedSha256 = Effect.fn(
  "FrameworkMigrationValue.decodeStoredSha256",
)(function* (
  input: unknown,
): Effect.fn.Return<string, FrameworkMigrationValueError> {
  return yield* Effect.fromResult(decodeStoredSha256HexResult(
    input,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
});

const storedSha256Equals = Effect.fn(
  "FrameworkMigrationValue.storedSha256Equals",
)(function* (
  input: unknown,
  expected: string,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  return (yield* storedSha256(input)) === expected;
});

const verifyPlanSidecars = Effect.fn(
  "FrameworkMigrationPlan.verifyStoredSidecars",
)(function* (
  planStorageId: bigint,
  collisionStorageId: bigint,
  steps: FreshRelationalMigrationPlan["frame"]["steps"],
  rows: readonly StoredFrameworkMigrationPlanStepRow[],
  dependencyRows: readonly StoredFrameworkMigrationPlanStepDependencyRow[],
): Effect.fn.Return<void, FrameworkMigrationValueError> {
  if (rows.length !== steps.length) return yield* corrupt();
  let dependencyIndex = 0;
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    const row = rows[stepIndex];
    if (
      step === undefined ||
      row === undefined ||
      row.planStorageId !== planStorageId ||
      row.collisionStorageId !== collisionStorageId ||
      row.stepOrdinal !== stepIndex ||
      row.stepId !== step.stepId ||
      row.phase !== step.phase ||
      row.operationFormat !== step.operation.codec.format ||
      row.operationVersion !== step.operation.codec.version ||
      row.dependencyCount !== step.dependencies.length ||
      !(yield* storedSha256Equals(row.stepSha256, step.stepSha256)) ||
      !(yield* storedSha256Equals(
        row.preconditionSha256,
        step.preconditionSha256,
      )) ||
      !(yield* storedSha256Equals(
        row.postconditionSha256,
        step.postconditionSha256,
      ))
    ) {
      return yield* corrupt();
    }
    for (
      let ordinal = 0;
      ordinal < step.dependencies.length;
      ordinal += 1
    ) {
      const dependency = step.dependencies[ordinal];
      const dependencyRow = dependencyRows[dependencyIndex];
      if (
        dependency === undefined ||
        dependencyRow === undefined ||
        dependencyRow.planStorageId !== planStorageId ||
        dependencyRow.sourceStepId !== step.stepId ||
        dependencyRow.dependencyOrdinal !== ordinal ||
        dependencyRow.dependencyStepId !== dependency.stepId ||
        !(yield* storedSha256Equals(
          dependencyRow.dependencyStepSha256,
          dependency.stepSha256,
        ))
      ) {
        return yield* corrupt();
      }
      dependencyIndex += 1;
    }
  }
  if (dependencyIndex !== dependencyRows.length) return yield* corrupt();
});

function previousPlanProjectionMatches(
  row: StoredFrameworkMigrationPlanAdmissionRow,
  frameSha256: string | null,
  previousPlan: RestoredFreshRelationalMigrationPlan | null,
  collision: RestoredFrameworkMigrationCollisionDomain,
  projectedSha256: string | null,
): boolean {
  if (frameSha256 === null) {
    return previousPlan === null && row.previousPlanStorageId === null &&
      projectedSha256 === null;
  }
  return previousPlan !== null && restoredPlans.has(previousPlan) &&
    previousPlan.collision === collision &&
    row.previousPlanStorageId === previousPlan.storageId &&
    projectedSha256 === previousPlan.plan.migrationPlanSha256 &&
    frameSha256 === previousPlan.plan.migrationPlanSha256;
}

function previousAttemptProjectionMatches(
  row: StoredFrameworkMigrationAttemptStartRow,
  frameAttemptId: string | null,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  collision: RestoredFrameworkMigrationCollisionDomain,
): boolean {
  if (frameAttemptId === null) {
    return previousAttempt === null && row.previousAttemptStorageId === null &&
      row.previousAttemptId === null;
  }
  return previousAttempt !== null && restoredAttempts.has(previousAttempt) &&
    previousAttempt.collision === collision &&
    row.previousAttemptStorageId === previousAttempt.storageId &&
    row.previousAttemptId === previousAttempt.attempt.frame.attemptId &&
    frameAttemptId === previousAttempt.attempt.frame.attemptId;
}

const terminalOutcomeProjectionMatches = Effect.fn(
  "FrameworkMigrationAttemptTerminal.verifyStoredOutcomeProjection",
)(function* (
  row: StoredFrameworkMigrationAttemptTerminalRow,
  frame: FrameworkMigrationAttemptTerminalFrame,
  plan: RestoredFreshRelationalMigrationPlan,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  switch (frame.outcome.kind) {
    case "succeeded":
      return frame.outcome.requiredStepSetSha256 ===
          plan.plan.requiredStepSetSha256 &&
        row.failureReason === null && row.evidenceSha256 === null &&
        (yield* nullableStoredSha256Equals(
          row.requiredStepSetSha256,
          frame.outcome.requiredStepSetSha256,
        ));
    case "failed":
      return row.requiredStepSetSha256 === null &&
        row.failureReason === frame.outcome.reason &&
        (yield* nullableStoredSha256Equals(
          row.evidenceSha256,
          frame.outcome.evidenceSha256,
        ));
    case "decisionUncertain":
      return row.requiredStepSetSha256 === null && row.failureReason === null &&
        (yield* nullableStoredSha256Equals(
          row.evidenceSha256,
          frame.outcome.evidenceSha256,
        ));
  }
});

const nullableStoredSha256Equals = Effect.fn(
  "FrameworkMigrationValue.nullableStoredSha256Equals",
)(function* (
  input: unknown,
  expected: string | null,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  return expected === null
    ? input === null
    : input !== null && (yield* storedSha256(input)) === expected;
});

function sameTargetFrame(
  left: FrameworkMigrationCollisionCoordinate["targetNamespace"],
  right: FrameworkMigrationCollisionCoordinate["targetNamespace"],
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

function sameCollision(
  left: FrameworkMigrationCollisionCoordinate,
  right: FrameworkMigrationCollisionCoordinate,
): boolean {
  return sameTargetFrame(left.targetNamespace, right.targetNamespace) &&
    left.owner === right.owner && left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function mapPhysicalRestorationError(
  error: RelationalPhysicalValueError,
): FrameworkMigrationValueError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationValueError.resourceFailure(
      "decodeStoredValue",
      error.cause,
    )
    : FrameworkMigrationValueError.storedStateCorrupt();
}

function corrupt() {
  return Effect.fail(FrameworkMigrationValueError.storedStateCorrupt());
}
