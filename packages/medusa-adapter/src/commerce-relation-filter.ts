import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { readCommerceRelationRows, type CommerceRelationLookup, type CommerceRelation } from "./commerce-relations";

const identities = Effect.fn("MedusaAdapter.relationIdentities")(function* (rows: readonly JsonObject[], columns: readonly string[]) {
  const column = columns[0];
  if (columns.length !== 1 || column === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[column];
    if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
    values.add(value);
  }
  return [...values];
});
const visible = (column: string, values: string[], withDeleted: boolean) => ({ kind: "and", children: [
  ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }]), { kind: "in", column, values },
] });

/** Resolve an admitted existence predicate from leaf to root, before paging.
 * Every lookup stays on the same manager and proves its complete bounded set. */
export const resolveCommerceRelationFilter = Effect.fn("MedusaAdapter.resolveRelationFilter")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">, source: string, path: string,
  predicate: Json, relations: CommerceRelationLookup, withDeleted = false,
) {
  const steps: { source: string; relation: CommerceRelation }[] = [];
  let table = source;
  for (const name of path.split(".")) {
    const relation = relations.get(table)?.get(name);
    if (relation === undefined || relation.join.type === "belongsTo") return yield* Effect.fail(commerceError("unsupportedProfile"));
    steps.push({ source: table, relation }); table = relation.targetTable;
  }
  const leafKey = steps.at(-1)?.relation.targetPrimaryKeys[0];
  if (leafKey === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  let rows = yield* readCommerceRelationRows(ctx, table, predicate, leafKey);
  let roots: string[] = [];
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const { relation } = step;
    const join = relation.join;
    if (join.type === "hasMany") roots = yield* identities(rows, join.foreignKeys);
    else if (join.type === "manyToMany") {
      const target = join.targetColumns[0];
      if (join.targetColumns.length !== 1 || target === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const values = yield* identities(rows, relation.targetPrimaryKeys);
      const pivots = yield* readCommerceRelationRows(ctx, join.pivotTable, { kind: "in", column: target, values }, target);
      roots = yield* identities(pivots, join.sourceColumns);
    } else return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (index > 0) {
      const key = relation.sourcePrimaryKeys[0];
      if (relation.sourcePrimaryKeys.length !== 1 || key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      rows = yield* readCommerceRelationRows(ctx, step.source, visible(key, roots, withDeleted), key);
    }
  }
  return roots;
});
