import type { CanonicalIsoInstant } from "@flarex/time/iso-instant";
import type { JsonObject } from "flarex-protocol/json";

import type { FrameworkSchemaArtifactIdentity } from "../artifact/model";
import type {
  CapturedFrameworkMigrationValue,
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationPlanAdmissionFrame,
  FreshRelationalMigrationPlan,
} from "../../migrationCoordination/model";
import type {
  CanonicalPositiveInt64,
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationPlanAdmissionSha256,
  FrameworkMigrationPlanSha256,
  FrameworkSchemaAvailabilityHeadSha256,
  FrameworkSchemaAvailabilityHistorySha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaInstallationSha256,
  FrameworkSchemaReadinessSha256,
  FrameworkSchemaValidationSha256,
  RelationalPhysicalLayoutSha256,
} from "../../migrationCoordination/identity";
import type { FrameworkSchemaTargetNamespaceFrame } from
  "../../migrationCoordination/targetNamespace";
import type {
  RelationalPhysicalCapabilityEvidence,
} from "../../relationalSchema/physical/model";
import type { ScopePhysicalLocator } from "../../scopeMetadataTypes";

export const FRAMEWORK_SCHEMA_INSTALLATION_FORMAT =
  "flarex.framework-schema-installation";
export const FRAMEWORK_SCHEMA_INSTALLATION_VERSION = 1;
export const FRAMEWORK_SCHEMA_READINESS_FORMAT =
  "flarex.framework-schema-readiness";
export const FRAMEWORK_SCHEMA_READINESS_VERSION = 1;
export const FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT =
  "flarex.framework-schema-availability-history";
export const FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION = 1;
export const FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT =
  "flarex.framework-schema-availability-head";
export const FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION = 1;

export type FrameworkSchemaInstallationIdentityPreimage = Readonly<{
  readonly artifact: Readonly<FrameworkSchemaArtifactIdentity> & JsonObject;
  readonly physicalLocator: Readonly<ScopePhysicalLocator> & JsonObject;
  readonly targetNamespace: FrameworkSchemaTargetNamespaceFrame;
  readonly migrationPlanSha256: FrameworkMigrationPlanSha256;
}> & JsonObject;

export type FrameworkSchemaInstallationIdentity = Readonly<{
  readonly artifact: Readonly<FrameworkSchemaArtifactIdentity> & JsonObject;
  readonly physicalLocator: Readonly<ScopePhysicalLocator> & JsonObject;
  readonly targetNamespace: FrameworkSchemaTargetNamespaceFrame;
  readonly migrationPlanSha256: FrameworkMigrationPlanSha256;
  readonly installationSha256: FrameworkSchemaInstallationSha256;
}> & JsonObject;

export type RelationalResidualRequirement =
  Readonly<{
    readonly capability:
      RelationalPhysicalCapabilityEvidence["identity"];
    readonly requirement:
      RelationalPhysicalCapabilityEvidence["residualRequirement"];
  }> & JsonObject;

export type FrameworkSchemaInstallationFrame = Readonly<{
  readonly format: typeof FRAMEWORK_SCHEMA_INSTALLATION_FORMAT;
  readonly version: typeof FRAMEWORK_SCHEMA_INSTALLATION_VERSION;
  readonly identity: FrameworkSchemaInstallationIdentity;
  readonly planAdmissionSha256: FrameworkMigrationPlanAdmissionSha256;
  readonly terminalAttemptSha256: FrameworkMigrationAttemptTerminalSha256;
  readonly installedStructureSha256: RelationalPhysicalLayoutSha256;
  readonly installedPhysicalCapabilities:
    readonly RelationalPhysicalCapabilityEvidence[];
  readonly installedAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkSchemaReadinessFrame = Readonly<{
  readonly format: typeof FRAMEWORK_SCHEMA_READINESS_FORMAT;
  readonly version: typeof FRAMEWORK_SCHEMA_READINESS_VERSION;
  readonly installation: FrameworkSchemaInstallationIdentity;
  readonly installationReceiptSha256:
    FrameworkSchemaInstallationReceiptSha256;
  readonly validationPolicy: "relational-postgres-exact-candidate-structure";
  readonly validationSha256: FrameworkSchemaValidationSha256;
  readonly validatedStructureSha256: RelationalPhysicalLayoutSha256;
  readonly validatedPhysicalCapabilities:
    readonly RelationalPhysicalCapabilityEvidence[];
  readonly residualRequirements: readonly RelationalResidualRequirement[];
  readonly validatedAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkSchemaAvailabilityStatus =
  | "ready"
  | "withdrawn"
  | "superseded"
  | "quarantined";

export type FrameworkSchemaAvailabilityToken = Readonly<{
  readonly availabilitySequence: CanonicalPositiveInt64;
  readonly historySha256: FrameworkSchemaAvailabilityHistorySha256;
  readonly status: FrameworkSchemaAvailabilityStatus;
}> & JsonObject;

export type FrameworkSchemaAvailabilityHistoryFrame = Readonly<{
  readonly format: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT;
  readonly version: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION;
  readonly installation: FrameworkSchemaInstallationIdentity;
  readonly readinessSha256: FrameworkSchemaReadinessSha256;
  readonly availabilitySequence: CanonicalPositiveInt64;
  readonly previousAvailability: FrameworkSchemaAvailabilityToken | null;
  readonly status: FrameworkSchemaAvailabilityStatus;
  readonly reasonSha256: string | null;
  readonly recordedAt: CanonicalIsoInstant;
}> & JsonObject;

export type FrameworkSchemaAvailabilityHeadFrame = Readonly<{
  readonly format: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT;
  readonly version: typeof FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION;
  readonly installation: FrameworkSchemaInstallationIdentity;
  readonly readinessSha256: FrameworkSchemaReadinessSha256;
  readonly availabilitySequence: CanonicalPositiveInt64;
  readonly historySha256: FrameworkSchemaAvailabilityHistorySha256;
  readonly status: FrameworkSchemaAvailabilityStatus;
}> & JsonObject;

export interface CapturedFrameworkSchemaInstallationValue<
  Frame extends JsonObject,
  Sha,
> {
  readonly frame: Frame;
  readonly sha256: Sha;
  readonly canonicalJson: string;
}

export interface CaptureFrameworkSchemaInstallationInput {
  readonly plan: FreshRelationalMigrationPlan;
  readonly admission: CapturedFrameworkMigrationValue<
    FrameworkMigrationPlanAdmissionFrame,
    FrameworkMigrationPlanAdmissionSha256
  >;
  readonly terminal: CapturedFrameworkMigrationValue<
    FrameworkMigrationAttemptTerminalFrame,
    FrameworkMigrationAttemptTerminalSha256
  >;
  readonly installedStructureSha256: unknown;
  readonly installedPhysicalCapabilities: readonly unknown[];
  readonly installedAt: unknown;
}

export interface CaptureFrameworkSchemaReadinessInput {
  readonly installation: CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaInstallationFrame,
    FrameworkSchemaInstallationReceiptSha256
  >;
  readonly validationSha256: unknown;
  readonly validatedStructureSha256: unknown;
  readonly validatedPhysicalCapabilities: readonly unknown[];
  readonly residualRequirements: readonly unknown[];
  readonly validatedAt: unknown;
}

export interface CaptureFrameworkSchemaAvailabilityHistoryInput {
  readonly readiness: CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaReadinessFrame,
    FrameworkSchemaReadinessSha256
  >;
  readonly previous: CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHistoryFrame,
    FrameworkSchemaAvailabilityHistorySha256
  > | null;
  readonly status: unknown;
  readonly reasonSha256: unknown | null;
  readonly recordedAt: unknown;
}

export type FrameworkSchemaAvailabilityHead =
  CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHeadFrame,
    FrameworkSchemaAvailabilityHeadSha256
  >;
