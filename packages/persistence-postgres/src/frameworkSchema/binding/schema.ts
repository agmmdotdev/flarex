import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";
import { bytea, fxSystemScopeClocks } from "../../schema";
import { frameworkMetadataCollatedText as text } from "../privateMetadataSchemaSupport";
import {
  fxSystemFrameworkSchemaInstallations as installations,
  fxSystemFrameworkSchemaReadiness as readiness,
  fxSystemFrameworkSchemaAvailabilityHistory as availability,
} from "../installation/schema";
import { MAX_BINDING_BYTES, type PhysicalBindingSlot } from "./model";

const scopeColumns = () => ({
  scopeId: text("scope_id").notNull(),
  storageGeneration: text("storage_generation").notNull(),
});
const canonicalColumns = () => ({
  sha256: text("sha256").notNull(),
  canonicalBytes: bytea("canonical_bytes").notNull(),
  canonicalByteLength: integer("canonical_byte_length").notNull(),
});

export const fxSystemDataBindingCandidates = pgTable(
  "fx_system_data_binding_candidate",
  {
    ...scopeColumns(),
    ...canonicalColumns(),
  },
  (table) => [
    primaryKey({
      name: "fx_data_binding_candidate_pk",
      columns: [table.scopeId, table.storageGeneration, table.sha256],
    }),
    foreignKey({
      name: "fx_data_binding_candidate_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }),
    check(
      "fx_data_binding_candidate_digest",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "fx_data_binding_candidate_bytes",
      sql`${table.canonicalByteLength} between 1 and ${sql.raw(String(MAX_BINDING_BYTES))} and octet_length(${table.canonicalBytes}) = ${table.canonicalByteLength}`,
    ),
    check(
      "fx_data_binding_candidate_generation",
      sql`${table.storageGeneration} = 'flarexdb_v1'`,
    ),
  ],
);

export const fxSystemDataBindingPhysicalLanes = pgTable(
  "fx_system_data_binding_physical_lane",
  {
    ...scopeColumns(),
    candidateSha256: text("candidate_sha256").notNull(),
    slot: text("slot").$type<PhysicalBindingSlot>().notNull(),
    installationStorageId: bigint("installation_storage_id", {
      mode: "bigint",
    }).notNull(),
    installationSha256: bytea("installation_sha256").notNull(),
    installationReceiptSha256: bytea("installation_receipt_sha256").notNull(),
    readinessStorageId: bigint("readiness_storage_id", {
      mode: "bigint",
    }).notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    availabilityHistoryStorageId: bigint("availability_history_storage_id", {
      mode: "bigint",
    }).notNull(),
    availabilitySequence: bigint("availability_sequence", {
      mode: "bigint",
    }).notNull(),
    availabilityStatus: text("availability_status").$type<"ready">().notNull(),
    availabilityHistorySha256: bytea("availability_history_sha256").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_data_binding_lane_pk",
      columns: [
        table.scopeId,
        table.storageGeneration,
        table.candidateSha256,
        table.slot,
      ],
    }),
    foreignKey({
      name: "fx_data_binding_lane_candidate_fk",
      columns: [table.scopeId, table.storageGeneration, table.candidateSha256],
      foreignColumns: [
        fxSystemDataBindingCandidates.scopeId,
        fxSystemDataBindingCandidates.storageGeneration,
        fxSystemDataBindingCandidates.sha256,
      ],
    }),
    foreignKey({
      name: "fx_data_binding_lane_installation_fk",
      columns: [
        table.installationStorageId,
        table.installationSha256,
        table.installationReceiptSha256,
      ],
      foreignColumns: [
        installations.installationStorageId,
        installations.installationSha256,
        installations.installationReceiptSha256,
      ],
    }),
    foreignKey({
      name: "fx_data_binding_lane_readiness_fk",
      columns: [
        table.readinessStorageId,
        table.installationStorageId,
        table.readinessSha256,
      ],
      foreignColumns: [
        readiness.readinessStorageId,
        readiness.installationStorageId,
        readiness.readinessSha256,
      ],
    }),
    foreignKey({
      name: "fx_data_binding_lane_availability_fk",
      columns: [
        table.availabilityHistoryStorageId,
        table.installationStorageId,
        table.readinessStorageId,
        table.availabilitySequence,
        table.availabilityStatus,
        table.availabilityHistorySha256,
      ],
      foreignColumns: [
        availability.availabilityHistoryStorageId,
        availability.installationStorageId,
        availability.readinessStorageId,
        availability.availabilitySequence,
        availability.status,
        availability.historySha256,
      ],
    }),
    check(
      "fx_data_binding_lane_slot",
      sql`${table.slot} in ('payloadLifecycle', 'commerce')`,
    ),
    check(
      "fx_data_binding_lane_ready",
      sql`${table.availabilityStatus} = 'ready'`,
    ),
  ],
);

export const fxSystemDataBindingActivations = pgTable(
  "fx_system_data_binding_activation",
  {
    ...scopeColumns(),
    ...canonicalColumns(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    requestId: text("request_id").notNull(),
    candidateSha256: text("candidate_sha256").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_data_binding_activation_pk",
      columns: [table.scopeId, table.storageGeneration, table.sequence],
    }),
    unique("fx_data_binding_activation_request").on(
      table.scopeId,
      table.requestId,
    ),
    unique("fx_data_binding_activation_reference").on(
      table.scopeId,
      table.storageGeneration,
      table.sequence,
      table.sha256,
      table.candidateSha256,
    ),
    foreignKey({
      name: "fx_data_binding_activation_candidate_fk",
      columns: [table.scopeId, table.storageGeneration, table.candidateSha256],
      foreignColumns: [
        fxSystemDataBindingCandidates.scopeId,
        fxSystemDataBindingCandidates.storageGeneration,
        fxSystemDataBindingCandidates.sha256,
      ],
    }),
    check(
      "fx_data_binding_activation_digest",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("fx_data_binding_activation_sequence", sql`${table.sequence} > 0`),
    check(
      "fx_data_binding_activation_request_id",
      sql`octet_length(${table.requestId}) between 1 and 512`,
    ),
    check(
      "fx_data_binding_activation_bytes",
      sql`${table.canonicalByteLength} between 1 and ${sql.raw(String(MAX_BINDING_BYTES))} and octet_length(${table.canonicalBytes}) = ${table.canonicalByteLength}`,
    ),
  ],
);

export const fxSystemDataBindingHeads = pgTable(
  "fx_system_data_binding_head",
  {
    ...scopeColumns(),
    ...canonicalColumns(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    activationSha256: text("activation_sha256").notNull(),
    candidateSha256: text("candidate_sha256").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_data_binding_head_pk",
      columns: [table.scopeId, table.storageGeneration],
    }),
    foreignKey({
      name: "fx_data_binding_head_activation_fk",
      columns: [
        table.scopeId,
        table.storageGeneration,
        table.sequence,
        table.activationSha256,
        table.candidateSha256,
      ],
      foreignColumns: [
        fxSystemDataBindingActivations.scopeId,
        fxSystemDataBindingActivations.storageGeneration,
        fxSystemDataBindingActivations.sequence,
        fxSystemDataBindingActivations.sha256,
        fxSystemDataBindingActivations.candidateSha256,
      ],
    }),
    check(
      "fx_data_binding_head_digest",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "fx_data_binding_head_bytes",
      sql`${table.canonicalByteLength} between 1 and ${sql.raw(String(MAX_BINDING_BYTES))} and octet_length(${table.canonicalBytes}) = ${table.canonicalByteLength}`,
    ),
  ],
);
