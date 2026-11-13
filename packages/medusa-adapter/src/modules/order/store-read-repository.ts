import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { compileProjection, projectRows } from "../../query/projection";
import { executeRead } from "../../query/read";
import { bindCommerceRelationRows, populateCommerceRelations } from "../../query/relations";
import { compileOrderCreationContracts } from "./finance-contracts";
import { orderFinanceVersionFilters, prepareOrderFinanceQuery } from "./finance-query";
import type { captureOrderMetadata } from "./schema";
import { storeOrderPageLimit, storeOrderRelatedLimit } from "./store-read-input";

/** Native Store reads use the shared page/count owner, followed by Order's
 * own versioned local population. No mutation repository is granted. */
export function prepareStoreOrderReadRepository(metadata: Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderCreationContracts(metadata);
    const { query } = prepareOrderFinanceQuery(contracts.catalog, contracts.entities.map(entity => entity.table), "store-read");
    const first = yield* contracts.entity("order");
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const primary = first.scalar.bind(root, owner), { bridge } = primary;
      const denied = deniedCommerceRepository(primary.repository, primary.refuse);
      const origins = new WeakMap<object, string>();
      const returned = (table: string, rows: readonly JsonObject[]) => {
        const values = structuredClone([...rows]); origins.set(values, table);
        for (const row of values) origins.set(row, table);
        return values;
      };
      const admitSelection = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
        const entity = yield* contracts.entity(table);
        if (rows.length > (table === "order" ? storeOrderPageLimit : storeOrderRelatedLimit))
          return yield* Result.fail(commerceError("limitExceeded"));
        for (const row of rows) yield* entity.complete(projectNativeRow(row));
      });
      const find = Effect.fn("StoreOrderRead.find")(function* (ctx: CommerceCommandContext, table: string, input: unknown, withCount: boolean) {
        const entity = yield* Effect.fromResult(contracts.entity(table));
        const plan = yield* Effect.fromResult(query(entity.table, input));
        if (table === "order" && typeof plan.query.take === "number" && plan.query.take > storeOrderPageLimit)
          return yield* ctx.refuse(commerceError("unsupportedProfile"));
        const fullRoot = yield* Effect.fromResult(compileProjection(contracts.catalog, table, undefined, [], {
          keys: "retain", storageKeys: "last", joinKeys: "retain", selectableRelations: [], nested: new Map(),
        }));
        const selected = yield* executeRead({ ...ctx, admitSelection }, contracts.catalog,
          { ...plan, projection: fullRoot, paths: [] }, withCount);
        const filters = yield* Effect.fromResult(orderFinanceVersionFilters(table, plan.paths, selected.rows));
        const populated = yield* populateCommerceRelations(bindCommerceRelationRows({ ...ctx, admitSelection }), table,
          selected.rows, plan.paths, contracts.relations, plan.ordering, false, filters);
        const rows = yield* Effect.fromResult(projectRows(populated, plan.projection.node));
        return { rows: returned(table, rows), count: selected.count };
      });
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          const rows = Array.isArray(input) ? input : [input];
          const table = input !== null && typeof input === "object" ? origins.get(input) ??
            (rows[0] !== null && typeof rows[0] === "object" ? origins.get(rows[0]) : undefined) : undefined;
          if (table === undefined) return yield* root.refuse(commerceError("storedCorruption"));
          // Native Order formatting mutates nested Summary totals. As in the
          // finance owner, detach after validated capture before presentation.
          const captured = structuredClone(yield* Effect.fromResult(captureNativeNumericDto(input, root.resources)));
          if (!isJsonObject(captured) && !Array.isArray(captured)) return yield* root.refuse(commerceError("storedCorruption"));
          // SAFETY: native DAL's generic includes partial selections. Complete
          // checked source rows precede this metadata-owned DTO presentation.
          return (yield* contracts.present(captured, table)) as Output;
        })));
      const repositories = new Map<string, DAL.RepositoryService>();
      for (const name of ["order", "order_line_item"] as const) repositories.set(name, { ...denied, serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx,
          find(ctx, name, captured, false).pipe(Effect.map(result => result.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx,
          find(ctx, name, captured, true).pipe(Effect.flatMap(result => result.count === undefined
            ? ctx.refuse(commerceError("storedCorruption")) : Effect.succeed([result.rows, result.count] satisfies [JsonObject[], number]))))),
      });
      return { ...primary, denied, serialize,
        repository: (model: { readonly name: string }) => repositories.get(model.name === "Order" ? "order" : model.name === "OrderLineItem" ? "order_line_item" : "") ?? denied };
    };
    return { contracts, query, bind };
  });
}
