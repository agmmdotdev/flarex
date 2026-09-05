import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { bytea } from "../schema";
import { fxSystemFrameworkSchemaInstallations, fxSystemFrameworkSchemaReadiness } from "../frameworkSchema/installation/schema";
import { fxSystemFrameworkMigrationPlans } from "./schema";

export const fxSystemFrameworkMigrationPlanBases = pgTable("fx_system_framework_migration_plan_base", {
  planStorageId: bigint("plan_storage_id", { mode: "bigint" }).notNull(),
  collisionStorageId: bigint("collision_storage_id", { mode: "bigint" }).notNull(),
  basePlanStorageId: bigint("base_plan_storage_id", { mode: "bigint" }).notNull(),
  installationStorageId: bigint("installation_storage_id", { mode: "bigint" }).notNull(),
  installationSha256: bytea("installation_sha256").notNull(),
  installationReceiptSha256: bytea("installation_receipt_sha256").notNull(),
  readinessStorageId: bigint("readiness_storage_id", { mode: "bigint" }).notNull(),
  readinessSha256: bytea("readiness_sha256").notNull(),
  physicalLayoutSha256: bytea("physical_layout_sha256").notNull(),
}, table => [
  primaryKey({ name: "fx_framework_migration_base_pk", columns: [table.planStorageId] }),
  foreignKey({ name: "fx_framework_migration_base_candidate_fk",
    columns: [table.planStorageId, table.collisionStorageId],
    foreignColumns: [fxSystemFrameworkMigrationPlans.planStorageId, fxSystemFrameworkMigrationPlans.collisionStorageId],
  }).onUpdate("restrict").onDelete("restrict"),
  foreignKey({ name: "fx_framework_migration_base_installation_fk",
    columns: [table.installationStorageId, table.installationSha256, table.installationReceiptSha256],
    foreignColumns: [fxSystemFrameworkSchemaInstallations.installationStorageId,
      fxSystemFrameworkSchemaInstallations.installationSha256, fxSystemFrameworkSchemaInstallations.installationReceiptSha256],
  }).onUpdate("restrict").onDelete("restrict"),
  foreignKey({ name: "fx_framework_migration_base_context_fk",
    columns: [table.installationStorageId, table.collisionStorageId, table.basePlanStorageId, table.physicalLayoutSha256],
    foreignColumns: [fxSystemFrameworkSchemaInstallations.installationStorageId,
      fxSystemFrameworkSchemaInstallations.collisionStorageId, fxSystemFrameworkSchemaInstallations.planStorageId,
      fxSystemFrameworkSchemaInstallations.installedStructureSha256],
  }).onUpdate("restrict").onDelete("restrict"),
  foreignKey({ name: "fx_framework_migration_base_readiness_fk",
    columns: [table.readinessStorageId, table.installationStorageId, table.readinessSha256],
    foreignColumns: [fxSystemFrameworkSchemaReadiness.readinessStorageId,
      fxSystemFrameworkSchemaReadiness.installationStorageId, fxSystemFrameworkSchemaReadiness.readinessSha256],
  }).onUpdate("restrict").onDelete("restrict"),
  check("fx_framework_migration_base_identity_check", sql`${table.planStorageId} <> ${table.basePlanStorageId}
    and octet_length(${table.installationSha256}) = 32
    and octet_length(${table.installationReceiptSha256}) = 32
    and octet_length(${table.readinessSha256}) = 32
    and octet_length(${table.physicalLayoutSha256}) = 32`),
]);
