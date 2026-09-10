import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { fxSystemCommits } from "../schema";
import type { CommittedEvent } from "./model";

/** Immutable intent; the header count witnesses the complete ordered family. */
export const fxSystemCommitEvents = pgTable("fx_system_commit_event", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
  commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  eventOrdinal: integer("event_ordinal").notNull(),
  envelope: jsonb("envelope").$type<CommittedEvent>().notNull(),
}, table => [
  primaryKey({ columns: [table.scopeUuid, table.epochUuid, table.commitSeq, table.eventOrdinal] }),
  foreignKey({ name: "fx_commit_event_header_fk", columns: [table.scopeUuid, table.epochUuid, table.commitSeq],
    foreignColumns: [fxSystemCommits.scopeUuid, fxSystemCommits.epochUuid, fxSystemCommits.commitSeq] }).onDelete("restrict").onUpdate("restrict"),
  check("fx_commit_event_values_check", sql`${table.eventOrdinal} between 0 and 63 and jsonb_typeof(${table.envelope}) = 'object' and octet_length(${table.envelope}::text) <= 131072`),
]);

/** Delivery evidence is a projection of an existing committed event, never an enqueue API. */
export const fxSystemCommitEventDeliveries = pgTable("fx_system_commit_event_delivery", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
  commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  eventOrdinal: integer("event_ordinal").notNull(),
  subscriberId: text("subscriber_id").notNull(),
  handlerRevision: text("handler_revision").notNull(),
  state: text("state").$type<"pending" | "claimed" | "delivered" | "failed">().notNull(),
  attempts: integer("attempts").notNull().default(0),
  fence: bigint("fence", { mode: "bigint" }).notNull().default(sql`0`),
  owner: text("owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  failureCode: text("failure_code"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
}, table => [
  primaryKey({ columns: [table.scopeUuid, table.epochUuid, table.commitSeq, table.eventOrdinal, table.subscriberId] }),
  foreignKey({ name: "fx_commit_event_delivery_event_fk", columns: [table.scopeUuid, table.epochUuid, table.commitSeq, table.eventOrdinal],
    foreignColumns: [fxSystemCommitEvents.scopeUuid, fxSystemCommitEvents.epochUuid, fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal] }).onDelete("restrict").onUpdate("restrict"),
  index("fx_commit_event_delivery_due_idx").on(table.scopeUuid, table.epochUuid, table.state, table.nextAttemptAt, table.commitSeq),
  check("fx_commit_event_delivery_values_check", sql`${table.subscriberId} ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
    and ${table.handlerRevision} ~ '^[0-9a-f]{64}$' and ${table.attempts} between 0 and 5 and ${table.fence} >= 0
    and ${table.state} in ('pending', 'claimed', 'delivered', 'failed')
    and isfinite(${table.nextAttemptAt}) and (${table.failureCode} is null or octet_length(${table.failureCode}) between 1 and 128)
    and ((${table.state} = 'claimed' and ${table.owner} is not null and octet_length(${table.owner}) between 1 and 128 and ${table.leaseExpiresAt} is not null and isfinite(${table.leaseExpiresAt}) and ${table.attempts} > 0)
      or (${table.state} <> 'claimed' and ${table.owner} is null and ${table.leaseExpiresAt} is null))
    and ((${table.state} in ('delivered', 'failed') and ${table.settledAt} is not null and isfinite(${table.settledAt}))
      or (${table.state} in ('pending', 'claimed') and ${table.settledAt} is null))`),
]);
