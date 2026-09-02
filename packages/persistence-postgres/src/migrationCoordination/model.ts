import type { CanonicalIsoInstant } from "@flarex/time/iso-instant";
import type { JsonObject } from "flarex-protocol/json";

import type { FrameworkSchemaArtifactIdentity } from
  "../frameworkSchema/artifact/model";
import type { FrameworkSchemaArtifact } from
  "../frameworkSchema/artifact/model";
import type { ScopePhysicalLocator } from "../scopeMetadataTypes";
import type {
  RelationalPhysicalForeignKey,
  RelationalPhysicalIndex,
  RelationalPhysicalLayout,
  RelationalPhysicalLayoutFrame,
  RelationalPhysicalNameAssignment,
  RelationalPhysicalNamespaceProfile,
  RelationalPhysicalTable,
} from "../relationalSchema/physical/model";
import type { RelationalSchemaOwner } from "../relationalSchema/model";
import type {
  CanonicalNonNegativeInt64,
  FrameworkMigrationAttemptId,
  FrameworkMigrationAttemptStartSha256,
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationConditionSha256,
  FrameworkMigrationEventSha256,
  FrameworkMigrationLeaseOwnerId,
  FrameworkMigrationPlanAdmissionSha256,
  FrameworkMigrationPlanSha256,
  FrameworkMigrationStepId,
  FrameworkMigrationStepReceiptSha256,
  FrameworkMigrationStepSha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaReadinessSha256,
  RelationalPhysicalLayoutSha256,
  RelationalPhysicalNameAssignmentSha256,
  RelationalPhysicalProjectionSha256,
} from "./identity";
import type {
  FrameworkSchemaTargetNamespace,
  FrameworkSchemaTargetNamespaceFrame,
} from "./targetNamespace";

export const FRAMEWORK_MIGRATION_PLAN_FORMAT =
  "flarex.framework-migration-plan";
export const FRAMEWORK_MIGRATION_PLAN_VERSION = 1;
export const FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_FORMAT =
  "flarex.framework-migration-required-step-set";
export const FRAMEWORK_MIGRATION_REQUIRED_STEP_SET_VERSION = 1;
export const FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT =
  "flarex.framework-migration-plan-admission";
export const FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION = 1;
export const FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT =
  "flarex.framework-migration-collision-head";
export const FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION = 1;
export const FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT =
  "flarex.framework-migration-attempt-start";
export const FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION = 1;
export const FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT =
  "flarex.framework-migration-step-receipt";
export const FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION = 1;
export const FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT =
  "flarex.framework-migration-attempt-terminal";
export const FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION = 1;
export const FRAMEWORK_MIGRATION_EVENT_FORMAT =
  "flarex.framework-migration-event";
export const FRAMEWORK_MIGRATION_EVENT_VERSION = 1;

export type FrameworkMigrationCollisionCoordinate = Readonly<{
  readonly targetNamespace: FrameworkSchemaTargetNamespaceFrame;
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: string;
  readonly physicalNamespaceProfile: RelationalPhysicalNamespaceProfile;
}> & JsonObject;

export type RelationalStructuralOperation =
  | (Readonly<{
      readonly codec: Readonly<{
        readonly format: "flarex.relational-create-table";
        readonly version: 1;
      }> & JsonObject;
      readonly table: Omit<RelationalPhysicalTable, "indexes"> & JsonObject;
      readonly expectedTableSha256: RelationalPhysicalProjectionSha256;
    }> & JsonObject)
  | (Readonly<{
      readonly codec: Readonly<{
        readonly format: "flarex.relational-create-index";
        readonly version: 1;
      }> & JsonObject;
      readonly index: RelationalPhysicalIndex;
      readonly expectedIndexSha256: RelationalPhysicalProjectionSha256;
    }> & JsonObject)
  | (Readonly<{
      readonly codec: Readonly<{
        readonly format: "flarex.relational-add-foreign-key";
        readonly version: 1;
      }> & JsonObject;
      readonly foreignKey: RelationalPhysicalForeignKey;
      readonly expectedForeignKeySha256: RelationalPhysicalProjectionSha256;
    }> & JsonObject)
  | (Readonly<{
      readonly codec: Readonly<{
        readonly format: "flarex.relational-validate-structure";
        readonly version: 1;
      }> & JsonObject;
      readonly expectedLayoutSha256: RelationalPhysicalLayoutSha256;
    }> & JsonObject);

export type FrameworkMigrationCondition = Readonly<{
  readonly kind: "absentOrExact" | "exact";
  readonly projectionKind: "table" | "index" | "foreignKey" | "layout";
  readonly projectionSha256: string;
}> & JsonObject;

export type FrameworkMigrationStepReference = Readonly<{
  readonly stepId: FrameworkMigrationStepId;
  readonly stepSha256: FrameworkMigrationStepSha256;
}> & JsonObject;

export type FrameworkMigrationStep = Readonly<{
  readonly stepId: FrameworkMigrationStepId;
  readonly stepSha256: FrameworkMigrationStepSha256;
  readonly ordinal: number;
  readonly phase: "expansion" | "validation";
  readonly transactionMode: "transactionBound";
  readonly dependencies: readonly FrameworkMigrationStepReference[];
  readonly precondition: FrameworkMigrationCondition;
  readonly preconditionSha256: FrameworkMigrationConditionSha256;
  readonly postcondition: FrameworkMigrationCondition;
  readonly postconditionSha256: FrameworkMigrationConditionSha256;
  readonly executionCapability:
    "postgres-transactional-relational-structure";
  readonly replayPolicy: "exactReceipt";
  readonly checkpointPolicy: "afterStep";
  readonly operation: RelationalStructuralOperation;
}> & JsonObject;

export type FreshRelationalMigrationPlanFrame = Readonly<{
  readonly format: typeof FRAMEWORK_MIGRATION_PLAN_FORMAT;
  readonly version: typeof FRAMEWORK_MIGRATION_PLAN_VERSION;
  readonly artifact: Readonly<FrameworkSchemaArtifactIdentity> & JsonObject;
  readonly physicalLocator: Readonly<ScopePhysicalLocator> & JsonObject;
  readonly targetNamespace: FrameworkSchemaTargetNamespaceFrame;
  readonly collision: FrameworkMigrationCollisionCoordinate;
  readonly baseInstallation: null;
  readonly physicalLayout: RelationalPhysicalLayoutFrame;
  readonly physicalLayoutSha256: RelationalPhysicalLayoutSha256;
  readonly steps: readonly FrameworkMigrationStep[];
}> & JsonObject;

export interface FreshRelationalMigrationPlan {
  readonly frame: FreshRelationalMigrationPlanFrame;
  readonly migrationPlanSha256: FrameworkMigrationPlanSha256;
  readonly requiredStepSetSha256: string;
  readonly canonicalJson: string;
  readonly physicalLayout: RelationalPhysicalLayout;
  readonly targetNamespace: FrameworkSchemaTargetNamespace;
}

export type FrameworkMigrationPlanAdmissionFrame = Readonly<{
  readonly format: typeof FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT;
  readonly version: typeof FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION;
  readonly collision: FrameworkMigrationCollisionCoordinate;
  readonly planSha256: FrameworkMigrationPlanSha256;
  readonly artifact: Readonly<FrameworkSchemaArtifactIdentity> & JsonObject;
  readonly physicalLocator: Readonly<ScopePhysicalLocator> & JsonObject;
  readonly targetNamespace: FrameworkSchemaTargetNamespaceFrame;
  readonly baseInstallation: null;
  readonly nameAssignments: readonly Readonly<{
    readonly spelling: string;
    readonly assignmentSha256: RelationalPhysicalNameAssignmentSha256;
  } & JsonObject>[];
  readonly previousPlanSha256: FrameworkMigrationPlanSha256 | null;
  readonly admissionProfile: "synthetic-system-fresh";
  readonly admittedAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkMigrationCurrentAttempt = Readonly<{
  readonly attemptId: FrameworkMigrationAttemptId;
  readonly attemptFence: CanonicalNonNegativeInt64;
  readonly leaseOwnerId: FrameworkMigrationLeaseOwnerId;
  readonly leaseExpiresAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkMigrationEventToken = Readonly<{
  readonly sequence: CanonicalNonNegativeInt64;
  readonly eventSha256: FrameworkMigrationEventSha256;
}> & JsonObject;

export type FrameworkMigrationCollisionHeadFrame = Readonly<{
  readonly format: typeof FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT;
  readonly version: typeof FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION;
  readonly collision: FrameworkMigrationCollisionCoordinate;
  readonly headRevision: CanonicalNonNegativeInt64;
  readonly currentPlan: Readonly<{
    readonly planSha256: FrameworkMigrationPlanSha256;
    readonly admissionSha256: FrameworkMigrationPlanAdmissionSha256;
  }> & JsonObject;
  readonly attemptFence: CanonicalNonNegativeInt64;
  readonly currentAttempt: FrameworkMigrationCurrentAttempt | null;
  readonly lastEvent: FrameworkMigrationEventToken | null;
  readonly updatedAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkMigrationAttemptStartFrame = Readonly<{
  readonly format: typeof FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT;
  readonly version: typeof FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION;
  readonly collision: FrameworkMigrationCollisionCoordinate;
  readonly planSha256: FrameworkMigrationPlanSha256;
  readonly admissionSha256: FrameworkMigrationPlanAdmissionSha256;
  readonly attemptId: FrameworkMigrationAttemptId;
  readonly attemptFence: CanonicalNonNegativeInt64;
  readonly leaseOwnerId: FrameworkMigrationLeaseOwnerId;
  readonly leaseExpiresAt: CanonicalIsoInstant;
  readonly previousAttemptId: FrameworkMigrationAttemptId | null;
  readonly startedAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkMigrationDependencyReceipt = Readonly<{
  readonly stepId: FrameworkMigrationStepId;
  readonly stepReceiptSha256: FrameworkMigrationStepReceiptSha256;
}> & JsonObject;

export type FrameworkMigrationStepReceiptFrame = Readonly<{
  readonly format: typeof FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT;
  readonly version: typeof FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION;
  readonly collision: FrameworkMigrationCollisionCoordinate;
  readonly planSha256: FrameworkMigrationPlanSha256;
  readonly attemptId: FrameworkMigrationAttemptId;
  readonly attemptFence: CanonicalNonNegativeInt64;
  readonly stepId: FrameworkMigrationStepId;
  readonly stepSha256: FrameworkMigrationStepSha256;
  readonly dependencyReceipts: readonly FrameworkMigrationDependencyReceipt[];
  readonly preconditionSha256: FrameworkMigrationConditionSha256;
  readonly postconditionSha256: FrameworkMigrationConditionSha256;
  readonly observedPostconditionSha256: FrameworkMigrationConditionSha256;
  readonly completedAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkMigrationAttemptOutcome =
  | (Readonly<{
      readonly kind: "succeeded";
      readonly requiredStepSetSha256: string;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "failed";
      readonly reason:
        | "operationFailed"
        | "validationFailed"
        | "leaseLost"
        | "superseded";
      readonly evidenceSha256: string;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "decisionUncertain";
      readonly evidenceSha256: string;
    }> & JsonObject);

export type FrameworkMigrationAttemptTerminalFrame = Readonly<{
  readonly format: typeof FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT;
  readonly version: typeof FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION;
  readonly collision: FrameworkMigrationCollisionCoordinate;
  readonly planSha256: FrameworkMigrationPlanSha256;
  readonly attemptId: FrameworkMigrationAttemptId;
  readonly attemptFence: CanonicalNonNegativeInt64;
  readonly outcome: FrameworkMigrationAttemptOutcome;
  readonly lastStepReceiptSha256:
    FrameworkMigrationStepReceiptSha256 | null;
  readonly terminalAt: CanonicalIsoInstant;
}> & JsonObject;

type FrameworkMigrationEventCommon = Readonly<{
  readonly format: typeof FRAMEWORK_MIGRATION_EVENT_FORMAT;
  readonly version: typeof FRAMEWORK_MIGRATION_EVENT_VERSION;
  readonly collision: FrameworkMigrationCollisionCoordinate;
  readonly sequence: CanonicalNonNegativeInt64;
  readonly previousEvent: FrameworkMigrationEventToken | null;
  readonly recordedAt: CanonicalIsoInstant;
}>;

export type FrameworkMigrationEventFrame =
  | (FrameworkMigrationEventCommon & Readonly<{
      readonly kind: "planAdmitted";
      readonly admissionSha256: FrameworkMigrationPlanAdmissionSha256;
    }> & JsonObject)
  | (FrameworkMigrationEventCommon & Readonly<{
      readonly kind: "attemptStarted";
      readonly attemptStartSha256: FrameworkMigrationAttemptStartSha256;
    }> & JsonObject)
  | (FrameworkMigrationEventCommon & Readonly<{
      readonly kind: "leaseRenewed";
      readonly attemptId: FrameworkMigrationAttemptId;
      readonly attemptFence: CanonicalNonNegativeInt64;
      readonly leaseOwnerId: FrameworkMigrationLeaseOwnerId;
      readonly leaseExpiresAt: CanonicalIsoInstant;
    }> & JsonObject)
  | (FrameworkMigrationEventCommon & Readonly<{
      readonly kind: "stepCompleted";
      readonly stepReceiptSha256: FrameworkMigrationStepReceiptSha256;
    }> & JsonObject)
  | (FrameworkMigrationEventCommon & Readonly<{
      readonly kind: "attemptTerminated";
      readonly terminalSha256: FrameworkMigrationAttemptTerminalSha256;
    }> & JsonObject)
  | (FrameworkMigrationEventCommon & Readonly<{
      readonly kind: "installationPublished";
      readonly installationReceiptSha256:
        FrameworkSchemaInstallationReceiptSha256;
    }> & JsonObject)
  | (FrameworkMigrationEventCommon & Readonly<{
      readonly kind: "readinessPublished";
      readonly readinessSha256: FrameworkSchemaReadinessSha256;
    }> & JsonObject);

export interface CapturedFrameworkMigrationValue<Frame extends JsonObject, Sha> {
  readonly frame: Frame;
  readonly sha256: Sha;
  readonly canonicalJson: string;
}

export interface CaptureFreshRelationalMigrationPlanInput {
  readonly artifact: FrameworkSchemaArtifact;
  readonly physicalLayout: RelationalPhysicalLayout;
}

export interface CaptureFrameworkMigrationPlanAdmissionInput {
  readonly plan: FreshRelationalMigrationPlan;
  readonly nameAssignments: readonly RelationalPhysicalNameAssignment[];
  readonly previousPlanSha256: FrameworkMigrationPlanSha256 | null;
  readonly admittedAt: unknown;
}
