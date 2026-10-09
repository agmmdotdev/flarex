import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** A separate structural maintenance barrier, never the metadata invalidation root. */
export const fxSystemInstallation = pgTable("fx_system_installation", {
  singletonId: integer("singleton_id").primaryKey(),
  databaseName: text("database_name").notNull(), schemaName: text("schema_name").notNull(),
  namespaceOid: bigint("namespace_oid", { mode: "bigint" }).notNull(), incarnation: uuid("incarnation").notNull(),
  structuralGeneration: bigint("structural_generation", { mode: "bigint" }).notNull(),
  state: text("state").notNull(), maintenanceOwner: uuid("maintenance_owner"),
  maintenancePid: integer("maintenance_pid"), maintenanceBackendStart: timestamp("maintenance_backend_start", { withTimezone: true }),
});

export const fxSystemInstallationRuntime = pgTable("fx_system_installation_runtime", {
  login: text("login").primaryKey(), loginOid: bigint("login_oid", { mode: "bigint" }).notNull(),
  endpointPolicy: text("endpoint_policy").notNull(), incarnation: uuid("incarnation").notNull(),
  structuralGeneration: bigint("structural_generation", { mode: "bigint" }).notNull(),
  metadataIncarnation: uuid("metadata_incarnation").notNull(),
  accessProfile: text("access_profile").$type<"dataRuntime" | "controlRead" | "activationWriter">().notNull().default("dataRuntime"),
}, table => [check("fx_system_installation_runtime_access_profile_check",
  sql`${table.accessProfile} in ('dataRuntime','controlRead','activationWriter')`)]);

/** One installation-wide immutable-metadata invalidation root. Only guarded
 * metadata statements advance it; ordinary business writes never touch it. */
export const fxSystemPreparedMetadataEpoch = pgTable(
  "fx_system_prepared_metadata_epoch",
  {
    singletonId: integer("singleton_id").primaryKey(),
    databaseName: text("database_name").notNull(),
    namespaceOid: bigint("namespace_oid", { mode: "bigint" }).notNull(),
    incarnation: uuid("incarnation").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
  },
  (table) => [
    check("fx_system_prepared_metadata_singleton_check", sql`${table.singletonId} = 1`),
    check("fx_system_prepared_metadata_generation_check", sql`${table.generation} >= 1`),
  ],
);
