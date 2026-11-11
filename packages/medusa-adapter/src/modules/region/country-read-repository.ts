import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { makeReadCatalog } from "../../query/catalog";
import { executeRead, type ReadPlan } from "../../query/read";
import type { WherePolicy } from "../../query/predicate";
import { captureCommerceInput } from "../../value/input";
import { compileRegionCartReadContracts, regionCartCountryLimit } from "./cart-read-input";
import type { captureRegionMetadata } from "./schema";

/** Region owns this shared Country population repository. Each capability
 * supplies its native query plan and Region bound; Cart retains complete-set
 * acquisition while Store can reuse its command-bound root table. */
export function prepareRegionCountryReadRepository(metadata: Effect.Success<ReturnType<typeof captureRegionMetadata>>["frame"], where: WherePolicy) {
  return Result.gen(function* () {
    const contracts = yield* compileRegionCartReadContracts(metadata), scalar = yield* prepareScalarRepository(contracts.table, "Region", where);
    const catalog = yield* makeReadCatalog([contracts.table, contracts.country].map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: table.columns.filter(column => column.primaryKey).map(column => column.name),
      foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {} })), contracts.relations);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner, profile: {
      readonly query: (input: unknown) => Result.Result<ReadPlan & {
        readonly orderRows?: (rows: JsonObject[]) => JsonObject[];
      }, ReturnType<typeof commerceError>>;
      readonly regionLimit: number;
      readonly boundRoot?: true;
    }) => {
      const bound = scalar.bind(root, owner), { bridge } = bound, denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("RegionCountryRead.find")(function* (ctx: CommerceCommandContext, input: unknown, count: boolean) {
        const plan = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(profile.query)));
        const result = yield* executeRead({ manager: ctx.manager, table: ctx.table, resources: ctx.resources,
          admitSelection: (table, rows) => Result.gen(function* () {
            if (table !== contracts.table.name && table !== contracts.country.name) return yield* Result.fail(commerceError("unsupportedProfile"));
            if (rows.length > (table === contracts.table.name ? profile.regionLimit : regionCartCountryLimit)) return yield* Result.fail(commerceError("limitExceeded"));
            for (const row of rows) yield* (table === contracts.table.name ? contracts.decodeRow : contracts.decodeCountry)(projectNativeRow(row));
          }) }, catalog, plan, count, profile.boundRoot ? ctx.store : undefined);
        return plan.orderRows === undefined ? result : { ...result, rows: plan.orderRows(result.rows) };
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx,
          find(ctx, captured, false)).pipe(Effect.map(value => structuredClone(value.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* find(ctx, captured, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [structuredClone(result.rows), result.count] satisfies [JsonObject[], number];
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { contracts, catalog, bind };
  });
}
