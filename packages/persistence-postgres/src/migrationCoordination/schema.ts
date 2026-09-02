import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import {
  frameworkMetadataCollatedText,
  isFrameworkMetadataTextWithin,
} from "../frameworkSchema/privateMetadataSchemaSupport";
import { bytea } from "../schema";
import type { ScopeIsolationKind } from "../scopeMetadataTypes";
import {
  MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
} from "../relationalSchema/physical/canonical";
import {
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT,
  RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION,
  RELATIONAL_PHYSICAL_NAMESPACE_PROFILE,
  type RelationalPhysicalNamespaceProfile,
} from "../relationalSchema/physical/model";
import { MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS } from
  "../relationalSchema/physical/storedValidation";
import type { RelationalSchemaOwner } from "../relationalSchema/model";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
  MAX_FRAMEWORK_MIGRATION_PLAN_STEPS,
} from "./canonical";
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
  FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT,
  FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION,
  type FrameworkMigrationAttemptOutcome,
  type FrameworkMigrationEventFrame,
  type FrameworkMigrationPlanAdmissionFrame,
  type FrameworkMigrationStep,
  type RelationalStructuralOperation,
} from "./model";
import {
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
  FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
  MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
} from "./targetNamespace";

const MAX_INT64 = "9223372036854775807";
const MAX_COMMON_IDENTITY_UTF8_BYTES = 512;
const MAX_POSTGRES_IDENTIFIER_UTF8_BYTES = 63;

type FrameworkMigrationFailureReason = Extract<
  FrameworkMigrationAttemptOutcome,
  { readonly kind: "failed" }
>["reason"];

function digestHasExactLength(value: SQLWrapper) {
  return sql`octet_length(${value}) = 32`;
}

function canonicalBytesMatch(
  canonicalByteLength: SQLWrapper,
  canonicalBytes: SQLWrapper,
  maximumBytes: number,
) {
  return sql`
    ${canonicalByteLength} between 1 and ${sql.raw(String(maximumBytes))}
    and octet_length(${canonicalBytes}) = ${canonicalByteLength}
  `;
}

export const fxSystemFrameworkSchemaTargetNamespaces = pgTable(
  "fx_system_framework_schema_target_namespace",
  {
    targetNamespaceStorageId: bigint("target_namespace_storage_id", {
      mode: "bigint",
    }).generatedAlwaysAsIdentity({
      name: "fx_framework_target_namespace_storage_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: MAX_INT64,
      cache: 1,
      cycle: false,
    }),
    deploymentId: frameworkMetadataCollatedText("deployment_id").notNull(),
    physicalDatabaseIdentity: frameworkMetadataCollatedText(
      "physical_database_identity",
    ).notNull(),
    schemaName: frameworkMetadataCollatedText("schema_name").notNull(),
    targetNamespaceSha256: bytea("target_namespace_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_target_namespace_pk",
      columns: [table.targetNamespaceStorageId],
    }),
    unique("fx_framework_target_namespace_coordinate_unique").on(
      table.deploymentId,
      table.physicalDatabaseIdentity,
      table.schemaName,
    ),
    unique("fx_framework_target_namespace_digest_unique").on(
      table.targetNamespaceSha256,
    ),
    unique("fx_framework_target_namespace_physical_unique").on(
      table.targetNamespaceStorageId,
      table.physicalDatabaseIdentity,
      table.schemaName,
    ),
    check(
      "fx_framework_target_namespace_identity_check",
      sql`${table.targetNamespaceStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${isFrameworkMetadataTextWithin(
          table.deploymentId,
          MAX_COMMON_IDENTITY_UTF8_BYTES,
        )}
        and ${isFrameworkMetadataTextWithin(
          table.physicalDatabaseIdentity,
          MAX_COMMON_IDENTITY_UTF8_BYTES,
        )}
        and ${isFrameworkMetadataTextWithin(
          table.schemaName,
          MAX_POSTGRES_IDENTIFIER_UTF8_BYTES,
        )}
        and ${digestHasExactLength(table.targetNamespaceSha256)}`,
    ),
    check(
      "fx_framework_target_namespace_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationCollisionDomains = pgTable(
  "fx_system_framework_migration_collision_domain",
  {
    collisionStorageId: bigint("collision_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_migration_collision_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    targetNamespaceStorageId: bigint("target_namespace_storage_id", {
      mode: "bigint",
    }).notNull(),
    physicalDatabaseIdentity: frameworkMetadataCollatedText(
      "physical_database_identity",
    ).notNull(),
    schemaName: frameworkMetadataCollatedText("schema_name").notNull(),
    owner: frameworkMetadataCollatedText("owner")
      .$type<RelationalSchemaOwner>()
      .notNull(),
    lineageId: frameworkMetadataCollatedText("lineage_id").notNull(),
    physicalNamespaceProfile: frameworkMetadataCollatedText(
      "physical_namespace_profile",
    ).$type<RelationalPhysicalNamespaceProfile>().notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_collision_pk",
      columns: [table.collisionStorageId],
    }),
    unique("fx_framework_migration_collision_coordinate_unique").on(
      table.targetNamespaceStorageId,
      table.owner,
      table.lineageId,
      table.physicalNamespaceProfile,
    ),
    unique("fx_framework_migration_collision_physical_unique").on(
      table.collisionStorageId,
      table.physicalDatabaseIdentity,
      table.schemaName,
    ),
    foreignKey({
      name: "fx_framework_migration_collision_target_fk",
      columns: [
        table.targetNamespaceStorageId,
        table.physicalDatabaseIdentity,
        table.schemaName,
      ],
      foreignColumns: [
        fxSystemFrameworkSchemaTargetNamespaces.targetNamespaceStorageId,
        fxSystemFrameworkSchemaTargetNamespaces.physicalDatabaseIdentity,
        fxSystemFrameworkSchemaTargetNamespaces.schemaName,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_collision_identity_check",
      sql`${table.collisionStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${table.owner} in ('medusa', 'system')
        and ${isFrameworkMetadataTextWithin(
          table.lineageId,
          MAX_COMMON_IDENTITY_UTF8_BYTES,
        )}
        and ${table.physicalNamespaceProfile} = ${sql.raw(
          `'${RELATIONAL_PHYSICAL_NAMESPACE_PROFILE}'`,
        )}`,
    ),
  ],
);

export const fxSystemRelationalPhysicalNameAssignments = pgTable(
  "fx_system_relational_physical_name_assignment",
  {
    assignmentStorageId: bigint("assignment_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_relational_name_assignment_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    physicalDatabaseIdentity: frameworkMetadataCollatedText(
      "physical_database_identity",
    ).notNull(),
    schemaName: frameworkMetadataCollatedText("schema_name").notNull(),
    spelling: frameworkMetadataCollatedText("spelling").notNull(),
    nameSha256: bytea("name_sha256").notNull(),
    assignmentSha256: bytea("assignment_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_relational_name_assignment_pk",
      columns: [table.assignmentStorageId],
    }),
    unique("fx_relational_name_assignment_digest_unique").on(
      table.assignmentSha256,
    ),
    unique("fx_relational_name_assignment_spelling_unique").on(
      table.physicalDatabaseIdentity,
      table.schemaName,
      table.spelling,
    ),
    unique("fx_relational_name_assignment_reference_unique").on(
      table.assignmentStorageId,
      table.collisionStorageId,
      table.spelling,
      table.assignmentSha256,
    ),
    foreignKey({
      name: "fx_relational_name_assignment_collision_fk",
      columns: [
        table.collisionStorageId,
        table.physicalDatabaseIdentity,
        table.schemaName,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationCollisionDomains.collisionStorageId,
        fxSystemFrameworkMigrationCollisionDomains.physicalDatabaseIdentity,
        fxSystemFrameworkMigrationCollisionDomains.schemaName,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_relational_name_assignment_identity_check",
      sql`${table.assignmentStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${table.spelling} ~ '^fxr[tcikfh]_[0-9a-v]{52}$'
        and octet_length(convert_to(${table.spelling}, 'UTF8')) = 57
        and ${digestHasExactLength(table.nameSha256)}
        and ${digestHasExactLength(table.assignmentSha256)}`,
    ),
    check(
      "fx_relational_name_assignment_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_RELATIONAL_PHYSICAL_ASSIGNMENT_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationPlans = pgTable(
  "fx_system_framework_migration_plan",
  {
    planStorageId: bigint("plan_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_migration_plan_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    artifactSha256: bytea("artifact_sha256").notNull(),
    locatorKind: frameworkMetadataCollatedText("locator_kind")
      .$type<ScopeIsolationKind>()
      .notNull(),
    locatorDatabaseKey: frameworkMetadataCollatedText("locator_database_key")
      .notNull(),
    locatorSchemaName: frameworkMetadataCollatedText("locator_schema_name")
      .notNull(),
    migrationPlanSha256: bytea("migration_plan_sha256").notNull(),
    requiredStepSetSha256: bytea("required_step_set_sha256").notNull(),
    physicalLayoutSha256: bytea("physical_layout_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_MIGRATION_PLAN_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_MIGRATION_PLAN_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_plan_pk",
      columns: [table.planStorageId],
    }),
    unique("fx_framework_migration_plan_digest_unique").on(
      table.migrationPlanSha256,
    ),
    unique("fx_framework_migration_plan_context_unique").on(
      table.planStorageId,
      table.collisionStorageId,
    ),
    unique("fx_framework_migration_plan_reference_unique").on(
      table.planStorageId,
      table.collisionStorageId,
      table.migrationPlanSha256,
    ),
    foreignKey({
      name: "fx_framework_migration_plan_collision_fk",
      columns: [table.collisionStorageId],
      foreignColumns: [
        fxSystemFrameworkMigrationCollisionDomains.collisionStorageId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_plan_identity_check",
      sql`${table.planStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.artifactSha256)}
        and ${digestHasExactLength(table.migrationPlanSha256)}
        and ${digestHasExactLength(table.requiredStepSetSha256)}
        and ${digestHasExactLength(table.physicalLayoutSha256)}
        and ${table.locatorKind} in (
          'shared_database', 'schema_per_scope', 'database_per_scope'
        )
        and ${isFrameworkMetadataTextWithin(
          table.locatorDatabaseKey,
          MAX_COMMON_IDENTITY_UTF8_BYTES,
        )}
        and ${isFrameworkMetadataTextWithin(
          table.locatorSchemaName,
          MAX_POSTGRES_IDENTIFIER_UTF8_BYTES,
        )}`,
    ),
    check(
      "fx_framework_migration_plan_frame_check",
      sql`${table.frameFormat} = ${sql.raw(`'${FRAMEWORK_MIGRATION_PLAN_FORMAT}'`)}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_MIGRATION_PLAN_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_MIGRATION_PLAN_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationPlanSteps = pgTable(
  "fx_system_framework_migration_plan_step",
  {
    planStorageId: bigint("plan_storage_id", { mode: "bigint" }).notNull(),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    stepOrdinal: integer("step_ordinal").notNull(),
    stepId: frameworkMetadataCollatedText("step_id").notNull(),
    stepSha256: bytea("step_sha256").notNull(),
    preconditionSha256: bytea("precondition_sha256").notNull(),
    postconditionSha256: bytea("postcondition_sha256").notNull(),
    phase: frameworkMetadataCollatedText("phase")
      .$type<FrameworkMigrationStep["phase"]>()
      .notNull(),
    operationFormat: frameworkMetadataCollatedText("operation_format")
      .$type<RelationalStructuralOperation["codec"]["format"]>()
      .notNull(),
    operationVersion: integer("operation_version")
      .$type<RelationalStructuralOperation["codec"]["version"]>()
      .notNull(),
    dependencyCount: integer("dependency_count").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_plan_step_pk",
      columns: [table.planStorageId, table.stepOrdinal],
    }),
    unique("fx_framework_migration_plan_step_id_unique").on(
      table.planStorageId,
      table.stepId,
    ),
    unique("fx_framework_migration_plan_step_digest_unique").on(
      table.planStorageId,
      table.stepSha256,
    ),
    unique("fx_framework_migration_plan_step_reference_unique").on(
      table.planStorageId,
      table.stepId,
      table.stepSha256,
    ),
    unique("fx_framework_migration_plan_step_receipt_unique").on(
      table.planStorageId,
      table.stepId,
      table.stepSha256,
      table.preconditionSha256,
      table.postconditionSha256,
    ),
    foreignKey({
      name: "fx_framework_migration_plan_step_plan_fk",
      columns: [
        table.planStorageId,
        table.collisionStorageId,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlans.planStorageId,
        fxSystemFrameworkMigrationPlans.collisionStorageId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_plan_step_identity_check",
      sql`${table.stepOrdinal} between 0 and ${sql.raw(
        String(MAX_FRAMEWORK_MIGRATION_PLAN_STEPS - 1),
      )}
        and ${table.stepId} ~ '^step_[0-9a-f]{32}$'
        and ${digestHasExactLength(table.stepSha256)}
        and ${digestHasExactLength(table.preconditionSha256)}
        and ${digestHasExactLength(table.postconditionSha256)}
        and ${table.phase} in ('expansion', 'validation')
        and ${table.operationFormat} in (
          'flarex.relational-create-table',
          'flarex.relational-create-index',
          'flarex.relational-add-foreign-key',
          'flarex.relational-validate-structure'
        )
        and ${table.operationVersion} = 1
        and ${table.dependencyCount} between 0 and ${sql.raw(
          String(MAX_FRAMEWORK_MIGRATION_PLAN_STEPS - 1),
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationPlanStepDependencies = pgTable(
  "fx_system_framework_migration_plan_step_dependency",
  {
    planStorageId: bigint("plan_storage_id", { mode: "bigint" }).notNull(),
    sourceStepId: frameworkMetadataCollatedText("source_step_id").notNull(),
    dependencyOrdinal: integer("dependency_ordinal").notNull(),
    dependencyStepId: frameworkMetadataCollatedText("dependency_step_id")
      .notNull(),
    dependencyStepSha256: bytea("dependency_step_sha256").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_step_dependency_pk",
      columns: [
        table.planStorageId,
        table.sourceStepId,
        table.dependencyOrdinal,
      ],
    }),
    unique("fx_framework_migration_step_dependency_target_unique").on(
      table.planStorageId,
      table.sourceStepId,
      table.dependencyStepId,
    ),
    foreignKey({
      name: "fx_framework_migration_step_dependency_source_fk",
      columns: [table.planStorageId, table.sourceStepId],
      foreignColumns: [
        fxSystemFrameworkMigrationPlanSteps.planStorageId,
        fxSystemFrameworkMigrationPlanSteps.stepId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_step_dependency_target_fk",
      columns: [
        table.planStorageId,
        table.dependencyStepId,
        table.dependencyStepSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlanSteps.planStorageId,
        fxSystemFrameworkMigrationPlanSteps.stepId,
        fxSystemFrameworkMigrationPlanSteps.stepSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_step_dependency_identity_check",
      sql`${table.dependencyOrdinal} between 0 and ${sql.raw(
        String(MAX_FRAMEWORK_MIGRATION_PLAN_STEPS - 1),
      )}
        and ${table.sourceStepId} <> ${table.dependencyStepId}
        and ${digestHasExactLength(table.dependencyStepSha256)}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationPlanAdmissions = pgTable(
  "fx_system_framework_migration_plan_admission",
  {
    admissionStorageId: bigint("admission_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_migration_admission_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    planStorageId: bigint("plan_storage_id", { mode: "bigint" }).notNull(),
    migrationPlanSha256: bytea("migration_plan_sha256").notNull(),
    previousPlanStorageId: bigint("previous_plan_storage_id", {
      mode: "bigint",
    }),
    previousPlanSha256: bytea("previous_plan_sha256"),
    admissionSha256: bytea("admission_sha256").notNull(),
    admissionProfile: frameworkMetadataCollatedText("admission_profile")
      .$type<FrameworkMigrationPlanAdmissionFrame["admissionProfile"]>()
      .notNull(),
    assignmentCount: integer("assignment_count").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_admission_pk",
      columns: [table.admissionStorageId],
    }),
    unique("fx_framework_migration_admission_digest_unique").on(
      table.admissionSha256,
    ),
    unique("fx_framework_migration_admission_reference_unique").on(
      table.admissionStorageId,
      table.collisionStorageId,
      table.planStorageId,
      table.admissionSha256,
    ),
    unique("fx_framework_migration_admission_context_unique").on(
      table.admissionStorageId,
      table.collisionStorageId,
    ),
    foreignKey({
      name: "fx_framework_migration_admission_plan_fk",
      columns: [
        table.planStorageId,
        table.collisionStorageId,
        table.migrationPlanSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlans.planStorageId,
        fxSystemFrameworkMigrationPlans.collisionStorageId,
        fxSystemFrameworkMigrationPlans.migrationPlanSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_admission_previous_plan_fk",
      columns: [
        table.previousPlanStorageId,
        table.collisionStorageId,
        table.previousPlanSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlans.planStorageId,
        fxSystemFrameworkMigrationPlans.collisionStorageId,
        fxSystemFrameworkMigrationPlans.migrationPlanSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_admission_identity_check",
      sql`${table.admissionStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.migrationPlanSha256)}
        and ${digestHasExactLength(table.admissionSha256)}
        and (
          (${table.previousPlanStorageId} is null
            and ${table.previousPlanSha256} is null)
          or
          (${table.previousPlanStorageId} is not null
            and ${table.previousPlanSha256} is not null
            and ${digestHasExactLength(table.previousPlanSha256)})
        )
        and ${table.admissionProfile} = 'synthetic-system-fresh'
        and ${table.assignmentCount} between 0 and ${sql.raw(
          String(MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS),
        )}`,
    ),
    check(
      "fx_framework_migration_admission_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_MIGRATION_PLAN_ADMISSION_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_MIGRATION_PLAN_ADMISSION_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationAdmissionAssignments = pgTable(
  "fx_system_framework_migration_admission_assignment",
  {
    admissionStorageId: bigint("admission_storage_id", {
      mode: "bigint",
    }).notNull(),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    assignmentOrdinal: integer("assignment_ordinal").notNull(),
    assignmentStorageId: bigint("assignment_storage_id", {
      mode: "bigint",
    }).notNull(),
    spelling: frameworkMetadataCollatedText("spelling").notNull(),
    assignmentSha256: bytea("assignment_sha256").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_admission_assignment_pk",
      columns: [table.admissionStorageId, table.assignmentOrdinal],
    }),
    unique("fx_framework_migration_admission_member_unique").on(
      table.admissionStorageId,
      table.assignmentStorageId,
    ),
    foreignKey({
      name: "fx_framework_migration_admission_assignment_parent_fk",
      columns: [table.admissionStorageId, table.collisionStorageId],
      foreignColumns: [
        fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.collisionStorageId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_admission_assignment_value_fk",
      columns: [
        table.assignmentStorageId,
        table.collisionStorageId,
        table.spelling,
        table.assignmentSha256,
      ],
      foreignColumns: [
        fxSystemRelationalPhysicalNameAssignments.assignmentStorageId,
        fxSystemRelationalPhysicalNameAssignments.collisionStorageId,
        fxSystemRelationalPhysicalNameAssignments.spelling,
        fxSystemRelationalPhysicalNameAssignments.assignmentSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_admission_assignment_identity_check",
      sql`${table.assignmentOrdinal} between 0 and ${sql.raw(
        String(MAX_RELATIONAL_PHYSICAL_ASSIGNMENTS - 1),
      )}
        and ${digestHasExactLength(table.assignmentSha256)}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationAttemptStarts = pgTable(
  "fx_system_framework_migration_attempt_start",
  {
    attemptStorageId: bigint("attempt_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_migration_attempt_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    planStorageId: bigint("plan_storage_id", { mode: "bigint" }).notNull(),
    migrationPlanSha256: bytea("migration_plan_sha256").notNull(),
    admissionStorageId: bigint("admission_storage_id", {
      mode: "bigint",
    }).notNull(),
    admissionSha256: bytea("admission_sha256").notNull(),
    attemptId: frameworkMetadataCollatedText("attempt_id").notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" }).notNull(),
    leaseOwnerId: frameworkMetadataCollatedText("lease_owner_id").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
    previousAttemptStorageId: bigint("previous_attempt_storage_id", {
      mode: "bigint",
    }),
    previousAttemptId: frameworkMetadataCollatedText("previous_attempt_id"),
    attemptStartSha256: bytea("attempt_start_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_attempt_pk",
      columns: [table.attemptStorageId],
    }),
    unique("fx_framework_migration_attempt_id_unique").on(
      table.collisionStorageId,
      table.attemptId,
    ),
    unique("fx_framework_migration_attempt_fence_unique").on(
      table.collisionStorageId,
      table.attemptFence,
    ),
    unique("fx_framework_migration_attempt_reference_unique").on(
      table.attemptStorageId,
      table.collisionStorageId,
      table.planStorageId,
      table.attemptId,
      table.attemptFence,
    ),
    unique("fx_framework_migration_attempt_admission_reference_unique").on(
      table.attemptStorageId,
      table.collisionStorageId,
      table.planStorageId,
      table.admissionStorageId,
      table.admissionSha256,
      table.attemptId,
      table.attemptFence,
    ),
    unique("fx_framework_migration_attempt_previous_unique").on(
      table.attemptStorageId,
      table.collisionStorageId,
      table.attemptId,
    ),
    foreignKey({
      name: "fx_framework_migration_attempt_plan_fk",
      columns: [
        table.planStorageId,
        table.collisionStorageId,
        table.migrationPlanSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlans.planStorageId,
        fxSystemFrameworkMigrationPlans.collisionStorageId,
        fxSystemFrameworkMigrationPlans.migrationPlanSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_attempt_admission_fk",
      columns: [
        table.admissionStorageId,
        table.collisionStorageId,
        table.planStorageId,
        table.admissionSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.collisionStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.planStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.admissionSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_attempt_previous_fk",
      columns: [
        table.previousAttemptStorageId,
        table.collisionStorageId,
        table.previousAttemptId,
      ],
      foreignColumns: [
        table.attemptStorageId,
        table.collisionStorageId,
        table.attemptId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_attempt_identity_check",
      sql`${table.attemptStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.migrationPlanSha256)}
        and ${digestHasExactLength(table.admissionSha256)}
        and ${isFrameworkMetadataTextWithin(
          table.attemptId,
          MAX_COMMON_IDENTITY_UTF8_BYTES,
        )}
        and ${table.attemptFence} between 0 and ${sql.raw(MAX_INT64)}
        and ${isFrameworkMetadataTextWithin(
          table.leaseOwnerId,
          MAX_COMMON_IDENTITY_UTF8_BYTES,
        )}
        and isfinite(${table.leaseExpiresAt})
        and (
          (${table.previousAttemptStorageId} is null
            and ${table.previousAttemptId} is null)
          or
          (${table.previousAttemptStorageId} is not null
            and ${table.previousAttemptId} is not null
            and ${table.previousAttemptStorageId} <> ${table.attemptStorageId})
        )
        and ${digestHasExactLength(table.attemptStartSha256)}`,
    ),
    check(
      "fx_framework_migration_attempt_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationStepReceipts = pgTable(
  "fx_system_framework_migration_step_receipt",
  {
    receiptStorageId: bigint("receipt_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_migration_receipt_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    planStorageId: bigint("plan_storage_id", { mode: "bigint" }).notNull(),
    attemptStorageId: bigint("attempt_storage_id", {
      mode: "bigint",
    }).notNull(),
    attemptId: frameworkMetadataCollatedText("attempt_id").notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" }).notNull(),
    stepId: frameworkMetadataCollatedText("step_id").notNull(),
    stepSha256: bytea("step_sha256").notNull(),
    preconditionSha256: bytea("precondition_sha256").notNull(),
    postconditionSha256: bytea("postcondition_sha256").notNull(),
    observedPostconditionSha256: bytea("observed_postcondition_sha256")
      .notNull(),
    dependencyCount: integer("dependency_count").notNull(),
    stepReceiptSha256: bytea("step_receipt_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_receipt_pk",
      columns: [table.receiptStorageId],
    }),
    unique("fx_framework_migration_receipt_attempt_step_unique").on(
      table.attemptStorageId,
      table.stepId,
    ),
    unique("fx_framework_migration_receipt_digest_unique").on(
      table.stepReceiptSha256,
    ),
    unique("fx_framework_migration_receipt_source_unique").on(
      table.receiptStorageId,
      table.attemptStorageId,
    ),
    unique("fx_framework_migration_receipt_dependency_unique").on(
      table.receiptStorageId,
      table.attemptStorageId,
      table.stepId,
      table.stepReceiptSha256,
    ),
    unique("fx_framework_migration_receipt_terminal_unique").on(
      table.receiptStorageId,
      table.attemptStorageId,
      table.stepReceiptSha256,
    ),
    foreignKey({
      name: "fx_framework_migration_receipt_attempt_fk",
      columns: [
        table.attemptStorageId,
        table.collisionStorageId,
        table.planStorageId,
        table.attemptId,
        table.attemptFence,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
        fxSystemFrameworkMigrationAttemptStarts.collisionStorageId,
        fxSystemFrameworkMigrationAttemptStarts.planStorageId,
        fxSystemFrameworkMigrationAttemptStarts.attemptId,
        fxSystemFrameworkMigrationAttemptStarts.attemptFence,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_receipt_plan_step_fk",
      columns: [
        table.planStorageId,
        table.stepId,
        table.stepSha256,
        table.preconditionSha256,
        table.postconditionSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlanSteps.planStorageId,
        fxSystemFrameworkMigrationPlanSteps.stepId,
        fxSystemFrameworkMigrationPlanSteps.stepSha256,
        fxSystemFrameworkMigrationPlanSteps.preconditionSha256,
        fxSystemFrameworkMigrationPlanSteps.postconditionSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_receipt_identity_check",
      sql`${table.receiptStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${table.attemptFence} between 0 and ${sql.raw(MAX_INT64)}
        and ${table.stepId} ~ '^step_[0-9a-f]{32}$'
        and ${digestHasExactLength(table.stepSha256)}
        and ${digestHasExactLength(table.preconditionSha256)}
        and ${digestHasExactLength(table.postconditionSha256)}
        and ${digestHasExactLength(table.observedPostconditionSha256)}
        and ${table.observedPostconditionSha256} = ${table.postconditionSha256}
        and ${table.dependencyCount} between 0 and ${sql.raw(
          String(MAX_FRAMEWORK_MIGRATION_PLAN_STEPS - 1),
        )}
        and ${digestHasExactLength(table.stepReceiptSha256)}`,
    ),
    check(
      "fx_framework_migration_receipt_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_MIGRATION_STEP_RECEIPT_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_MIGRATION_STEP_RECEIPT_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationStepReceiptDependencies = pgTable(
  "fx_system_framework_migration_step_receipt_dependency",
  {
    receiptStorageId: bigint("receipt_storage_id", { mode: "bigint" })
      .notNull(),
    attemptStorageId: bigint("attempt_storage_id", { mode: "bigint" })
      .notNull(),
    dependencyOrdinal: integer("dependency_ordinal").notNull(),
    dependencyReceiptStorageId: bigint("dependency_receipt_storage_id", {
      mode: "bigint",
    }).notNull(),
    dependencyStepId: frameworkMetadataCollatedText("dependency_step_id")
      .notNull(),
    dependencyStepReceiptSha256: bytea("dependency_step_receipt_sha256")
      .notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_receipt_dependency_pk",
      columns: [table.receiptStorageId, table.dependencyOrdinal],
    }),
    unique("fx_framework_migration_receipt_dependency_target_unique").on(
      table.receiptStorageId,
      table.dependencyReceiptStorageId,
    ),
    foreignKey({
      name: "fx_framework_migration_receipt_dependency_source_fk",
      columns: [table.receiptStorageId, table.attemptStorageId],
      foreignColumns: [
        fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
        fxSystemFrameworkMigrationStepReceipts.attemptStorageId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_receipt_dependency_target_fk",
      columns: [
        table.dependencyReceiptStorageId,
        table.attemptStorageId,
        table.dependencyStepId,
        table.dependencyStepReceiptSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
        fxSystemFrameworkMigrationStepReceipts.attemptStorageId,
        fxSystemFrameworkMigrationStepReceipts.stepId,
        fxSystemFrameworkMigrationStepReceipts.stepReceiptSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_receipt_dependency_identity_check",
      sql`${table.dependencyOrdinal} between 0 and ${sql.raw(
        String(MAX_FRAMEWORK_MIGRATION_PLAN_STEPS - 1),
      )}
        and ${table.receiptStorageId} <> ${table.dependencyReceiptStorageId}
        and ${table.dependencyStepId} ~ '^step_[0-9a-f]{32}$'
        and ${digestHasExactLength(table.dependencyStepReceiptSha256)}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationAttemptTerminals = pgTable(
  "fx_system_framework_migration_attempt_terminal",
  {
    terminalStorageId: bigint("terminal_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_migration_terminal_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    planStorageId: bigint("plan_storage_id", { mode: "bigint" }).notNull(),
    attemptStorageId: bigint("attempt_storage_id", {
      mode: "bigint",
    }).notNull(),
    admissionStorageId: bigint("admission_storage_id", {
      mode: "bigint",
    }).notNull(),
    admissionSha256: bytea("admission_sha256").notNull(),
    attemptId: frameworkMetadataCollatedText("attempt_id").notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" }).notNull(),
    outcomeKind: frameworkMetadataCollatedText("outcome_kind")
      .$type<FrameworkMigrationAttemptOutcome["kind"]>()
      .notNull(),
    requiredStepSetSha256: bytea("required_step_set_sha256"),
    failureReason: frameworkMetadataCollatedText("failure_reason")
      .$type<FrameworkMigrationFailureReason>(),
    evidenceSha256: bytea("evidence_sha256"),
    lastReceiptStorageId: bigint("last_receipt_storage_id", {
      mode: "bigint",
    }),
    lastStepReceiptSha256: bytea("last_step_receipt_sha256"),
    attemptTerminalSha256: bytea("attempt_terminal_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_terminal_pk",
      columns: [table.terminalStorageId],
    }),
    unique("fx_framework_migration_terminal_attempt_unique").on(
      table.attemptStorageId,
    ),
    unique("fx_framework_migration_terminal_digest_unique").on(
      table.attemptTerminalSha256,
    ),
    unique("fx_framework_migration_terminal_reference_unique").on(
      table.terminalStorageId,
      table.collisionStorageId,
      table.planStorageId,
      table.attemptStorageId,
      table.outcomeKind,
      table.attemptTerminalSha256,
    ),
    unique("fx_framework_migration_terminal_installation_unique").on(
      table.terminalStorageId,
      table.collisionStorageId,
      table.planStorageId,
      table.admissionStorageId,
      table.admissionSha256,
      table.outcomeKind,
      table.attemptTerminalSha256,
    ),
    foreignKey({
      name: "fx_framework_migration_terminal_attempt_fk",
      columns: [
        table.attemptStorageId,
        table.collisionStorageId,
        table.planStorageId,
        table.admissionStorageId,
        table.admissionSha256,
        table.attemptId,
        table.attemptFence,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
        fxSystemFrameworkMigrationAttemptStarts.collisionStorageId,
        fxSystemFrameworkMigrationAttemptStarts.planStorageId,
        fxSystemFrameworkMigrationAttemptStarts.admissionStorageId,
        fxSystemFrameworkMigrationAttemptStarts.admissionSha256,
        fxSystemFrameworkMigrationAttemptStarts.attemptId,
        fxSystemFrameworkMigrationAttemptStarts.attemptFence,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_terminal_last_receipt_fk",
      columns: [
        table.lastReceiptStorageId,
        table.attemptStorageId,
        table.lastStepReceiptSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
        fxSystemFrameworkMigrationStepReceipts.attemptStorageId,
        fxSystemFrameworkMigrationStepReceipts.stepReceiptSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_terminal_identity_check",
      sql`${table.terminalStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.admissionSha256)}
        and ${table.attemptFence} between 0 and ${sql.raw(MAX_INT64)}
        and ${table.outcomeKind} in ('succeeded', 'failed', 'decisionUncertain')
        and (
          (${table.outcomeKind} = 'succeeded'
            and ${table.requiredStepSetSha256} is not null
            and ${digestHasExactLength(table.requiredStepSetSha256)}
            and ${table.failureReason} is null
            and ${table.evidenceSha256} is null
            and ${table.lastReceiptStorageId} is not null
            and ${table.lastStepReceiptSha256} is not null)
          or
          (${table.outcomeKind} = 'failed'
            and ${table.requiredStepSetSha256} is null
            and ${table.failureReason} is not null
            and ${table.failureReason} in (
              'operationFailed', 'validationFailed', 'leaseLost', 'superseded'
            )
            and ${table.evidenceSha256} is not null
            and ${digestHasExactLength(table.evidenceSha256)})
          or
          (${table.outcomeKind} = 'decisionUncertain'
            and ${table.requiredStepSetSha256} is null
            and ${table.failureReason} is null
            and ${table.evidenceSha256} is not null
            and ${digestHasExactLength(table.evidenceSha256)})
        )
        and (
          (${table.lastReceiptStorageId} is null
            and ${table.lastStepReceiptSha256} is null)
          or
          (${table.lastReceiptStorageId} is not null
            and ${table.lastStepReceiptSha256} is not null
            and ${digestHasExactLength(table.lastStepReceiptSha256)})
        )
        and ${digestHasExactLength(table.attemptTerminalSha256)}`,
    ),
    check(
      "fx_framework_migration_terminal_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_MIGRATION_ATTEMPT_TERMINAL_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationEvents = pgTable(
  "fx_system_framework_migration_event",
  {
    eventStorageId: bigint("event_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_migration_event_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    eventSequence: bigint("event_sequence", { mode: "bigint" }).notNull(),
    eventSha256: bytea("event_sha256").notNull(),
    previousEventStorageId: bigint("previous_event_storage_id", {
      mode: "bigint",
    }),
    previousEventSequence: bigint("previous_event_sequence", {
      mode: "bigint",
    }),
    previousEventSha256: bytea("previous_event_sha256"),
    eventKind: frameworkMetadataCollatedText("event_kind")
      .$type<FrameworkMigrationEventFrame["kind"]>()
      .notNull(),
    subjectSha256: bytea("subject_sha256"),
    leaseAttemptId: frameworkMetadataCollatedText("lease_attempt_id"),
    leaseAttemptFence: bigint("lease_attempt_fence", { mode: "bigint" }),
    leaseOwnerId: frameworkMetadataCollatedText("lease_owner_id"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3,
    }),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_MIGRATION_EVENT_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_MIGRATION_EVENT_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_event_pk",
      columns: [table.eventStorageId],
    }),
    unique("fx_framework_migration_event_sequence_unique").on(
      table.collisionStorageId,
      table.eventSequence,
    ),
    unique("fx_framework_migration_event_digest_unique").on(
      table.eventSha256,
    ),
    unique("fx_framework_migration_event_reference_unique").on(
      table.eventStorageId,
      table.collisionStorageId,
      table.eventSequence,
      table.eventSha256,
    ),
    foreignKey({
      name: "fx_framework_migration_event_collision_fk",
      columns: [table.collisionStorageId],
      foreignColumns: [
        fxSystemFrameworkMigrationCollisionDomains.collisionStorageId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_event_previous_fk",
      columns: [
        table.previousEventStorageId,
        table.collisionStorageId,
        table.previousEventSequence,
        table.previousEventSha256,
      ],
      foreignColumns: [
        table.eventStorageId,
        table.collisionStorageId,
        table.eventSequence,
        table.eventSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_event_identity_check",
      sql`${table.eventStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${table.eventSequence} between 0 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.eventSha256)}
        and (
          (${table.previousEventStorageId} is null
            and ${table.previousEventSequence} is null
            and ${table.previousEventSha256} is null)
          or
          (${table.previousEventStorageId} is not null
            and ${table.previousEventSequence} is not null
            and ${table.previousEventSha256} is not null
            and ${table.previousEventSequence} < ${table.eventSequence}
            and ${digestHasExactLength(table.previousEventSha256)})
        )
        and ${table.eventKind} in (
          'planAdmitted', 'attemptStarted', 'leaseRenewed', 'stepCompleted',
          'attemptTerminated', 'installationPublished', 'readinessPublished'
        )
        and (
          (${table.eventKind} = 'leaseRenewed'
            and ${table.subjectSha256} is null
            and ${table.leaseAttemptId} is not null
            and ${isFrameworkMetadataTextWithin(
              table.leaseAttemptId,
              MAX_COMMON_IDENTITY_UTF8_BYTES,
            )}
            and ${table.leaseAttemptFence} is not null
            and ${table.leaseAttemptFence} between 0 and ${sql.raw(MAX_INT64)}
            and ${table.leaseOwnerId} is not null
            and ${isFrameworkMetadataTextWithin(
              table.leaseOwnerId,
              MAX_COMMON_IDENTITY_UTF8_BYTES,
            )}
            and ${table.leaseExpiresAt} is not null
            and isfinite(${table.leaseExpiresAt}))
          or
          (${table.eventKind} <> 'leaseRenewed'
            and ${table.subjectSha256} is not null
            and ${digestHasExactLength(table.subjectSha256)}
            and ${table.leaseAttemptId} is null
            and ${table.leaseAttemptFence} is null
            and ${table.leaseOwnerId} is null
            and ${table.leaseExpiresAt} is null)
        )`,
    ),
    check(
      "fx_framework_migration_event_frame_check",
      sql`${table.frameFormat} = ${sql.raw(`'${FRAMEWORK_MIGRATION_EVENT_FORMAT}'`)}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_MIGRATION_EVENT_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkMigrationCollisionHeads = pgTable(
  "fx_system_framework_migration_collision_head",
  {
    collisionStorageId: bigint("collision_storage_id", {
      mode: "bigint",
    }).notNull(),
    currentPlanStorageId: bigint("current_plan_storage_id", {
      mode: "bigint",
    }).notNull(),
    currentPlanSha256: bytea("current_plan_sha256").notNull(),
    currentAdmissionStorageId: bigint("current_admission_storage_id", {
      mode: "bigint",
    }).notNull(),
    currentAdmissionSha256: bytea("current_admission_sha256").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" }).notNull(),
    currentAttemptStorageId: bigint("current_attempt_storage_id", {
      mode: "bigint",
    }),
    currentAttemptId: frameworkMetadataCollatedText("current_attempt_id"),
    currentAttemptFence: bigint("current_attempt_fence", { mode: "bigint" }),
    currentLeaseOwnerId: frameworkMetadataCollatedText(
      "current_lease_owner_id",
    ),
    currentLeaseExpiresAt: timestamp("current_lease_expires_at", {
      withTimezone: true,
      precision: 3,
    }),
    lastEventStorageId: bigint("last_event_storage_id", { mode: "bigint" }),
    lastEventSequence: bigint("last_event_sequence", { mode: "bigint" }),
    lastEventSha256: bytea("last_event_sha256"),
    collisionHeadSha256: bytea("collision_head_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_migration_collision_head_pk",
      columns: [table.collisionStorageId],
    }),
    foreignKey({
      name: "fx_framework_migration_collision_head_plan_fk",
      columns: [
        table.currentPlanStorageId,
        table.collisionStorageId,
        table.currentPlanSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlans.planStorageId,
        fxSystemFrameworkMigrationPlans.collisionStorageId,
        fxSystemFrameworkMigrationPlans.migrationPlanSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_collision_head_admission_fk",
      columns: [
        table.currentAdmissionStorageId,
        table.collisionStorageId,
        table.currentPlanStorageId,
        table.currentAdmissionSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationPlanAdmissions.admissionStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.collisionStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.planStorageId,
        fxSystemFrameworkMigrationPlanAdmissions.admissionSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_collision_head_attempt_fk",
      columns: [
        table.currentAttemptStorageId,
        table.collisionStorageId,
        table.currentPlanStorageId,
        table.currentAdmissionStorageId,
        table.currentAdmissionSha256,
        table.currentAttemptId,
        table.currentAttemptFence,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
        fxSystemFrameworkMigrationAttemptStarts.collisionStorageId,
        fxSystemFrameworkMigrationAttemptStarts.planStorageId,
        fxSystemFrameworkMigrationAttemptStarts.admissionStorageId,
        fxSystemFrameworkMigrationAttemptStarts.admissionSha256,
        fxSystemFrameworkMigrationAttemptStarts.attemptId,
        fxSystemFrameworkMigrationAttemptStarts.attemptFence,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_migration_collision_head_event_fk",
      columns: [
        table.lastEventStorageId,
        table.collisionStorageId,
        table.lastEventSequence,
        table.lastEventSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationEvents.eventStorageId,
        fxSystemFrameworkMigrationEvents.collisionStorageId,
        fxSystemFrameworkMigrationEvents.eventSequence,
        fxSystemFrameworkMigrationEvents.eventSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_migration_collision_head_identity_check",
      sql`${table.headRevision} between 0 and ${sql.raw(MAX_INT64)}
        and ${table.attemptFence} between 0 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.currentPlanSha256)}
        and ${digestHasExactLength(table.currentAdmissionSha256)}
        and (
          (${table.currentAttemptStorageId} is null
            and ${table.currentAttemptId} is null
            and ${table.currentAttemptFence} is null
            and ${table.currentLeaseOwnerId} is null
            and ${table.currentLeaseExpiresAt} is null)
          or
          (${table.currentAttemptStorageId} is not null
            and ${table.currentAttemptId} is not null
            and ${isFrameworkMetadataTextWithin(
              table.currentAttemptId,
              MAX_COMMON_IDENTITY_UTF8_BYTES,
            )}
            and ${table.currentAttemptFence} is not null
            and ${table.currentAttemptFence} = ${table.attemptFence}
            and ${table.currentLeaseOwnerId} is not null
            and ${isFrameworkMetadataTextWithin(
              table.currentLeaseOwnerId,
              MAX_COMMON_IDENTITY_UTF8_BYTES,
            )}
            and ${table.currentLeaseExpiresAt} is not null
            and isfinite(${table.currentLeaseExpiresAt}))
        )
        and (
          (${table.lastEventStorageId} is null
            and ${table.lastEventSequence} is null
            and ${table.lastEventSha256} is null)
          or
          (${table.lastEventStorageId} is not null
            and ${table.lastEventSequence} is not null
            and ${table.lastEventSequence} between 0 and ${sql.raw(MAX_INT64)}
            and ${table.lastEventSha256} is not null
            and ${digestHasExactLength(table.lastEventSha256)})
        )
        and ${digestHasExactLength(table.collisionHeadSha256)}`,
    ),
    check(
      "fx_framework_migration_collision_head_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
        )}`,
    ),
  ],
);
