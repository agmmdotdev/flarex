import { sql } from "drizzle-orm";
import { bigint, boolean, check, doublePrecision, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { Schema } from "effect";
import type { Document, Field, NumericIndex } from "./definition.ts";

/** One shared logical layout per installation; never a table per tenant. */
export const core = pgSchema("fx_core");
export const installation = core.table("installation", {
  singleton: boolean().primaryKey().default(true), active: boolean().notNull().default(true),
  readLock: boolean().notNull().default(false),
}, table => [check("installation_singleton", sql`${table.singleton}`)]);
export const authorities = core.table("authorities", {
  scope: text().primaryKey(), fence: bigint({ mode: "number" }).notNull().default(1), enabled: boolean().notNull().default(true),
  retainedFrom: bigint({ mode: "number" }).notNull().default(0),
  readLock: boolean().notNull().default(false),
});
export const grants = core.table("grants", {
  scope: text().notNull().references(() => authorities.scope), principal: text().notNull(),
  readLock: boolean().notNull().default(false),
}, table => [primaryKey({ columns: [table.scope, table.principal] })]);
export const clocks = core.table("clocks", {
  scope: text().primaryKey().references(() => authorities.scope), seq: bigint({ mode: "number" }).notNull().default(0),
});
export const definitions = core.table("definitions", {
  table: text().primaryKey(), version: text().notNull(), fields: jsonb().$type<readonly Field[]>().notNull(),
  tableId: integer().unique(),
  indexes: jsonb().$type<readonly NumericIndex[]>().notNull().default([]),
  readLock: boolean().notNull().default(false),
});
export const commands = core.table("commands", {
  id: text().primaryKey(), scope: text().notNull().references(() => authorities.scope), request: text().notNull(),
  digest: text().notNull(), definitions: jsonb().$type<readonly { table: string; version: string }[]>().notNull(),
  token: text().notNull(), fence: bigint({ mode: "number" }).notNull(), snapshot: bigint({ mode: "number" }).notNull(),
  expires: timestamp({ withTimezone: true, mode: "date" }).notNull(), status: text({ enum: ["active", "aborted", "committed"] }).notNull(),
  profile: text({ enum: ["framework", "application", "mixed"] }).notNull().default("framework"),
  result: jsonb().$type<Schema.Json>(), commitSeq: bigint({ mode: "number" }),
}, table => [unique("command_request").on(table.scope, table.request),
  check("command_status", sql`${table.status} in ('active','aborted','committed')`)]);
export const documents = core.table("documents", {
  scope: text().notNull(), table: text().notNull(), id: text().notNull(),
  body: jsonb().$type<Document>().notNull(), commitSeq: bigint({ mode: "number" }).notNull(),
}, table => [primaryKey({ columns: [table.scope, table.table, table.id] })]);
export const uniqueClaims = core.table("unique_claims", {
  scope: text().notNull(), table: text().notNull(), field: text().notNull(), key: text().notNull(),
  owner: text().notNull(), commitSeq: bigint({ mode: "number" }).notNull(),
}, table => [primaryKey({ name: "unique_claim", columns: [table.scope, table.table, table.field, table.key] }),
  foreignKey({ columns: [table.scope, table.table, table.owner], foreignColumns: [documents.scope, documents.table, documents.id] })]);
export const history = core.table("history", {
  scope: text().notNull(), table: text().notNull(), id: text().notNull(),
  commitSeq: bigint({ mode: "number" }).notNull(), body: jsonb().$type<Document>(),
}, table => [primaryKey({ columns: [table.scope, table.table, table.id, table.commitSeq] }),
  index("history_conflicts").on(table.scope, table.table, table.commitSeq, table.id)]);
export const indexVersions = core.table("index_versions", {
  scope: text().notNull(), table: text().notNull(), index: text().notNull(), id: text().notNull(),
  key: doublePrecision().notNull(), creationTime: doublePrecision().notNull(), fromSeq: bigint({ mode: "number" }).notNull(), untilSeq: bigint({ mode: "number" }),
}, table => [primaryKey({ columns: [table.scope, table.table, table.index, table.id, table.fromSeq] }),
  index("index_selection").on(table.scope, table.table, table.index, table.key, table.creationTime, table.id, table.fromSeq),
  index("index_invalidations").on(table.scope, table.table, table.index, table.fromSeq, table.untilSeq),
  foreignKey({ columns: [table.scope, table.table, table.id, table.fromSeq], foreignColumns: [history.scope, history.table, history.id, history.commitSeq] })]);
export const eventIntents = core.table("event_intents", {
  command: text().notNull().references(() => commands.id), ordinal: integer().notNull(), table: text().notNull(),
  document: text().notNull(), event: text().notNull(), body: jsonb().$type<Schema.Json>(),
}, table => [primaryKey({ columns: [table.command, table.ordinal] })]);
