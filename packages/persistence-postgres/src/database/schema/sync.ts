import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { ExecutionIdentity } from "flarex-protocol/auth";

export const freshnessProcessedEvents = pgTable(
  "freshness_processed_events",
  {
    deploymentId: text("deployment_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts, table.sequence],
    }),
  ],
);

export const documentFreshnessVersions = pgTable(
  "document_freshness_versions",
  {
    deploymentId: text("deployment_id").notNull(),
    documentId: text("document_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    outboxTs: bigint("outbox_ts", { mode: "number" }).notNull(),
    outboxSequence: bigint("outbox_sequence", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.documentId],
    }),
  ],
);

export const tableFreshnessVersions = pgTable(
  "table_freshness_versions",
  {
    deploymentId: text("deployment_id").notNull(),
    tableId: bigint("table_id", { mode: "number" }).notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    outboxTs: bigint("outbox_ts", { mode: "number" }).notNull(),
    outboxSequence: bigint("outbox_sequence", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.tableId],
    }),
  ],
);

export const liveQuerySubscriptions = pgTable(
  "live_query_subscriptions",
  {
    deploymentId: text("deployment_id").notNull(),
    connectionId: text("connection_id").notNull(),
    queryId: bigint("query_id", { mode: "number" }).notNull(),
    functionPath: text("function_path").notNull(),
    argsJson: jsonb("args_json").$type<unknown>().notNull(),
    identityJson: jsonb("identity_json")
      .$type<ExecutionIdentity>()
      .notNull()
      .default({ kind: "anonymous" }),
    partitionKey: text("partition_key"),
    beginTs: bigint("begin_ts", { mode: "number" }).notNull(),
    readSetJson: jsonb("read_set_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    resultJson: jsonb("result_json").$type<unknown>().notNull(),
    resultHash: text("result_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.connectionId, table.queryId],
    }),
    index("live_query_subscriptions_by_deployment_updated").on(
      table.deploymentId,
      table.updatedAt,
      table.connectionId,
      table.queryId,
    ),
    index("live_query_subscriptions_by_connection").on(
      table.deploymentId,
      table.connectionId,
      table.queryId,
    ),
  ],
);

export const liveQueryConnections = pgTable(
  "live_query_connections",
  {
    deploymentId: text("deployment_id").notNull(),
    connectionId: text("connection_id").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.connectionId],
    }),
    index("live_query_connections_by_expiry").on(
      table.deploymentId,
      table.expiresAt,
      table.connectionId,
    ),
  ],
);

export const liveQueryDeliveries = pgTable(
  "live_query_deliveries",
  {
    deploymentId: text("deployment_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    connectionId: text("connection_id").notNull(),
    queryId: bigint("query_id", { mode: "number" }).notNull(),
    payloadJson: jsonb("payload_json").$type<unknown>().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    claimOwner: text("claim_owner"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    lastErrorStage: text("last_error_stage"),
    lastError: text("last_error"),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    deadLetterReason: text("dead_letter_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.deliveryId],
    }),
    index("live_query_deliveries_by_undelivered").on(
      table.deploymentId,
      table.deliveredAt,
      table.deadLetteredAt,
      table.claimExpiresAt,
      table.createdAt,
      table.deliveryId,
    ),
    index("live_query_deliveries_by_connection").on(
      table.deploymentId,
      table.connectionId,
      table.queryId,
      table.createdAt,
      table.deliveryId,
    ),
  ],
);
