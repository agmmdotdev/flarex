import { bigint, boolean, index, pgSchema, primaryKey, text } from "drizzle-orm/pg-core";
import { bytea } from "./primitives";

/**
 * Convex PostgreSQL multitenant layout, translated from
 * db914cf06:crates/postgres/src/sql.rs. The namespace belongs to one physical
 * installation; instance_name partitions logical app persistence within it.
 * This declaration never installs or alters the legacy public-schema tables.
 */
export function defineCorePersistenceSchema(namespace: string) {
  const schema = pgSchema(namespace);
  const documents = schema.table("documents", {
    instanceName: text("instance_name").notNull(),
    id: bytea("id").notNull(),
    ts: bigint("ts", { mode: "bigint" }).notNull(),
    tableId: bytea("table_id").notNull(),
    jsonValue: bytea("json_value").notNull(),
    deleted: boolean("deleted").default(false),
    prevTs: bigint("prev_ts", { mode: "bigint" }),
  }, table => [
    primaryKey({ columns: [table.instanceName, table.ts, table.tableId, table.id] }),
    index("documents_by_table_and_id").on(table.instanceName, table.tableId, table.id, table.ts),
    index("documents_by_table_ts_and_id").on(table.instanceName, table.tableId, table.ts, table.id),
  ]);
  const indexes = schema.table("indexes", {
    instanceName: text("instance_name").notNull(),
    indexId: bytea("index_id").notNull(),
    ts: bigint("ts", { mode: "bigint" }).notNull(),
    keyPrefix: bytea("key_prefix").notNull(),
    keySuffix: bytea("key_suffix"),
    keySha256: bytea("key_sha256").notNull(),
    deleted: boolean("deleted"),
    tableId: bytea("table_id"),
    documentId: bytea("document_id"),
  }, table => [
    primaryKey({ columns: [table.instanceName, table.indexId, table.keySha256, table.ts] }),
    index("indexes_by_index_id_key_prefix_key_sha256_ts").on(
      table.instanceName, table.indexId, table.keyPrefix, table.keySha256, table.ts,
    ),
  ]);
  const leases = schema.table("leases", {
    instanceName: text("instance_name").primaryKey(),
    ts: bigint("ts", { mode: "bigint" }).notNull(),
  });
  const readOnly = schema.table("read_only", {
    instanceName: text("instance_name").primaryKey(),
  });
  const persistenceGlobals = schema.table("persistence_globals", {
    instanceName: text("instance_name").notNull(),
    key: text("key").notNull(),
    jsonValue: bytea("json_value").notNull(),
  }, table => [primaryKey({ columns: [table.instanceName, table.key] })]);
  return Object.freeze({ namespace: schema, documents, indexes, leases, readOnly, persistenceGlobals });
}

export const corePersistenceSchema = defineCorePersistenceSchema("flarex_core");
