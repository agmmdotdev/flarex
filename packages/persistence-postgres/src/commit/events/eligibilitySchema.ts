import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../database/schema/scope";
import { fxSystemCommits } from "../../database/schema/commitHeaders";

/** Mutable delivery eligibility only; committed intents, history and facts never change. */
export const fxSystemCommitEventEligibilityGroups = pgTable("fx_system_commit_event_eligibility_group", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
  groupId: text("group_id").notNull(),
  ownerIdentity: text("owner_identity").notNull(),
  policyRevision: text("policy_revision").notNull(),
  maximumCommits: integer("maximum_commits").notNull(),
  memberCount: integer("member_count").notNull().default(0),
  state: text("state").$type<"held" | "released" | "cleared">().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, table => [
  primaryKey({ name: "fx_event_eligibility_group_pk", columns: [table.scopeUuid, table.epochUuid, table.groupId] }),
  foreignKey({ name: "fx_event_eligibility_scope_fk", columns: [table.scopeUuid], foreignColumns: [fxSystemScopeClocks.scopeUuid] }).onDelete("restrict").onUpdate("restrict"),
  check("fx_event_eligibility_values_check", sql`${table.groupId} ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
    and ${table.ownerIdentity} ~ '^[0-9a-f]{64}$' and ${table.policyRevision} ~ '^[0-9a-f]{64}$'
    and ${table.maximumCommits} between 1 and 16 and ${table.memberCount} between 0 and ${table.maximumCommits}
    and ((${table.state} = 'held' and ${table.decidedAt} is null)
      or (${table.state} in ('released', 'cleared') and ${table.decidedAt} is not null and isfinite(${table.decidedAt})))`),
]);

/** Immutable membership, corroborated by the existing committed-envelope digest. */
export const fxSystemCommitEventEligibilityMembers = pgTable("fx_system_commit_event_eligibility_member", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
  commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  groupId: text("group_id").notNull(),
}, table => [
  index("fx_event_eligibility_group_members_idx").on(table.scopeUuid, table.epochUuid, table.groupId, table.commitSeq),
  primaryKey({ name: "fx_event_eligibility_member_pk", columns: [table.scopeUuid, table.epochUuid, table.commitSeq, table.groupId] }),
  foreignKey({ name: "fx_event_eligibility_member_group_fk", columns: [table.scopeUuid, table.epochUuid, table.groupId],
    foreignColumns: [fxSystemCommitEventEligibilityGroups.scopeUuid, fxSystemCommitEventEligibilityGroups.epochUuid, fxSystemCommitEventEligibilityGroups.groupId] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "fx_event_eligibility_member_commit_fk", columns: [table.scopeUuid, table.epochUuid, table.commitSeq],
    foreignColumns: [fxSystemCommits.scopeUuid, fxSystemCommits.epochUuid, fxSystemCommits.commitSeq] }).onDelete("restrict").onUpdate("restrict"),
]);
