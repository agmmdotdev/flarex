import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { LogicalMetadataKey, MetadataSequence } from "flarex-protocol/commit-protocol";
import type {
  CommitSeq,
  ScopeEpoch,
  ScopeEpochUuidV1,
  ScopeId,
  ScopeUuidV1,
  StorageGeneration,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionAuthorizationRevocationEpoch } from "flarex-protocol/transaction-session";
import { bytea, nonBlankText } from "./primitives";

/** Stable identity/FK root and exclusive commit/metadata sequencer. */
export const fxSystemScopeClocks = pgTable(
  "fx_system_scope_clock",
  {
    scopeId: text("scope_id").$type<ScopeId>().primaryKey(),
    scopeUuid: uuid("scope_uuid")
      .$type<ScopeUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      `),
    lastCommitSeq: bigint("last_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull()
      .default(sql`0`),
    lastMetadataSequence: bigint("last_metadata_sequence", { mode: "bigint" })
      .$type<MetadataSequence>().notNull().default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("fx_system_scope_clock_scope_uuid_unique").on(table.scopeUuid),
    check("fx_system_scope_clock_scope_id_non_empty_check", nonBlankText(table.scopeId)),
    check("fx_system_scope_clock_last_commit_seq_non_negative_check", sql`${table.lastCommitSeq} >= 0`),
    check("fx_system_scope_clock_last_metadata_sequence_non_negative_check", sql`${table.lastMetadataSequence} >= 0`),
  ],
);

/** One live lifecycle authority; finite reads share this row, never the sequencer. */
export const fxSystemScopeExecutionAuthorities = pgTable(
  "fx_system_scope_execution_authority",
  {
    scopeId: text("scope_id").$type<ScopeId>().primaryKey(),
    storageGeneration: text("storage_generation")
      .$type<StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    })
      .$type<StorageGenerationFence>()
      .notNull()
      .default(sql`1`),
    oldestAvailableCommitSeq: bigint("oldest_available_commit_seq", {
      mode: "bigint",
    })
      .$type<CommitSeq>()
      .notNull()
      .default(sql`0`),
    authorizationRevocationEpoch: bigint("authorization_revocation_epoch", {
      mode: "bigint",
    })
      .$type<TransactionAuthorizationRevocationEpoch>()
      .notNull()
      .default(sql`0`),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    epochUuid: uuid("epoch_uuid")
      .$type<ScopeEpochUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "epoch" ~ '^epoch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("epoch" from 7)::uuid
          else null
        end
      `),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({ name: "fx_scope_execution_authority_scope_fk", columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId] }).onDelete("restrict").onUpdate("restrict"),
    check("fx_scope_execution_authority_generation_check", sql`${table.storageGeneration} in ('legacy_v1', 'flarexdb_v1')`),
    check("fx_scope_execution_authority_fence_check", sql`${table.storageGenerationFence} >= 1`),
    check("fx_scope_execution_authority_floor_check", sql`${table.oldestAvailableCommitSeq} >= 0`),
    check("fx_scope_execution_authority_revocation_check", sql`${table.authorizationRevocationEpoch} >= 0`),
    check("fx_scope_execution_authority_epoch_check", nonBlankText(table.epoch)),
  ],
);

/** Tombstones retain semantic changes, including remove/readd ABA observations. */
export const fxSystemMetadataContractObservations = pgTable(
  "fx_system_metadata_contract_observation",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    namespace: text("namespace").$type<LogicalMetadataKey["namespace"]>().notNull(),
    ownerKey: text("owner_key").notNull(),
    contractKey: text("contract_key").notNull(),
    semanticSha256Hex: text("semantic_sha256_hex"),
    semanticBytes: bytea("semantic_bytes"),
    present: boolean("present").notNull(),
    lastChangedMetadataSequence: bigint("last_changed_metadata_sequence", { mode: "bigint" })
      .$type<MetadataSequence>().notNull(),
  },
  table => [
    primaryKey({ columns: [table.scopeId, table.namespace, table.ownerKey, table.contractKey] }),
    foreignKey({ name: "fx_metadata_contract_scope_fk", columns: [table.scopeId], foreignColumns: [fxSystemScopeClocks.scopeId] })
      .onDelete("restrict").onUpdate("restrict"),
    check("fx_metadata_contract_namespace_check", sql`${table.namespace} in ('application', 'binding', 'execution')`),
    check("fx_metadata_contract_owner_check", nonBlankText(table.ownerKey)),
    check("fx_metadata_contract_key_check", nonBlankText(table.contractKey)),
    check("fx_metadata_contract_sequence_check", sql`${table.lastChangedMetadataSequence} > 0`),
    check("fx_metadata_contract_digest_check", sql`(${table.present} = (${table.semanticSha256Hex} is not null))
      and (${table.semanticSha256Hex} is null or ${table.semanticSha256Hex} ~ '^[0-9a-f]{64}$')`),
    check("fx_metadata_contract_semantic_bytes_check", sql`${table.semanticBytes} is null or
      (${table.present} and octet_length(${table.semanticBytes}) between 1 and 4194304)`),
  ],
);
