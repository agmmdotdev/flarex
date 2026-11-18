import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import type { commerceRepositoryContext } from "../../repository/context";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import { decodePriceListPriceRemovalIds } from "./price-list-price-input";
import type { PriceListPriceRemovalContracts } from "./price-list-price-removal-input";

/** Price removal uses the complete current Rule graph, including history. The
 * explicit Price/Rule catalog also owns the approved group and traversal order. */
export function priceListPriceRemovalLifecycleMethods(contracts: PriceListPriceRemovalContracts,
  bridge: ReturnType<typeof commerceRepositoryContext>, events: ReturnType<typeof commerceMutationEvents>) {
  const catalog = { tables: contracts.families.map(family => family.table), entities: contracts.families };
  const method = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
    bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
      const ids = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(decodePriceListPriceRemovalIds)));
      if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
        return yield* ctx.refuse(commerceError("unadmittedEvent"));
      const lifecycle = medusaLifecycle(ctx, catalog, operation), roots = yield* lifecycle.roots(contracts.tables.price, ids);
      const plan = yield* lifecycle.plan(contracts.tables.price, roots), before = new Map<string, Map<string, JsonObject>>();
      for (const family of contracts.families) {
        const group = new Map<string, JsonObject>();
        for (const stored of plan.rows(family.table)) {
          const row = yield* Effect.fromResult(family.decodeRow(projectNativeRow(stored)));
          group.set(row.id, row);
        }
        before.set(family.table.name, group);
      }
      const result = yield* plan.apply();
      const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([
        result.roots.map(projectNativeRow), Object.fromEntries(Object.entries(result.cascades).map(([model, rows]) => [model, rows.map(projectNativeRow)])),
      ]));
      if (operation === "softDelete") for (const family of contracts.families) {
        const rows = decoded[1][family.model];
        if (!rows?.length) continue;
        const preimages = before.get(family.table.name);
        const dispatchRows: JsonObject[] = [], changes = new WeakMap<object, { entity: JsonObject; originalEntity: JsonObject }>();
        for (const row of rows) {
          const originalEntity = typeof row.id === "string" ? preimages?.get(row.id) : undefined;
          if (originalEntity === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          const entity = { ...row };
          dispatchRows.push(entity); changes.set(entity, { entity, originalEntity });
        }
        yield* events.rows("afterUpdate", family.model, dispatchRows, shared, row => {
          const change = changes.get(row);
          if (change === undefined) throw commerceError("storedCorruption");
          return change;
        });
      }
      // Native restoration has no mutation subscriber. The shared lifecycle
      // preserves already-active rows without changing their managed clocks.
      return decoded;
    })));
  return { softDelete: method("softDelete"), restore: method("restore") };
}
