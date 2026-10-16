import { Effect, Result } from "effect";
import { StockLocation, StockLocationAddress } from "@medusajs/stock-location/models";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { captureStockLocationMetadata } from "./schema";
import { prepareStockLocationDeletionRepository } from "./delete-repository";
import { decodeStockLocationDeletionArguments, decodeStockLocationDeletionIds } from "./delete-input";
import { stockLocationDeletionPolicy } from "./delete-receipt";

/** Genuine generated native lifecycle methods; no Address data method, graph,
 * Link authority or external workflow event is granted by this module. */
export const makeStockLocationDeletionCommands = Effect.fn("StockLocationAdapter.deleteCommands")(function* () {
  const metadata = yield* captureStockLocationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareStockLocationDeletionRepository(metadata.frame);
    const module = yield* defineCommerceModule({ name: "flarex-stock-location-delete", models: [StockLocation, StockLocationAddress],
      profile: { name: "stock-location-delete", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: typeof StockLocation | typeof StockLocationAddress) => model === StockLocation ? bound.repository : bound.addressRepository,
          events: bound.mutationEvents, eventBus };
      } }, extensions: {},
      service: ({ binding, dependencies, context }) => {
        const native = new StockLocationModuleService({ ...dependencies, [Modules.EVENT_BUS]: binding.eventBus }, { scope: "internal" });
        return { service: { softDeleteStockLocations: native.softDeleteStockLocations.bind(native), restoreStockLocations: native.restoreStockLocations.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("StockLocationDelete.prepare");
    const softDeleteForWorkflow = commands.write("stockLocationSoftDeleteForWorkflow", prepare(decodeStockLocationDeletionIds),
      ({ service, context }, ids) => service.softDeleteStockLocations([...ids], {}, context));
    const restoreForWorkflow = commands.write("stockLocationRestoreForWorkflow", prepare(decodeStockLocationDeletionIds),
      ({ service, context }, ids) => service.restoreStockLocations([...ids], {}, context));
    const softDeleteStockLocations = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeStockLocationDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.STOCK_LOCATION, objectName: "stock_location", action: "deleted" })] });
    const restoreStockLocations = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeStockLocationDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput,
      // The pinned conventional restore dispatcher derives source from the
      // first model-name component, unlike the subscribed deletion path.
      moduleEvents: [buildModuleResourceEventName({ prefix: "stock", objectName: "stock_location", action: "restored" })] });
    const admitted = [softDeleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.STOCK_LOCATION, source: module.description,
      methods: { softDeleteStockLocations, restoreStockLocations }, graph: { aliases: [], reads: [] },
      logical: { ...stockLocationDeletionPolicy(prepared.contracts), commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use };
  }));
});
