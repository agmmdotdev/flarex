import { Effect } from "effect";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./runtime-metadata";
import { productMembershipPivots } from "./events/memberships";

/** The named parent admits both sides of replacement. Native final observations
 * plus the authenticated mutation preimages retain the old graph even when the
 * native service has already deleted its children. No storage read is added. */
export function productUpdateGraphReceipt(catalog: ProductRuntimeMetadata,
  validate: LogicalCommerceCallValidation): LogicalCommerceCallValidation {
  return Effect.fn("ProductUpdate.validateBoundedGraph")(function* (call, activity, command) {
    yield* validate(call, activity, command);
    if (call.mode === "read") return;
    const roots = new Set(activity.mutations.flatMap(mutation => mutation.table === catalog.product.table.name &&
      typeof mutation.before?.id === "string" ? [mutation.before.id] : []));
    if (roots.size > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const memberships = yield* productMembershipPivots(catalog);
    const specifications = [catalog.image, catalog.option, catalog.value, catalog.variant]
      .map(entity => ({ table: entity.table.name, keys: ["id"] }));
    specifications.push(...memberships.map(pivot => ({ table: pivot.table, keys: [pivot.productColumn, pivot.targetColumn] })));
    const keys = new Map(specifications.map(specification => [specification.table, specification.keys]));
    const key = (table: string, row: JsonObject) => JSON.stringify((keys.get(table) ?? []).map(column => row[column]));
    const final = new Map(specifications.map(specification => [specification.table, new Map<string, JsonObject>()]));
    for (const observation of activity.observedRows)
      final.get(observation.table)?.set(key(observation.table, observation.row), observation.row);
    for (const mutation of activity.mutations) {
      const selected = final.get(mutation.table);
      if (mutation.before !== null) selected?.delete(key(mutation.table, mutation.before));
      if (mutation.after !== null) selected?.set(key(mutation.table, mutation.after), mutation.after);
    }
    const previous = new Map([...final].map(([table, rows]) => [table, new Map(rows)]));
    for (const mutation of [...activity.mutations].reverse()) {
      const selected = previous.get(mutation.table);
      if (mutation.after !== null) selected?.delete(key(mutation.table, mutation.after));
      if (mutation.before !== null) selected?.set(key(mutation.table, mutation.before), mutation.before);
    }
    for (const graph of [previous, final]) {
      let variants = 0;
      for (const root of roots) {
        for (const [entity, owner, maximum] of [[catalog.image, catalog.foreignKeys.image, 2],
          [catalog.option, catalog.foreignKeys.option, 1], [catalog.variant, catalog.foreignKeys.variant, 4]] as const) {
          const children = [...graph.get(entity.table.name)?.values() ?? []]
            .filter(row => row.deleted_at === null && row[owner] === root);
          if (children.length > maximum) return yield* Effect.fail(commerceError("unsupportedProfile"));
          if (entity === catalog.variant) variants += children.length;
          if (entity === catalog.option) for (const option of children) {
            const values = [...graph.get(catalog.value.table.name)?.values() ?? []]
              .filter(row => row.deleted_at === null && row[catalog.foreignKeys.value] === option.id);
            if (values.length > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
          }
        }
        for (const membership of memberships) {
          const members = [...graph.get(membership.table)?.values() ?? []].filter(row => row[membership.productColumn] === root);
          if (members.length > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
        }
      }
      if (variants > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
    }
  });
}
