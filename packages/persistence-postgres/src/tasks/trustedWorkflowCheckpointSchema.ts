import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES, type TaskRunIdV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { fxSystemDurableTaskRunsV1, fxSystemTrustedWorkflowTaskBindings } from "../database/schema/taskRuns";
import { bytea } from "../database/schema/primitives";

/** Framework-owned checkpoint bytes. Task owns CAS and live execution fencing,
 * not the framework's interpreter, checkpoint codec or business graph. */
export const fxSystemTrustedWorkflowCheckpoints = pgTable("fx_system_trusted_workflow_checkpoint", {
  scopeId: text("scope_id").$type<ScopeId>().notNull(),
  runId: text("run_id").$type<TaskRunIdV1>().notNull(),
  bindingSha256: bytea("binding_sha256").notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull(),
  codec: text("codec").notNull(),
  byteLength: integer("byte_length").notNull(),
  sha256: bytea("sha256").notNull(),
  bytes: bytea("bytes").notNull(),
}, table => [
  primaryKey({ name: "fx_workflow_checkpoint_pk", columns: [table.scopeId, table.runId] }),
  foreignKey({ name: "fx_workflow_checkpoint_run_fk", columns: [table.scopeId, table.runId],
    foreignColumns: [fxSystemDurableTaskRunsV1.scopeId, fxSystemDurableTaskRunsV1.runId] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "fx_workflow_checkpoint_binding_fk", columns: [table.scopeId, table.bindingSha256],
    foreignColumns: [fxSystemTrustedWorkflowTaskBindings.scopeId, fxSystemTrustedWorkflowTaskBindings.bindingSha256] }).onDelete("restrict").onUpdate("restrict"),
  check("fx_workflow_checkpoint_values_check", sql`${table.revision} > 0
    and ${table.codec} ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
    and ${table.byteLength} between 1 and ${sql.raw(String(MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES))}
    and octet_length(${table.bytes}) = ${table.byteLength}
    and octet_length(${table.sha256}) = 32 and octet_length(${table.bindingSha256}) = 32`),
]);
