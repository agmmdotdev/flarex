import { and, eq, gt, gte, inArray, lt, lte, or, type SQL } from "drizzle-orm";
import type { Definition } from "./definition.ts";
import type { Database } from "./persistence.ts";
import type { Dependency, NumericRange } from "./query.ts";
import { CoreError } from "./errors.ts";
import * as tables from "./schema.ts";

export const rangePredicate = (range: NumericRange): SQL | undefined => and(
  eq(tables.indexVersions.index, range.index),
  range.lower === null ? undefined : (range.lower.inclusive ? gte : gt)(tables.indexVersions.key, range.lower.value),
  range.upper === null ? undefined : (range.upper.inclusive ? lte : lt)(tables.indexVersions.key, range.upper.value),
);
export interface TableDependencies { readonly definition: Definition; readonly dependencies: readonly Dependency[] }

/** Application/mixed dependency acceptance, separate from direct framework CAS.
 * Call only while holding the common scope clock and fresh selected gates. */
export async function checkApplicationDependencies(transaction: Database, scope: string, sequence: number, candidates: readonly TableDependencies[]) {
  const points = candidates.flatMap(({ definition, dependencies }) => {
    const ids = dependencies.flatMap(dependency => dependency.kind === "point" ? [dependency.id] : []);
    return ids.length === 0 ? [] : [and(eq(tables.history.table, definition.table), inArray(tables.history.id, ids))];
  });
  if (points.length !== 0 && (await transaction.select({ id: tables.history.id }).from(tables.history)
    .where(and(eq(tables.history.scope, scope), gt(tables.history.commitSeq, sequence), or(...points))).limit(1)).length !== 0) throw new CoreError({ reason: "conflict" });
  const ranges = candidates.flatMap(({ definition, dependencies }) => dependencies.flatMap(dependency => {
    if (dependency.kind !== "range") return [];
    if (!definition.indexes.some(index => index.name === dependency.range.index && index.field === dependency.range.field)) throw new CoreError({ reason: "invalid" });
    return [and(eq(tables.indexVersions.table, definition.table), rangePredicate(dependency.range))];
  }));
  if (ranges.length !== 0 && (await transaction.select({ id: tables.indexVersions.id }).from(tables.indexVersions)
    .where(and(eq(tables.indexVersions.scope, scope), or(...ranges),
      or(gt(tables.indexVersions.fromSeq, sequence), gt(tables.indexVersions.untilSeq, sequence)))).limit(1)).length !== 0) throw new CoreError({ reason: "conflict" });
}
