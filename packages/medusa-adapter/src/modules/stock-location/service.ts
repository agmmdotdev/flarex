import { deniedCommerceRepository } from "../../repository/denied";
import { Effect, Result } from "effect";
import { StockLocation, StockLocationAddress } from "@medusajs/stock-location/models";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { stockLocationStaticResources } from "@medusajs/stock-location/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import type { DAL, FindConfig, StockLocationTypes } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureStockLocationMetadata } from "./schema";
import { prepareScalarRepository } from "../../repository/scalar";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";
import { ScalarIdRead, scalarIdWhere } from "../../repository/scalar-id-read";
import { defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";

import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";

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
      const noAddress = deniedCommerceRepository(denied, bound.refuse);
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
    const prepare = commerceCommandPreparation("StockLocation.prepare")(decode);
    const count = commands.read("stockLocationCount", prepare, ({ service, context }, args) => service.listAndCountStockLocations(args.filters,
      args.config as FindConfig<StockLocationTypes.StockLocationDTO> | undefined, context));
    const joiner = stockLocationStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* scalarGraphDefinition(yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "StockLocation") }), "StockLocation", count, prepared.table);
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StockLocation.validateRead")(function* (call, activity) {
      if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    const workflow = yield* defineWorkflowModule({ name: Modules.STOCK_LOCATION, source: module.description, methods: {}, graph,
      logical: { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall, commands: [count] } });
    return { count, commands: [count], workflow, graph };
  }));
});
