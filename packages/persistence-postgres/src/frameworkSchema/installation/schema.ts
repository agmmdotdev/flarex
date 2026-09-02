import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";

import {
  fxSystemFrameworkMigrationAttemptTerminals,
  fxSystemFrameworkMigrationPlanAdmissions,
  fxSystemFrameworkMigrationPlans,
} from "../../migrationCoordination/schema";
import type { FrameworkMigrationAttemptOutcome } from
  "../../migrationCoordination/model";
import { bytea } from "../../schema";
import {
  frameworkMetadataCollatedText,
} from "../privateMetadataSchemaSupport";
import {
  MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
} from "./canonical";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
  FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
  FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
  FRAMEWORK_SCHEMA_READINESS_FORMAT,
  FRAMEWORK_SCHEMA_READINESS_VERSION,
  type FrameworkSchemaAvailabilityStatus,
} from "./model";

const MAX_INT64 = "9223372036854775807";

type SuccessfulFrameworkMigrationOutcomeKind = Extract<
  FrameworkMigrationAttemptOutcome,
  { readonly kind: "succeeded" }
>["kind"];

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

export const fxSystemFrameworkSchemaInstallations = pgTable(
  "fx_system_framework_schema_installation",
  {
    installationStorageId: bigint("installation_storage_id", {
      mode: "bigint",
    }).generatedAlwaysAsIdentity({
      name: "fx_framework_installation_storage_id_seq",
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
    terminalStorageId: bigint("terminal_storage_id", {
      mode: "bigint",
    }).notNull(),
    terminalOutcomeKind: frameworkMetadataCollatedText("terminal_outcome_kind")
      .$type<SuccessfulFrameworkMigrationOutcomeKind>()
      .notNull(),
    terminalSha256: bytea("terminal_sha256").notNull(),
    installationSha256: bytea("installation_sha256").notNull(),
    installationReceiptSha256: bytea("installation_receipt_sha256").notNull(),
    installedStructureSha256: bytea("installed_structure_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_SCHEMA_INSTALLATION_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_SCHEMA_INSTALLATION_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_installation_pk",
      columns: [table.installationStorageId],
    }),
    unique("fx_framework_installation_identity_unique").on(
      table.installationSha256,
    ),
    unique("fx_framework_installation_receipt_unique").on(
      table.installationReceiptSha256,
    ),
    unique("fx_framework_installation_reference_unique").on(
      table.installationStorageId,
      table.installationSha256,
      table.installationReceiptSha256,
    ),
    foreignKey({
      name: "fx_framework_installation_plan_fk",
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
      name: "fx_framework_installation_admission_fk",
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
      name: "fx_framework_installation_terminal_fk",
      columns: [
        table.terminalStorageId,
        table.collisionStorageId,
        table.planStorageId,
        table.admissionStorageId,
        table.admissionSha256,
        table.terminalOutcomeKind,
        table.terminalSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
        fxSystemFrameworkMigrationAttemptTerminals.collisionStorageId,
        fxSystemFrameworkMigrationAttemptTerminals.planStorageId,
        fxSystemFrameworkMigrationAttemptTerminals.admissionStorageId,
        fxSystemFrameworkMigrationAttemptTerminals.admissionSha256,
        fxSystemFrameworkMigrationAttemptTerminals.outcomeKind,
        fxSystemFrameworkMigrationAttemptTerminals.attemptTerminalSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_installation_identity_check",
      sql`${table.installationStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.migrationPlanSha256)}
        and ${digestHasExactLength(table.admissionSha256)}
        and ${table.terminalOutcomeKind} = 'succeeded'
        and ${digestHasExactLength(table.terminalSha256)}
        and ${digestHasExactLength(table.installationSha256)}
        and ${digestHasExactLength(table.installationReceiptSha256)}
        and ${digestHasExactLength(table.installedStructureSha256)}`,
    ),
    check(
      "fx_framework_installation_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_SCHEMA_INSTALLATION_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_SCHEMA_INSTALLATION_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkSchemaReadiness = pgTable(
  "fx_system_framework_schema_readiness",
  {
    readinessStorageId: bigint("readiness_storage_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity({
        name: "fx_framework_readiness_storage_id_seq",
        startWith: 1,
        increment: 1,
        minValue: 1,
        maxValue: MAX_INT64,
        cache: 1,
        cycle: false,
      }),
    installationStorageId: bigint("installation_storage_id", {
      mode: "bigint",
    }).notNull(),
    installationSha256: bytea("installation_sha256").notNull(),
    installationReceiptSha256: bytea("installation_receipt_sha256").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    validationSha256: bytea("validation_sha256").notNull(),
    validatedStructureSha256: bytea("validated_structure_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_SCHEMA_READINESS_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_SCHEMA_READINESS_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_readiness_pk",
      columns: [table.readinessStorageId],
    }),
    unique("fx_framework_readiness_installation_unique").on(
      table.installationStorageId,
    ),
    unique("fx_framework_readiness_digest_unique").on(
      table.readinessSha256,
    ),
    unique("fx_framework_readiness_reference_unique").on(
      table.readinessStorageId,
      table.installationStorageId,
      table.readinessSha256,
    ),
    unique("fx_framework_readiness_context_unique").on(
      table.readinessStorageId,
      table.installationStorageId,
    ),
    foreignKey({
      name: "fx_framework_readiness_installation_fk",
      columns: [
        table.installationStorageId,
        table.installationSha256,
        table.installationReceiptSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkSchemaInstallations.installationStorageId,
        fxSystemFrameworkSchemaInstallations.installationSha256,
        fxSystemFrameworkSchemaInstallations.installationReceiptSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_readiness_identity_check",
      sql`${table.readinessStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${digestHasExactLength(table.installationSha256)}
        and ${digestHasExactLength(table.installationReceiptSha256)}
        and ${digestHasExactLength(table.readinessSha256)}
        and ${digestHasExactLength(table.validationSha256)}
        and ${digestHasExactLength(table.validatedStructureSha256)}`,
    ),
    check(
      "fx_framework_readiness_frame_check",
      sql`${table.frameFormat} = ${sql.raw(`'${FRAMEWORK_SCHEMA_READINESS_FORMAT}'`)}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_SCHEMA_READINESS_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkSchemaAvailabilityHistory = pgTable(
  "fx_system_framework_schema_availability_history",
  {
    availabilityHistoryStorageId: bigint(
      "availability_history_storage_id",
      { mode: "bigint" },
    ).generatedAlwaysAsIdentity({
      name: "fx_framework_availability_history_storage_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: MAX_INT64,
      cache: 1,
      cycle: false,
    }),
    installationStorageId: bigint("installation_storage_id", {
      mode: "bigint",
    }).notNull(),
    readinessStorageId: bigint("readiness_storage_id", {
      mode: "bigint",
    }).notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    availabilitySequence: bigint("availability_sequence", { mode: "bigint" })
      .notNull(),
    status: frameworkMetadataCollatedText("status")
      .$type<FrameworkSchemaAvailabilityStatus>()
      .notNull(),
    reasonSha256: bytea("reason_sha256"),
    historySha256: bytea("history_sha256").notNull(),
    previousHistoryStorageId: bigint("previous_history_storage_id", {
      mode: "bigint",
    }),
    previousAvailabilitySequence: bigint("previous_availability_sequence", {
      mode: "bigint",
    }),
    previousHistorySha256: bytea("previous_history_sha256"),
    previousStatus: frameworkMetadataCollatedText("previous_status")
      .$type<FrameworkSchemaAvailabilityStatus>(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_availability_history_pk",
      columns: [table.availabilityHistoryStorageId],
    }),
    unique("fx_framework_availability_history_sequence_unique").on(
      table.installationStorageId,
      table.availabilitySequence,
    ),
    unique("fx_framework_availability_history_digest_unique").on(
      table.installationStorageId,
      table.historySha256,
    ),
    unique("fx_framework_availability_history_reference_unique").on(
      table.availabilityHistoryStorageId,
      table.installationStorageId,
      table.readinessStorageId,
      table.availabilitySequence,
      table.status,
      table.historySha256,
    ),
    foreignKey({
      name: "fx_framework_availability_history_readiness_fk",
      columns: [
        table.readinessStorageId,
        table.installationStorageId,
        table.readinessSha256,
      ],
      foreignColumns: [
        fxSystemFrameworkSchemaReadiness.readinessStorageId,
        fxSystemFrameworkSchemaReadiness.installationStorageId,
        fxSystemFrameworkSchemaReadiness.readinessSha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_availability_history_previous_fk",
      columns: [
        table.previousHistoryStorageId,
        table.installationStorageId,
        table.readinessStorageId,
        table.previousAvailabilitySequence,
        table.previousStatus,
        table.previousHistorySha256,
      ],
      foreignColumns: [
        table.availabilityHistoryStorageId,
        table.installationStorageId,
        table.readinessStorageId,
        table.availabilitySequence,
        table.status,
        table.historySha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_availability_history_identity_check",
      sql`${table.availabilityHistoryStorageId} between 1 and ${sql.raw(MAX_INT64)}
        and ${table.availabilitySequence} between 1 and ${sql.raw(MAX_INT64)}
        and ${table.status} in (
          'ready', 'withdrawn', 'superseded', 'quarantined'
        )
        and ${digestHasExactLength(table.readinessSha256)}
        and ${digestHasExactLength(table.historySha256)}
        and (
          (${table.availabilitySequence} = 1
            and ${table.status} = 'ready'
            and ${table.reasonSha256} is null
            and ${table.previousHistoryStorageId} is null
            and ${table.previousAvailabilitySequence} is null
            and ${table.previousHistorySha256} is null
            and ${table.previousStatus} is null)
          or
          (${table.availabilitySequence} > 1
            and ${table.previousHistoryStorageId} is not null
            and ${table.previousAvailabilitySequence} is not null
            and ${table.previousAvailabilitySequence} =
              ${table.availabilitySequence} - 1
            and ${table.previousHistorySha256} is not null
            and ${digestHasExactLength(table.previousHistorySha256)}
            and ${table.previousStatus} is not null
            and ${table.previousStatus} in (
              'ready', 'withdrawn', 'superseded', 'quarantined'
            )
            and ${table.previousStatus} <> ${table.status}
            and (
              (${table.status} = 'ready' and ${table.reasonSha256} is null)
              or
              (${table.status} <> 'ready'
                and ${table.reasonSha256} is not null
                and ${digestHasExactLength(table.reasonSha256)})
            ))
        )`,
    ),
    check(
      "fx_framework_availability_history_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
        )}`,
    ),
  ],
);

export const fxSystemFrameworkSchemaAvailabilityHeads = pgTable(
  "fx_system_framework_schema_availability_head",
  {
    installationStorageId: bigint("installation_storage_id", {
      mode: "bigint",
    }).notNull(),
    readinessStorageId: bigint("readiness_storage_id", {
      mode: "bigint",
    }).notNull(),
    availabilityHistoryStorageId: bigint(
      "availability_history_storage_id",
      { mode: "bigint" },
    ).notNull(),
    availabilitySequence: bigint("availability_sequence", { mode: "bigint" })
      .notNull(),
    status: frameworkMetadataCollatedText("status")
      .$type<FrameworkSchemaAvailabilityStatus>()
      .notNull(),
    historySha256: bytea("history_sha256").notNull(),
    availabilityHeadSha256: bytea("availability_head_sha256").notNull(),
    frameFormat: frameworkMetadataCollatedText("frame_format")
      .$type<typeof FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT>()
      .notNull(),
    frameVersion: integer("frame_version")
      .$type<typeof FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION>()
      .notNull(),
    canonicalByteLength: integer("canonical_byte_length").notNull(),
    canonicalBytes: bytea("canonical_bytes").notNull(),
  },
  table => [
    primaryKey({
      name: "fx_framework_availability_head_pk",
      columns: [table.installationStorageId],
    }),
    foreignKey({
      name: "fx_framework_availability_head_readiness_fk",
      columns: [table.readinessStorageId, table.installationStorageId],
      foreignColumns: [
        fxSystemFrameworkSchemaReadiness.readinessStorageId,
        fxSystemFrameworkSchemaReadiness.installationStorageId,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_framework_availability_head_history_fk",
      columns: [
        table.availabilityHistoryStorageId,
        table.installationStorageId,
        table.readinessStorageId,
        table.availabilitySequence,
        table.status,
        table.historySha256,
      ],
      foreignColumns: [
        fxSystemFrameworkSchemaAvailabilityHistory
          .availabilityHistoryStorageId,
        fxSystemFrameworkSchemaAvailabilityHistory.installationStorageId,
        fxSystemFrameworkSchemaAvailabilityHistory.readinessStorageId,
        fxSystemFrameworkSchemaAvailabilityHistory.availabilitySequence,
        fxSystemFrameworkSchemaAvailabilityHistory.status,
        fxSystemFrameworkSchemaAvailabilityHistory.historySha256,
      ],
    }).onUpdate("restrict").onDelete("restrict"),
    check(
      "fx_framework_availability_head_identity_check",
      sql`${table.availabilitySequence} between 1 and ${sql.raw(MAX_INT64)}
        and ${table.status} in (
          'ready', 'withdrawn', 'superseded', 'quarantined'
        )
        and ${digestHasExactLength(table.historySha256)}
        and ${digestHasExactLength(table.availabilityHeadSha256)}`,
    ),
    check(
      "fx_framework_availability_head_frame_check",
      sql`${table.frameFormat} = ${sql.raw(
        `'${FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT}'`,
      )}
        and ${table.frameVersion} = ${sql.raw(
          String(FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION),
        )}
        and ${canonicalBytesMatch(
          table.canonicalByteLength,
          table.canonicalBytes,
          MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
        )}`,
    ),
  ],
);
