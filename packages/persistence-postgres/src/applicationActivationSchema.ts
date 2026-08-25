import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  fxSystemApplicationReadiness,
} from "./applicationRelationSchema";
import { bytea, fxSystemApplicationReadinessV1 } from "./schema";

/** Concrete persisted readiness contract selected by one Application activation. */
export type ApplicationActivationReadinessContractVersion = 1 | 2;

/**
 * The one Application activation history. The physical table is unversioned;
 * frame versions discriminate the two concrete readiness compatibility
 * contracts without creating another activation owner.
 */
export const fxSystemApplicationActivations = pgTable(
  "fx_system_application_activation",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    activationSequence: bigint("activation_sequence", { mode: "bigint" })
      .notNull(),
    previousActivationSequence: bigint("previous_activation_sequence", {
      mode: "bigint",
    }),
    revisionId: text("revision_id").notNull(),
    readinessContractVersion: integer("readiness_contract_version")
      .$type<ApplicationActivationReadinessContractVersion>()
      .notNull()
      .default(1),
    readinessSha256: bytea("readiness_sha256").notNull(),
    legacyReadinessSha256: bytea("legacy_readiness_sha256"),
    relationReadinessSha256: bytea("relation_readiness_sha256"),
    relationSetReadinessSha256: bytea("relation_set_readiness_sha256"),
    relationCount: integer("relation_count"),
    activationRequestSha256: bytea("activation_request_sha256").notNull(),
    activationSha256: bytea("activation_sha256").notNull(),
    activationBytes: bytea("activation_bytes").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_activation_pk",
      columns: [table.scopeId, table.activationSequence],
    }),
    unique("fx_application_activation_request_unique").on(
      table.scopeId,
      table.activationRequestSha256,
    ),
    unique("fx_application_activation_head_child_unique").on(
      table.scopeId,
      table.activationSequence,
      table.revisionId,
      table.readinessContractVersion,
      table.readinessSha256,
      table.activationSha256,
    ),
    foreignKey({
      name: "fx_application_activation_legacy_readiness_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.legacyReadinessSha256,
      ],
      foreignColumns: [
        fxSystemApplicationReadinessV1.scopeId,
        fxSystemApplicationReadinessV1.revisionId,
        fxSystemApplicationReadinessV1.readinessSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_activation_relation_readiness_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.relationReadinessSha256,
        table.relationSetReadinessSha256,
        table.relationCount,
      ],
      foreignColumns: [
        fxSystemApplicationReadiness.scopeId,
        fxSystemApplicationReadiness.revisionId,
        fxSystemApplicationReadiness.readinessSha256,
        fxSystemApplicationReadiness.relationSetReadinessSha256,
        fxSystemApplicationReadiness.relationCount,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_activation_identity_check",
      sql`${table.activationSequence} between 1 and 9223372036854775807
        and (${table.previousActivationSequence} is null or (
          ${table.previousActivationSequence} between 1 and 9223372036854775806
          and ${table.previousActivationSequence} < ${table.activationSequence}
        ))
        and ${nonBlankText(table.revisionId)}
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.activationRequestSha256}) = 32
        and octet_length(${table.activationSha256}) = 32
        and octet_length(${table.activationBytes}) between 1 and 1048576`,
    ),
    check(
      "fx_application_activation_readiness_contract_check",
      sql`(
        (${table.readinessContractVersion} = 1
          and ${table.legacyReadinessSha256} is not null
          and ${table.legacyReadinessSha256} = ${table.readinessSha256}
          and ${table.relationReadinessSha256} is null
          and ${table.relationSetReadinessSha256} is null
          and ${table.relationCount} is null)
        or (${table.readinessContractVersion} = 2
          and ${table.legacyReadinessSha256} is null
          and ${table.relationReadinessSha256} is not null
          and ${table.relationReadinessSha256} = ${table.readinessSha256}
          and ${table.relationSetReadinessSha256} is not null
          and octet_length(${table.relationSetReadinessSha256}) = 32
          and ${table.relationCount} is not null
          and ${table.relationCount} between 1 and 1024)
      )`,
    ),
    check(
      "fx_application_activation_time_check",
      sql`isfinite(${table.activatedAt})`,
    ),
  ],
);

/** One CAS-protected Application active head for both readiness contracts. */
export const fxSystemApplicationActiveHeads = pgTable(
  "fx_system_application_active_head",
  {
    scopeId: text("scope_id").$type<ScopeId>().primaryKey(),
    activationSequence: bigint("activation_sequence", { mode: "bigint" })
      .notNull(),
    revisionId: text("revision_id").notNull(),
    readinessContractVersion: integer("readiness_contract_version")
      .$type<ApplicationActivationReadinessContractVersion>()
      .notNull()
      .default(1),
    readinessSha256: bytea("readiness_sha256").notNull(),
    relationSetReadinessSha256: bytea("relation_set_readiness_sha256"),
    relationCount: integer("relation_count"),
    activationSha256: bytea("activation_sha256").notNull(),
    headSha256: bytea("head_sha256").notNull(),
    headBytes: bytea("head_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fx_application_active_head_activation_fk",
      columns: [
        table.scopeId,
        table.activationSequence,
        table.revisionId,
        table.readinessContractVersion,
        table.readinessSha256,
        table.activationSha256,
      ],
      foreignColumns: [
        fxSystemApplicationActivations.scopeId,
        fxSystemApplicationActivations.activationSequence,
        fxSystemApplicationActivations.revisionId,
        fxSystemApplicationActivations.readinessContractVersion,
        fxSystemApplicationActivations.readinessSha256,
        fxSystemApplicationActivations.activationSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_active_head_relation_readiness_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.readinessSha256,
        table.relationSetReadinessSha256,
        table.relationCount,
      ],
      foreignColumns: [
        fxSystemApplicationReadiness.scopeId,
        fxSystemApplicationReadiness.revisionId,
        fxSystemApplicationReadiness.readinessSha256,
        fxSystemApplicationReadiness.relationSetReadinessSha256,
        fxSystemApplicationReadiness.relationCount,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_active_head_identity_check",
      sql`${table.activationSequence} between 1 and 9223372036854775807
        and ${nonBlankText(table.revisionId)}
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.activationSha256}) = 32
        and octet_length(${table.headSha256}) = 32
        and octet_length(${table.headBytes}) between 1 and 1048576`,
    ),
    check(
      "fx_application_active_head_readiness_contract_check",
      sql`(
        (${table.readinessContractVersion} = 1
          and ${table.relationSetReadinessSha256} is null
          and ${table.relationCount} is null)
        or (${table.readinessContractVersion} = 2
          and ${table.relationSetReadinessSha256} is not null
          and octet_length(${table.relationSetReadinessSha256}) = 32
          and ${table.relationCount} is not null
          and ${table.relationCount} between 1 and 1024)
      )`,
    ),
    check(
      "fx_application_active_head_time_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

function nonBlankText(value: SQLWrapper) {
  return sql`btrim(${value}, U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff') <> ''`;
}
