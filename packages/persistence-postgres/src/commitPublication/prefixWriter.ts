import { sql } from "drizzle-orm";
import { Result } from "effect";
import type { AppRowTransaction } from "../appRows";
import { requireAdmittedTargetInstallationSchema } from "../installationLifecycle";
import { observeDrizzleQuery } from "../drizzleQueryObservation";
import type { Json } from "flarex-protocol/json";
import type { fxSystemTransactionSessions } from "../schema";
import { fxSystemCommitEventDeliveries } from "../commitEvents/schema";
import { projectScopePublicationContribution, projectScopePublicationRows, scopePublicationPrimitiveQuery,
  scopePublicationProcedureFailure } from "./prefixProjection";
import { ScopePublicationCorruptionError, ScopePublicationSqlFailure, type ScopePublicationContribution, type ScopePublicationKernel,
  type ScopePublicationOptions, type ScopePublicationSqlOperation, type ScopePublicationStep } from "./scopePublicationModel";

const invalid = () => new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid" });
function targetSchema(tx: AppRowTransaction): string {
  // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: transaction - existing native Promise publisher projects the owning admission failure into its outer rollback boundary.
  return Result.getOrThrow(requireAdmittedTargetInstallationSchema(tx));
}
async function submit(tx: AppRowTransaction, schemaName: string, functionName: string, input: Json | string,
  expected: number | boolean, operation: ScopePublicationSqlOperation, options: ScopePublicationOptions, verification?: Json) {
  const query = scopePublicationPrimitiveQuery(tx, schemaName, functionName, input, verification);
  observeDrizzleQuery(operation, query, options.observeQuery);
  let rows;
  try { rows = await query; }
  catch (cause) { throw scopePublicationProcedureFailure(cause) ?? new ScopePublicationSqlFailure({ operation, cause }); }
  if (rows.length !== 1 || rows[0]?.accepted !== expected) throw invalid();
}
async function step(options: ScopePublicationOptions, command: ScopePublicationContribution, value: ScopePublicationStep) {
  await options.afterTransactionStep?.(Object.freeze({ scopeId: command.authorityPins.scopeId, step: value }));
}
function detail(options: ScopePublicationOptions, owner:
  "commitHeaders" | "rowFacts" | "relationFacts" | "relationalFacts" | "events" | "deliveries" | "outcomes" | "wakes", rows: number,
  resultBytes?: number) {
  if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner,
    counts: { rows, ...(resultBytes === undefined ? {} : { resultBytes }) } });
}

/** Transaction-local proof of the originally submitted bounded contribution.
 * Lifecycle owners may recheck it after their later, distinct durable writes. */
export interface ScopePublicationPrefixProof {
  readonly reprove: () => Promise<void>;
}

export async function reproveScopePublicationPrefix(proof: ScopePublicationPrefixProof): Promise<void> {
  await proof.reprove();
}

function prefixProof(tx: AppRowTransaction, schemaName: string, packet: string,
  options: ScopePublicationOptions): ScopePublicationPrefixProof {
  return Object.freeze({ reprove: () => submit(tx, schemaName, "fx_prove_scope_publication_prefix",
    packet, true, "writeWake", options) });
}

/** One complete bounded contribution uses exactly the same fixed family
 * primitives as streamed pages and genuine callback boundaries. */
export async function writeScopePublicationPrefix(tx: AppRowTransaction, command: ScopePublicationContribution,
  kernel: ScopePublicationKernel, options: ScopePublicationOptions, signal?: AbortSignal,
  finiteSession?: Readonly<typeof fxSystemTransactionSessions.$inferSelect>): Promise<ScopePublicationPrefixProof> {
  signal?.throwIfAborted();
  if (options.afterTransactionStep !== undefined) {
    const writer = await beginScopePublicationPrefix(tx, command, kernel, options, signal, command.rowIntents.length, finiteSession);
    await writer.appendRows(command.rowIntents, signal);
    return await writer.finish(signal);
  }
  const packet = projectScopePublicationContribution(command, kernel, command.rowIntents.length, true, finiteSession);
  const schemaName = targetSchema(tx);
  const encoded = JSON.stringify(packet);
  await submit(tx, schemaName, "fx_write_scope_publication_prefix", encoded, true, "writeCommitHeader", options);
  detail(options, "commitHeaders", 1); detail(options, "rowFacts", command.rowIntents.length);
  detail(options, "relationFacts", kernel.relationAdjacencyChanges.length); detail(options, "relationalFacts", packet.relational.length);
  detail(options, "events", packet.events.length); detail(options, "deliveries", packet.deliveries.length);
  detail(options, "outcomes", 1, command.successfulResult.canonicalBytes.byteLength); detail(options, "wakes", 1);
  return prefixProof(tx, schemaName, encoded, options);
}

/** Commerce's paged publication retains only the active page and terminal
 * families. Its prefix is provisional until its trusted outer transaction ACK. */
export async function beginScopePublicationPrefix(tx: AppRowTransaction, command: ScopePublicationContribution,
  kernel: ScopePublicationKernel, options: ScopePublicationOptions, signal?: AbortSignal, knownChangeCount?: number,
  finiteSession?: Readonly<typeof fxSystemTransactionSessions.$inferSelect>) {
  signal?.throwIfAborted();
  if (knownChangeCount !== undefined && (!Number.isSafeInteger(knownChangeCount) || knownChangeCount < 0 || knownChangeCount > 16000)) throw invalid();
  if (knownChangeCount === undefined ? command.rowIntents.length !== 0 : knownChangeCount !== command.rowIntents.length) throw invalid();
  const schemaName = targetSchema(tx);
  const initialAdjacencyCount = kernel.relationAdjacencyChanges.length;
  const original = projectScopePublicationContribution(command, kernel, knownChangeCount ?? 0, knownChangeCount !== undefined, finiteSession);
  await submit(tx, schemaName, "fx_write_scope_publication_header", original.header, 1, "writeCommitHeader", options);
  await step(options, command, "commitHeaderWritten"); detail(options, "commitHeaders", 1);
  let phase: "ready" | "failed" | "complete" = "ready";
  let appendedRows = 0;
  return Object.freeze({
    appendRows: async (rows: ScopePublicationContribution["rowIntents"], appendSignal?: AbortSignal) => {
      if (phase !== "ready") throw invalid();
      phase = "failed";
      const expected = projectScopePublicationRows(kernel, rows, appendedRows);
      for (let offset = 0; offset < expected.length; offset += 500) {
        appendSignal?.throwIfAborted();
        const page = expected.slice(offset, offset + 500);
        await submit(tx, schemaName, "fx_write_scope_publication_rows", page, page.length, "writeCommitChange", options,
          offset + page.length === expected.length ? expected : []);
        await step(options, command, "commitChangeWritten"); detail(options, "rowFacts", page.length);
      }
      appendedRows += rows.length;
      phase = "ready";
    },
    finish: async (finishSignal?: AbortSignal) => {
      if (phase !== "ready") throw invalid();
      phase = "failed";
      finishSignal?.throwIfAborted();
      if (knownChangeCount !== undefined && (appendedRows !== knownChangeCount || kernel.relationAdjacencyChanges.length !== initialAdjacencyCount)) throw invalid();
      const packet = knownChangeCount === undefined
        ? projectScopePublicationContribution(command, kernel, appendedRows, false, finiteSession) : original;
      const encoded = JSON.stringify(packet);
      if (knownChangeCount === undefined) await submit(tx, schemaName, "fx_set_scope_publication_header_counts", packet.header, 1, "writeCommitHeader", options);
      if (options.afterTransactionStep === undefined) {
        await submit(tx, schemaName, "fx_finish_scope_publication_prefix", encoded, true, "writeOutcome", options);
      } else {
        for (let offset = 0; offset < packet.relations.length; offset += 500) {
          finishSignal?.throwIfAborted();
          const page = packet.relations.slice(offset, offset + 500);
          await submit(tx, schemaName, "fx_write_scope_publication_relations", page, page.length, "writeCommitRelationAdjacencyChange", options);
          await step(options, command, "commitRelationAdjacencyChangeWritten"); detail(options, "relationFacts", page.length);
        }
        for (let offset = 0; offset < packet.relational.length; offset += 500) {
          const page = packet.relational.slice(offset, offset + 500);
          await submit(tx, schemaName, "fx_write_scope_publication_relational", page, page.length, "writeCommitChange", options);
        }
        for (let offset = 0; offset < packet.events.length; offset += 64) {
          finishSignal?.throwIfAborted();
          const events = packet.events.slice(offset, offset + 64);
          const deliveries = packet.deliveries.filter(delivery => {
            const ordinal = delivery[fxSystemCommitEventDeliveries.eventOrdinal.name];
            return typeof ordinal === "number" && ordinal >= offset && ordinal < offset + events.length;
          });
          await submit(tx, schemaName, "fx_write_scope_publication_events", events, events.length, "writeCommitChange", options);
          await submit(tx, schemaName, "fx_write_scope_publication_deliveries", deliveries, deliveries.length, "writeCommitChange", options);
        }
        await submit(tx, schemaName, "fx_write_scope_publication_outcome", packet.outcome, 1, "writeOutcome", options);
        await step(options, command, "outcomeWritten"); detail(options, "outcomes", 1, command.successfulResult.canonicalBytes.byteLength);
        await submit(tx, schemaName, "fx_write_scope_publication_wake", packet.wake, 1, "writeWake", options);
        await step(options, command, "wakeWritten"); detail(options, "wakes", 1);
        if (packet.session !== null) {
          const query = tx.select({ accepted: sql<boolean>`${sql.identifier(schemaName)}.fx_finish_scope_publication_session(
            ${JSON.stringify(packet.session)}::jsonb, ${new Date(kernel.publicationTimeMilliseconds).toISOString()}::timestamptz)` }).from(sql`(values(1)) as publication_session`);
          observeDrizzleQuery("writeOutcome", query, options.observeQuery);
          try { const rows = await query; if (rows.length !== 1 || rows[0]?.accepted !== true) throw invalid(); }
          catch (cause) { throw scopePublicationProcedureFailure(cause) ?? new ScopePublicationSqlFailure({ operation: "writeOutcome", cause }); }
        }
        await submit(tx, schemaName, "fx_prove_scope_publication_prefix", encoded, true, "writeWake", options);
      }
      phase = "complete";
      return prefixProof(tx, schemaName, encoded, options);
    },
  });
}
