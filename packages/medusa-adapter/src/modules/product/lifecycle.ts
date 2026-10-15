import { Effect, Schema } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./runtime-metadata";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { medusaLifecycle } from "../../repository/lifecycle";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductLifecycleIds = Schema.Array(Id).check(Schema.isMaxLength(commerceLimits.catalogRows));
export const decodeProductLifecycleIds = commerceDecoder(Schema.Union([Id, ProductLifecycleIds]), "invalidInput");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(commerceLimits.catalogRows)) }), "invalidInput");
/** Operation-local DML cascade. The pinned repository's cascadeDelete metadata
 * selects managed transitions; physical FK cascades select explicit removals.
 * Reads, managed timestamps, bounded SQL and complete row facts stay in core. */
export const changeProductLifecycle = Effect.fn("ProductAdapter.lifecycle")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, entity: ProductEntityMetadata,
  operation: "delete" | "softDelete" | "restore", input: unknown,
) {
  if (operation !== "delete" && entity !== catalog.product && !(operation === "softDelete" && [catalog.variant, catalog.tag].includes(entity))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (operation === "delete" && ![catalog.product, catalog.tag, catalog.type, catalog.collection, catalog.category, catalog.option, catalog.assignment].includes(entity)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
  const selected = operation === "delete" ? (yield* Effect.fromResult(decodeDelete(captured))).$or.map(row => row.id)
    : yield* Effect.fromResult(decodeProductLifecycleIds(captured));
  const ids = typeof selected === "string" ? [selected] : selected;
  if (new Set(ids).size !== ids.length) return yield* Effect.fail(commerceError("invalidInput"));
  const { roots: loadRoots, plan, getStore, loadReferencing } = medusaLifecycle(ctx, catalog, operation);
  const roots = yield* loadRoots(entity.table, ids);
  if (entity === catalog.category) {
    if (roots.length !== ids.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
    for (const root of roots) if ((yield* loadReferencing(entity.table, ["parent_category_id"], root, ["id"]))
      .some(child => child.deleted_at === null))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const planned = yield* plan(entity.table, roots);
  const planSetNull = operation === "delete" && [catalog.type, catalog.collection].includes(entity)
    ? ctx.planSetNull : undefined;
  const plannedDetach: Array<Parameters<NonNullable<CommerceCommandContext["planSetNull"]>>[0]> = [];
  // The pinned repository detaches non-cascading hasMany references before
  // removing a type/collection. These are the profile's admitted nullable
  // Product reference writes, with normal core facts and managed timestamps.
  if (operation === "delete" && [catalog.type, catalog.collection].includes(entity)) {
    for (const relation of entity.table.relationships.filter(relation => relation.type === "hasMany" && !relation.cascadeDelete)) {
      const descriptor = describeToManyRelation(entity.table, relation.name, catalog.tables);
      if (descriptor?.join.type !== "hasMany" || descriptor.targetTable !== catalog.product.table.name)
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const columns = descriptor.join.foreignKeys;
      if (columns.length !== descriptor.sourcePrimaryKeys.length || columns.some(name => !["type_id", "collection_id"].includes(name)))
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      if (planSetNull !== undefined) {
        const reference = entity === catalog.type ? "type_id" : "collection_id";
        if (columns.length !== 1 || columns[0] !== reference || descriptor.sourcePrimaryKeys.length !== 1 ||
          descriptor.sourcePrimaryKeys[0] !== "id") return yield* Effect.fail(commerceError("unsupportedProfile"));
        for (const root of roots) {
          if (typeof root.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
          plannedDetach.push({ sourceTable: catalog.product.table.name, sourceColumn: reference,
            targetTable: entity.table.name, targetColumn: "id", targetKey: root.id });
        }
        continue;
      }
      const updates: JsonObject[] = [];
      for (const root of roots) for (const row of yield* loadReferencing(catalog.product.table, columns, root, descriptor.sourcePrimaryKeys)) {
        if (typeof row.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
        updates.push({ id: row.id, ...Object.fromEntries(columns.map(name => [name, null])) });
      }
      if (updates.length) yield* (yield* getStore(catalog.product.table)).write(ctx.manager, "update", updates);
    }
  }
  const result = yield* planned.apply();
  if (planSetNull !== undefined) for (const selection of plannedDetach) yield* planSetNull(selection);
  return result;
});
