import { withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { Effect, Result } from "effect";
import { StockLocation, StockLocationAddress } from "@medusajs/stock-location/models";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { stockLocationStaticResources } from "@medusajs/stock-location/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import type { FindConfig, StockLocationTypes } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { deniedCommerceRepository } from "../../repository/denied";
import { defineWorkflowModule } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { captureStockLocationMetadata } from "./schema";
import { prepareStockLocationUpdateRepository } from "./update-repository";
import { compileStockLocationUpdateReadReceipt } from "./update-read-receipt";
import { StockLocationUpdateReadInput } from "./update-input";

/** Shipping reuses the checked native Location/Address read owner. Neither
 * its existing write methods nor a provider receive a mutation capability. */
export const makeStockLocationCartShippingReadCommands = Effect.fn("StockLocation.cartShippingRead")(function* () {
  const metadata = yield* captureStockLocationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "stock_location"),
      address = metadata.frame.tables.find(table => table.name === "stock_location_address");
    if (table === undefined || address === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = yield* prepareStockLocationUpdateRepository(table, address);
    const validateLogicalCall = yield* compileStockLocationUpdateReadReceipt(table, address, prepared.reads);
    const module = yield* defineCommerceModule({ name: "flarex-stock-location-cart-shipping-read", models: [StockLocation, StockLocationAddress],
      profile: { name: "stock-location.cart-shipping-read", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), denied = deniedCommerceRepository(bound.repository, bound.refuse);
        const repository = { ...denied, serialize: bound.repository.serialize, find: bound.repository.find, findAndCount: bound.repository.findAndCount };
        return { baseRepository: repository, repository: (model: typeof StockLocation | typeof StockLocationAddress) => model === StockLocation ? repository : denied,
          events: bound.mutationEvents, eventBus: commerceModuleEventBus({ owner, resources: ctx.resources,
            capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse }) };
      } }, extensions: {}, service: ({ binding, dependencies, context }) => {
        const native = new StockLocationModuleService({ ...dependencies, [Modules.EVENT_BUS]: binding.eventBus }, { scope: "internal" });
        return { service: native.listAndCountStockLocations.bind(native), context };
      } }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const count = commerceServiceCommands(module.use).read("stockLocationCountForUpdate",
      commerceCommandPreparation("StockLocation.prepareCartShippingRead")(commerceDecoder(StockLocationUpdateReadInput, "invalidInput")),
      ({ service, context }, input) => service(input.filters, input.config as FindConfig<StockLocationTypes.StockLocationDTO> | undefined, context));
    const joiner = stockLocationStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* withNativeGraphMetadata({ aliases: (yield* moduleAliases(joiner)).filter(alias => alias.model === "StockLocation"),
      reads: [{ model: "StockLocation", command: count, table: prepared.table,
        paths: [{ path: "address", table: prepared.address, many: false, optional: true, sourceFields: ["address_id"] }],
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] }, [joiner], metadata.frame.tables);
    const workflow = yield* defineWorkflowModule({ name: Modules.STOCK_LOCATION, source: module.description, methods: {}, graph,
      logical: { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall, commands: [count] } });
    return { workflow, graph, count, commands: [count] };
  }));
});
