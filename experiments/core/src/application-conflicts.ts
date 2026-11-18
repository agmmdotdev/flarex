import { and, eq, exists, gt, gte, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "./persistence.ts";
import type { NumericRange, TableDependencies } from "./query.ts";
import { CoreError } from "./errors.ts";
import * as tables from "./schema.ts";

export const rangePredicate = (range: NumericRange): SQL | undefined => and(
  eq(tables.indexVersions.index, range.index),
  range.lower === null ? undefined : (range.lower.inclusive ? gte : gt)(tables.indexVersions.key, range.lower.value),
  range.upper === null ? undefined : (range.upper.inclusive ? lte : lt)(tables.indexVersions.key, range.upper.value),
);

/** Application/mixed dependency acceptance, separate from direct framework CAS.
 * Call only while holding the common scope clock and fresh selected gates. */
export function applicationConflict(transaction: Database, scope: string, sequence: number, candidates: readonly TableDependencies[]) {
  const points = candidates.flatMap(({ definition, dependencies }) => {
    const ids = dependencies.flatMap(dependency => dependency.kind === "point" ? [dependency.id] : []);
    return ids.length === 0 ? [] : [and(eq(tables.history.table, definition.table), inArray(tables.history.id, ids))];
  });
  const pointConflict = points.length === 0 ? sql`false` : exists(transaction.select({ present: sql`1` }).from(tables.history)
    .where(and(eq(tables.history.scope, scope), gt(tables.history.commitSeq, sequence), or(...points))));
  let invalidRange = false;
  const ranges = candidates.flatMap(({ definition, dependencies }) => dependencies.flatMap(dependency => {
    if (dependency.kind !== "range") return [];
    if (!definition.indexes.some(index => index.name === dependency.range.index && index.field === dependency.range.field)) { invalidRange = true; return []; }
    return [and(eq(tables.indexVersions.table, definition.table), rangePredicate(dependency.range))];
  }));
  if (points.length === 0 && ranges.length === 0 && !invalidRange) return undefined;
  const rangeConflict = ranges.length === 0 ? sql`false` : exists(transaction.select({ present: sql`1` }).from(tables.indexVersions)
    .where(and(eq(tables.indexVersions.scope, scope), or(...ranges),
      or(gt(tables.indexVersions.fromSeq, sequence), gt(tables.indexVersions.untilSeq, sequence)))));
  // Preserve point-conflict before malformed-range before range-conflict.
  return sql<"conflict" | "invalid" | null>`case when ${pointConflict} then 'conflict'::text when ${invalidRange} then 'invalid'::text when ${rangeConflict} then 'conflict'::text else null::text end`;
}

export async function checkApplicationDependencies(transaction: Database, scope: string, sequence: number, candidates: readonly TableDependencies[]) {
  const verdict = applicationConflict(transaction, scope, sequence, candidates);
  if (verdict === undefined) return;
  const [row] = await transaction.select({ reason: verdict }).from(tables.installation).where(eq(tables.installation.singleton, true));
  if (row === undefined) throw new CoreError({ reason: "storage" });
  if (row.reason !== null) throw new CoreError({ reason: row.reason });
}
