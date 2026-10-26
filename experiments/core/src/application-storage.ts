import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { Definition, Document } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { materialize, planMaterialization, type Change } from "./materialization.ts";
import type { Command, Database, Persistence, Snapshot } from "./persistence.ts";
import { applicationLimits, type Dependency, type NumericRange } from "./query.ts";
import * as tables from "./schema.ts";
import { checkApplicationDependencies, rangePredicate } from "./application-conflicts.ts";

/** The actual read plan, shared with EXPLAIN witnesses. Authority stays with
 * the caller's accepting session; this builder is never exposed to functions. */
export function historicalRangeQuery(transaction: Database, scope: string, table: string, sequence: number,
  range: NumericRange, remainingRows: number, remainingBytes: number) {
  // Match the physical index in every direction. Limit historical candidates
  // before visibility filtering; do not sort an unbounded revision group.
  const candidates = transaction.select().from(tables.indexVersions).where(and(eq(tables.indexVersions.scope, scope),
    eq(tables.indexVersions.table, table), rangePredicate(range)))
    .orderBy(asc(tables.indexVersions.key), asc(tables.indexVersions.creationTime), asc(tables.indexVersions.id), asc(tables.indexVersions.fromSeq)).limit(remainingRows + 1).as("candidates");
  const visible = and(lte(candidates.fromSeq, sequence), or(isNull(candidates.untilSeq), gt(candidates.untilSeq, sequence)));
  const rowBytes = sql<number>`case when ${visible} then coalesce(octet_length(${tables.history.body}::text),0) else 0 end`.mapWith(Number);
  const consumed = sql<number>`sum(${rowBytes}) over(order by ${candidates.key},${candidates.creationTime},${candidates.id},${candidates.fromSeq})`.mapWith(Number);
  return transaction.select({ id: candidates.id, revision: candidates.fromSeq, key: candidates.key, visible: sql<boolean>`${visible}`,
    bytes: rowBytes, body: sql<Document | null>`case when ${visible} and ${consumed} <= ${remainingBytes} then ${tables.history.body} else null end` })
    .from(candidates).innerJoin(tables.history, and(eq(tables.history.scope, candidates.scope), eq(tables.history.table, candidates.table),
      eq(tables.history.id, candidates.id), eq(tables.history.commitSeq, candidates.fromSeq)))
    .orderBy(asc(candidates.key), asc(candidates.creationTime), asc(candidates.id), asc(candidates.fromSeq));
}

/** Application-specific reads/OCC, sharing authority, sessions and publication
 * with the framework profile. No native framework runtime participates. */
export function createApplicationStorage(persistence: Persistence) {
  const { operation, loadSnapshot } = persistence;
  return {
    openQuery: persistence.openSnapshot, closeSnapshot: persistence.closeSnapshot,
    openMutation: (scope: string, request: string, digest: string, definition: Definition, token: string) =>
      persistence.openCommand("application", scope, request, digest, definition, token),
    commandSnapshot: persistence.commandSnapshot, restart: persistence.restart,
    abort: persistence.abort, resolve: persistence.resolve,
    check: Effect.fn("ExperimentApplicationStorage.check")((snapshot: Snapshot) => operation(async transaction => { await loadSnapshot(transaction, snapshot); })),
    point: Effect.fn("ExperimentApplicationStorage.point")((snapshot: Snapshot, id: string, remainingBytes: number) => operation(async transaction => {
      const admitted = await loadSnapshot(transaction, snapshot);
      const bytes = sql<number>`coalesce(octet_length(${tables.history.body}::text),0)`.mapWith(Number);
      const [row] = await transaction.select({ id: tables.history.id, revision: tables.history.commitSeq, bytes,
        body: sql<Document | null>`case when ${bytes} <= ${remainingBytes} then ${tables.history.body} else null end` })
        .from(tables.history).where(and(eq(tables.history.scope, admitted.scope), eq(tables.history.table, admitted.definition.table),
          eq(tables.history.id, id), lte(tables.history.commitSeq, snapshot.sequence))).orderBy(desc(tables.history.commitSeq)).limit(1);
      if (row !== undefined && row.bytes > remainingBytes) throw new CoreError({ reason: "limit" });
      return row ?? { id, revision: null, body: null, bytes: 0 };
    })),
    range: Effect.fn("ExperimentApplicationStorage.range")((snapshot: Snapshot, range: NumericRange, remainingRows: number, remainingBytes: number) => operation(async transaction => {
      const admitted = await loadSnapshot(transaction, snapshot);
      if (!admitted.definition.indexes.some(index => index.name === range.index && index.field === range.field)) throw new CoreError({ reason: "unsupported" });
      const rows = await historicalRangeQuery(transaction, admitted.scope, admitted.definition.table, snapshot.sequence, range, remainingRows, remainingBytes);
      const bytes = rows.reduce((total, row) => total + row.bytes, 0);
      if (rows.length > remainingRows || bytes > remainingBytes) throw new CoreError({ reason: "limit" });
      return { rows: rows.filter(row => row.visible), examined: rows.length, bytes };
    })),
    accept: Effect.fn("ExperimentApplicationStorage.accept")(function* (command: Command, inputChanges: readonly Change[], inputDependencies: readonly Dependency[], inputResult: Schema.Json) {
      const { changes, dependencies, result } = structuredClone({ changes: inputChanges, dependencies: inputDependencies, result: inputResult });
      const plan = planMaterialization([{ definition: yield* persistence.definition(command), changes, events: [] }]);
      return yield* operation(async transaction => {
      const { stored, admitted } = await persistence.load(transaction, command, "update");
      const [clock] = await transaction.select().from(tables.clocks).where(eq(tables.clocks.scope, stored.scope)).for("update");
      await persistence.checkTime(transaction, stored.expires);
      if (stored.profile !== "application" || !admitted.owner || admitted.selection.length !== 1) throw new CoreError({ reason: "unsupported" });
      if (clock === undefined || changes.length > applicationLimits.rows || dependencies.length > applicationLimits.dependencies ||
        Buffer.byteLength(JSON.stringify(changes)) > applicationLimits.bytes || Buffer.byteLength(JSON.stringify(result)) > applicationLimits.bytes) throw new CoreError({ reason: "limit" });
      const points = dependencies.flatMap(dependency => dependency.kind === "point" ? [dependency.id] : []);
      if (changes.some(change => !points.includes(change.id))) throw new CoreError({ reason: "invalid" });
      await checkApplicationDependencies(transaction, stored.scope, stored.snapshot, [{ definition: admitted.definition, dependencies }]);
      const seq = clock.seq + 1; if (!Number.isSafeInteger(seq)) throw new CoreError({ reason: "limit" });
      await materialize(transaction, stored.scope, command.id, seq, plan, result);
      return result;
    }); }),
  };
}
export type ApplicationStorage = ReturnType<typeof createApplicationStorage>;
