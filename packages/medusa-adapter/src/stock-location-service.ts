import { Effect, Result } from "effect";
import { StockLocation, StockLocationAddress } from "@medusajs/stock-location/models";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { stockLocationStaticResources } from "@medusajs/stock-location/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import type { DAL, FindConfig, StockLocationTypes } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureStockLocationMetadata } from "./stock-location-schema";
import { prepareScalarRepository } from "./scalar-repository";
import { defineCommerceModule } from "./module-definition";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { ScalarIdRead, scalarIdWhere } from "./scalar-id-read";
import { defineWorkflowModule } from "./workflow/module";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import type { LogicalCallReceiptValidation } from "./logical-call-receipt";

/** Native Stock Location reads supply the real endpoint used by the level child. */
export const makeStockLocationReads = Effect.fn("StockLocationAdapter.reads")(function* () {
  const metadata = yield* captureStockLocationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "stock_location");
    if (!table) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = yield* prepareScalarRepository(table, "StockLocation", scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const denied: DAL.RepositoryService = { ...bound.repository, create: bound.refuse, update: bound.refuse, delete: bound.refuse,
        softDelete: bound.refuse, restore: bound.refuse, upsert: bound.refuse, upsertWithReplace: bound.refuse };
      const noAddress: DAL.RepositoryService = { ...denied, find: bound.refuse, findAndCount: bound.refuse, serialize: bound.refuse };
      return { baseRepository: denied, repository: (model: typeof StockLocation | typeof StockLocationAddress) => model === StockLocation ? denied : noAddress,
        eventBus: { emit: bound.refuse, subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")), releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse } };
    };
    const module = yield* defineCommerceModule({ name: "flarex-stock-location-read", models: [StockLocation, StockLocationAddress],
      profile: { name: "stock-location-id-read", capabilities: [], bind }, extensions: {},
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new StockLocationModuleService(container, { scope: "internal" });
        return { service: { listAndCountStockLocations: native.listAndCountStockLocations.bind(native) }, context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const decode = commerceDecoder(ScalarIdRead, "invalidInput");
    const prepare = Effect.fn("StockLocation.prepare")((ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(
      Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
    const count = commands.read("stockLocationCount", prepare, ({ service, context }, args) => service.listAndCountStockLocations(args.filters,
      args.config as FindConfig<StockLocationTypes.StockLocationDTO> | undefined, context));
    const joiner = stockLocationStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "StockLocation") }),
      reads: [{ model: "StockLocation", command: count, table: prepared.table, paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] };
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StockLocation.validateRead")(function* (call, activity) {
      if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    const workflow = yield* defineWorkflowModule({ name: Modules.STOCK_LOCATION, source: module.description, methods: {}, graph,
      logical: { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall, commands: [count] } });
    return { count, commands: [count], workflow, graph };
  }));
});
