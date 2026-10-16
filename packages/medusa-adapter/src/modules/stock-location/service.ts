import { makeStockLocationDeletionCommands } from "./delete-service";
import { makeStockLocationUpdateCommands } from "./update-service";
import { deniedCommerceRepository } from "../../repository/denied";
import { Effect, Result, Schema } from "effect";
import { StockLocation, StockLocationAddress } from "@medusajs/stock-location/models";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { stockLocationStaticResources } from "@medusajs/stock-location/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { DAL, FindConfig, StockLocationTypes } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureStockLocationMetadata } from "./schema";
import { prepareScalarRepository } from "../../repository/scalar";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";
import { commerceModuleEventBus } from "../../module/events";
import { ScalarIdRead, scalarIdWhere } from "../../repository/scalar-id-read";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";

import type { CommercePromiseOwner } from "../../module/promise-owner";
import { compileStockLocationReadReceipt } from "./read-receipt";
import { prepareStockLocationRepository } from "./repository";
import { StockLocationInput, StockLocationsInput, StockLocationsOutput } from "./input";
import { stockLocationCreateEventPolicy } from "./events";

/** Existing ID reads and the separately selected native creation admission. */
const makeBasicStockLocationCommands = Effect.fn("StockLocationAdapter.commands")(function* (admission: "read" | "create" = "read") {
  const metadata = yield* captureStockLocationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "stock_location");
    const address = metadata.frame.tables.find(table => table.name === "stock_location_address");
    if (!table || !address) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = admission === "create" ? yield* prepareStockLocationRepository(table, address)
      : yield* prepareScalarRepository(table, "StockLocation", scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const denied: DAL.RepositoryService = { ...bound.repository,
        create: admission === "create" ? bound.repository.create : bound.refuse };
      const noAddress = deniedCommerceRepository(denied, bound.refuse);
      const eventBus = admission === "create" ? commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse,
      }) : { emit: bound.refuse, subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")), releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse };
      return { baseRepository: denied, repository: (model: typeof StockLocation | typeof StockLocationAddress) => model === StockLocation ? denied : noAddress,
        events: bound.mutationEvents, eventBus };
    };
    const module = yield* defineCommerceModule({ name: admission === "create" ? "flarex-stock-location-create" : "flarex-stock-location-read", models: [StockLocation, StockLocationAddress],
      profile: { name: admission === "create" ? "stock-location-create" : "stock-location-id-read", capabilities: [], bind }, extensions: {},
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new StockLocationModuleService(container, { scope: "internal" });
        return { service: { listAndCountStockLocations: native.listAndCountStockLocations.bind(native), createStockLocations: native.createStockLocations.bind(native) }, context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const decode = commerceDecoder(ScalarIdRead, "invalidInput");
    const prepare = commerceCommandPreparation("StockLocation.prepare")(decode);
    const count = commands.read("stockLocationCount", prepare, ({ service, context }, args) => service.listAndCountStockLocations(args.filters,
      args.config as FindConfig<StockLocationTypes.StockLocationDTO> | undefined, context));
    const decodeCreate = commerceDecoder(Schema.Union([StockLocationInput, StockLocationsInput]), "unsupportedProfile");
    const create = commands.write("stockLocationCreate", commerceCommandPreparation("StockLocation.prepareCreate")(
      input => admission === "create" ? decodeCreate(input) : Result.fail(commerceError("unsupportedProfile"))),
      ({ service, context }, input) => Array.isArray(input) ? service.createStockLocations(input, context) : service.createStockLocations(input, context));
    const decodeCreateArguments = commerceDecoder(Schema.Tuple([StockLocationsInput]), "invalidInput");
    const joiner = stockLocationStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* scalarGraphDefinition(yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "StockLocation") }), "StockLocation", count, prepared.table);
    const validateLogicalCall = yield* compileStockLocationReadReceipt(table, prepared.query);
    const policy = stockLocationCreateEventPolicy(validateLogicalCall);
    const createStockLocations = yield* defineWorkflowMethod({ command: create,
      arguments: decodeCreateArguments, encode: ([rows]) => [...rows],
      output: commerceDecoder(StockLocationsOutput, "storedCorruption"),
      moduleEvents: ["stock_location", "stock_location_address"].map(objectName => buildModuleResourceEventName({ prefix: Modules.STOCK_LOCATION, objectName, action: "created" })),
    });
    const workflow = yield* defineWorkflowModule({ name: Modules.STOCK_LOCATION, source: module.description, methods: { createStockLocations }, graph,
      logical: { ...(admission === "create" ? policy : { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall }), commands: [count, create] } });
    return { count, create, commands: [count, create], workflow, graph, withService: module.use };
  }));
});

export function makeStockLocationCommands(admission: "delete"): ReturnType<typeof makeStockLocationDeletionCommands>;
export function makeStockLocationCommands(admission: "update"): ReturnType<typeof makeStockLocationUpdateCommands>;
export function makeStockLocationCommands(admission?: "read" | "create"): ReturnType<typeof makeBasicStockLocationCommands>;
export function makeStockLocationCommands(admission: "read" | "create" | "update" | "delete" = "read") {
  return admission === "delete" ? makeStockLocationDeletionCommands()
    : admission === "update" ? makeStockLocationUpdateCommands() : makeBasicStockLocationCommands(admission);
}