import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, pgTable, primaryKey, text, unique } from "drizzle-orm/pg-core";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { fxSystemApplicationActivations } from "../applicationActivationSchema";
import { bytea } from "../schema";

/** Activation history owns retained claims; the active head selects its current projection. */
export const fxSystemApplicationWriteOwnership = pgTable("fx_system_application_write_ownership", {
  scopeId: text("scope_id").$type<ScopeId>().notNull(),
  activationSequence: bigint("activation_sequence", { mode: "bigint" }).notNull(),
  claimsSha256: bytea("claims_sha256").notNull(),
  claimsBytes: bytea("claims_bytes").notNull(),
}, table => [
  primaryKey({ columns: [table.scopeId, table.activationSequence] }),
  unique("fx_application_write_ownership_identity_unique").on(table.scopeId, table.activationSequence, table.claimsSha256),
  foreignKey({ name: "fx_application_write_ownership_activation_fk", columns: [table.scopeId, table.activationSequence],
    foreignColumns: [fxSystemApplicationActivations.scopeId, fxSystemApplicationActivations.activationSequence] }).onDelete("restrict"),
  check("fx_application_write_ownership_evidence_check", sql`${table.activationSequence} > 0
    and octet_length(${table.claimsSha256}) = 32 and octet_length(${table.claimsBytes}) between 1 and 1048576`),
]);
