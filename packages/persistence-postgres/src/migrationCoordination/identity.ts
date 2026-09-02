import type { Brand } from "effect";

export type PhysicalDatabaseIdentity = Brand.Branded<
  string,
  "FlarexDB/PhysicalDatabaseIdentity"
>;
export type PhysicalSchemaName = Brand.Branded<
  string,
  "FlarexDB/PhysicalSchemaName"
>;
export type FrameworkSchemaTargetNamespaceSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaTargetNamespaceSha256"
>;
export type RelationalPhysicalNameSha256 = Brand.Branded<
  string,
  "FlarexDB/RelationalPhysicalNameSha256"
>;
export type RelationalPhysicalNameAssignmentSha256 = Brand.Branded<
  string,
  "FlarexDB/RelationalPhysicalNameAssignmentSha256"
>;
export type RelationalPhysicalLayoutSha256 = Brand.Branded<
  string,
  "FlarexDB/RelationalPhysicalLayoutSha256"
>;
export type RelationalPhysicalProjectionSha256 = Brand.Branded<
  string,
  "FlarexDB/RelationalPhysicalProjectionSha256"
>;
export type FrameworkMigrationPlanSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationPlanSha256"
>;
export type FrameworkMigrationStepSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationStepSha256"
>;
export type FrameworkMigrationConditionSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationConditionSha256"
>;
export type FrameworkMigrationPlanAdmissionSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationPlanAdmissionSha256"
>;
export type FrameworkMigrationCollisionHeadSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationCollisionHeadSha256"
>;
export type FrameworkMigrationAttemptStartSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationAttemptStartSha256"
>;
export type FrameworkMigrationStepReceiptSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationStepReceiptSha256"
>;
export type FrameworkMigrationAttemptTerminalSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationAttemptTerminalSha256"
>;
export type FrameworkMigrationEventSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationEventSha256"
>;
export type FrameworkSchemaInstallationSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaInstallationSha256"
>;
export type FrameworkSchemaInstallationReceiptSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaInstallationReceiptSha256"
>;
export type FrameworkSchemaValidationSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaValidationSha256"
>;
export type FrameworkSchemaReadinessSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaReadinessSha256"
>;
export type FrameworkSchemaAvailabilityHistorySha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaAvailabilityHistorySha256"
>;
export type FrameworkSchemaAvailabilityHeadSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaAvailabilityHeadSha256"
>;

export type FrameworkMigrationStepId = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationStepId"
>;
export type FrameworkMigrationAttemptId = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationAttemptId"
>;
export type FrameworkMigrationLeaseOwnerId = Brand.Branded<
  string,
  "FlarexDB/FrameworkMigrationLeaseOwnerId"
>;
export type CanonicalNonNegativeInt64 = Brand.Branded<
  string,
  "FlarexDB/CanonicalNonNegativeInt64"
>;
export type CanonicalPositiveInt64 = Brand.Branded<
  string,
  "FlarexDB/CanonicalPositiveInt64"
>;
