import { Effect } from "effect";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { readCommerceRelationRows, type CommerceRelationLookup, type CommerceRelation, type CommerceRelationReadContext } from "./relations";
import type { Predicate } from "./predicate";

const identities = Effect.fn("MedusaAdapter.relationIdentities")(function* (rows: readonly JsonObject[], columns: readonly string[], nullable = false) {
  const column = columns[0];
  if (columns.length !== 1 || column === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[column];
    if (nullable && value === null) continue;
    if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
    values.add(value);
  }
  return [...values];
});
const visible = (predicate: Predicate, withDeleted: boolean): Predicate => ({ kind: "and", children: [
  ...(withDeleted ? [] : [{ kind: "isNull" as const, column: "deleted_at" }]), predicate,
] });

/** Resolve an admitted existence predicate from leaf to root, before paging.
 * Every lookup stays on the same manager and proves its complete bounded set. */
export const resolveCommerceRelationFilter = Effect.fn("MedusaAdapter.resolveRelationFilter")(function* (
  ctx: CommerceRelationReadContext, source: string, path: string,
  predicate: Json, relations: CommerceRelationLookup, withDeleted = false,
) {
  const steps: { source: string; relation: CommerceRelation }[] = [];
  let table = source;
  for (const name of path.split(".")) {
    const relation = relations.get(table)?.get(name);
    if (relation === undefined || relation.sourcePrimaryKeys.length !== 1 || relation.targetPrimaryKeys.length !== 1)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (relation.join.type === "manyToMany"
      ? relation.join.sourceColumns.length !== 1 || relation.join.targetColumns.length !== 1
      : relation.join.foreignKeys.length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
    steps.push({ source: table, relation }); table = relation.targetTable;
  }
  const leafKey = steps.at(-1)?.relation.targetPrimaryKeys[0];
  if (leafKey === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  let rows = yield* readCommerceRelationRows(ctx, table, predicate, leafKey);
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const { relation } = step;
    const join = relation.join;
    let selected: Predicate;
    const rootKey = relation.sourcePrimaryKeys[0];
    if (rootKey === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (join.type === "belongsTo") {
      const foreignKey = join.foreignKeys[0];
      if (join.foreignKeys.length !== 1 || foreignKey === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      selected = { kind: "in", column: foreignKey, values: yield* identities(rows, relation.targetPrimaryKeys) };
    } else if (join.type === "hasMany" || join.type === "hasOne") selected = { kind: "in", column: rootKey, values: yield* identities(rows, join.foreignKeys, true) };
    else if (join.type === "manyToMany") {
      const target = join.targetColumns[0];
      if (join.targetColumns.length !== 1 || target === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const values = yield* identities(rows, relation.targetPrimaryKeys);
      const pivots = yield* readCommerceRelationRows(ctx, join.pivotTable, { kind: "in", column: target, values }, target);
      selected = { kind: "in", column: rootKey, values: yield* identities(pivots, join.sourceColumns) };
    } else return yield* Effect.fail(commerceError("unsupportedProfile"));
    if (index === 0) return selected;
    if (index > 0) {
      rows = yield* readCommerceRelationRows(ctx, step.source, visible(selected, withDeleted), rootKey);
    }
  }
  return yield* Effect.fail(commerceError("unsupportedProfile"));
});
