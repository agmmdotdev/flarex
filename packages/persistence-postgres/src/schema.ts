import {
  bigint,
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const bytea = customType<{
  data: Uint8Array;
  driverData: Uint8Array;
}>({
  dataType() {
    return "bytea";
  },
});

export const deployments = pgTable("deployments", {
  deploymentId: text("deployment_id").primaryKey(),
  projectId: text("project_id").notNull(),
  activePackageId: text("active_package_id"),
  activeSchemaVersion: bigint("active_schema_version", { mode: "number" })
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable(
  "documents",
  {
    deploymentId: text("deployment_id").notNull(),
    id: bytea("id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    tableId: bytea("table_id").notNull(),
    jsonValue: bytea("json_value").notNull(),
    deleted: boolean("deleted").notNull().default(false),
    prevTs: bigint("prev_ts", { mode: "number" }),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts, table.tableId, table.id],
    }),
    index("documents_by_table_and_id").on(
      table.deploymentId,
      table.tableId,
      table.id,
      table.ts,
    ),
    index("documents_by_table_ts_and_id").on(
      table.deploymentId,
      table.tableId,
      table.ts,
      table.id,
    ),
  ],
);

export const indexes = pgTable(
  "indexes",
  {
    deploymentId: text("deployment_id").notNull(),
    indexId: bytea("index_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    keyPrefix: bytea("key_prefix").notNull(),
    keySuffix: bytea("key_suffix"),
    keySha256: bytea("key_sha256").notNull(),
    deleted: boolean("deleted"),
    tableId: bytea("table_id"),
    documentId: bytea("document_id"),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.indexId, table.keySha256, table.ts],
    }),
    index("indexes_by_index_id_key_prefix_key_sha256").on(
      table.deploymentId,
      table.indexId,
      table.keyPrefix,
      table.keySha256,
    ),
  ],
);

export const leases = pgTable("leases", {
  deploymentId: text("deployment_id").primaryKey(),
  ts: bigint("ts", { mode: "number" }).notNull(),
});

export const readOnly = pgTable("read_only", {
  deploymentId: text("deployment_id").primaryKey(),
});

export const persistenceGlobals = pgTable(
  "persistence_globals",
  {
    deploymentId: text("deployment_id").notNull(),
    key: text("key").notNull(),
    jsonValue: bytea("json_value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.key],
    }),
  ],
);

export const commits = pgTable(
  "commits",
  {
    deploymentId: text("deployment_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    writeSummary: jsonb("write_summary")
      .$type<Record<string, unknown>>()
      .notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts],
    }),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    deploymentId: text("deployment_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts, table.sequence],
    }),
  ],
);

export const flarexSchema = {
  commits,
  deployments,
  documents,
  indexes,
  leases,
  outbox,
  persistenceGlobals,
  readOnly,
};
