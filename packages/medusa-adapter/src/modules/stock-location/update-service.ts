import { Effect, Result, Schema } from "effect";
import { StockLocation, StockLocationAddress } from "@medusajs/stock-location/models";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { stockLocationStaticResources } from "@medusajs/stock-location/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { FindConfig, StockLocationTypes, UpsertStockLocationAddressInput, UpdateStockLocationInput, FilterableStockLocationProps } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { encodeOptionalServiceResult } from "../../module/result";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { captureStockLocationMetadata } from "./schema";
import { prepareStockLocationUpdateRepository } from "./update-repository";
import { stockLocationUpdateEventPolicy } from "./update-events";
import { compileStockLocationUpdateContracts, StockLocationUpdateSelector, StockLocationRootUpdate,
  StockLocationAddressSelector, StockLocationAddressUpserts, StockLocationUpdateReadInput, StockLocationAddressReadInput,
  decodeStockLocationRootUpdateInput, decodeStockLocationAddressUpserts } from "./update-input";

const decodeLocationListArguments = commerceDecoder(Schema.Tuple([StockLocationUpdateSelector, NativePreimageConfig]), "invalidInput");
const decodeAddressListArguments = commerceDecoder(Schema.Tuple([StockLocationAddressSelector, NativePreimageConfig]), "invalidInput");
const decodeAddressUpsertArguments = commerceDecoder(Schema.Tuple([StockLocationAddressUpserts]), "invalidInput");
const decodeLocationUpdateArguments = commerceDecoder(Schema.Tuple([StockLocationUpdateSelector, StockLocationRootUpdate]), "invalidInput");

/** Native forward closure only. Retained workflow compensators remain owned by
 * the outer atomic transaction; their extra service methods are not granted. */
export const makeStockLocationUpdateCommands = Effect.fn("StockLocationAdapter.updateCommands")(function* () {
  const metadata = yield* captureStockLocationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "stock_location");
    const address = metadata.frame.tables.find(table => table.name === "stock_location_address");
    if (table === undefined || address === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const prepared = yield* prepareStockLocationUpdateRepository(table, address);
    const contracts = yield* compileStockLocationUpdateContracts(table, address);
    const module = yield* defineCommerceModule({ name: "flarex-stock-location-update", models: [StockLocation, StockLocationAddress],
      profile: { name: "stock-location-update", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: typeof StockLocation | typeof StockLocationAddress) => model === StockLocation ? bound.repository : bound.addressRepository,
          events: bound.mutationEvents, eventBus };
      } }, extensions: {},
      service: ({ binding, dependencies, context }) => ({ service: new StockLocationModuleService({ ...dependencies, [Modules.EVENT_BUS]: binding.eventBus }, { scope: "internal" }), context }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("StockLocationUpdate.prepare");
    // SAFETY: native DTO/config annotations do not model selected preimages or
    // partial attached Address patches. Checked boundaries and complete DML
    // validation retain the actual persistence contract, including creation.
    const list = commands.read("stockLocationListForUpdate", prepare(commerceDecoder(StockLocationUpdateReadInput, "invalidInput")), ({ service, context }, args) =>
      service.listStockLocations(args.filters as FilterableStockLocationProps | undefined, args.config as FindConfig<StockLocationTypes.StockLocationDTO> | undefined, context));
    const count = commands.read("stockLocationCountForUpdate", prepare(commerceDecoder(StockLocationUpdateReadInput, "invalidInput")), ({ service, context }, args) =>
      service.listAndCountStockLocations(args.filters as FilterableStockLocationProps | undefined, args.config as FindConfig<StockLocationTypes.StockLocationDTO> | undefined, context));
    const listAddresses = commands.read("stockLocationAddressListForUpdate", prepare(commerceDecoder(StockLocationAddressReadInput, "invalidInput")), ({ service, context }, args) =>
      service.listStockLocationAddresses(args.filters, args.config as FindConfig<StockLocationTypes.StockLocationAddressDTO> | undefined, context));
    const upsertAddresses = commands.write("stockLocationAddressUpsertForWorkflow", prepare(decodeStockLocationAddressUpserts), ({ service, context }, rows) =>
      service.upsertStockLocationAddresses(rows as UpsertStockLocationAddressInput[], context));
    const updateBySelector = commands.write("stockLocationUpdateBySelector", prepare(decodeStockLocationRootUpdateInput), async ({ service, context }, args) =>
      encodeOptionalServiceResult(await service.updateStockLocations(args.selector as FilterableStockLocationProps, args.update as UpdateStockLocationInput, context)));
    const joiner = stockLocationStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases({ ...joiner,
      alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "StockLocation") }),
      reads: [{ model: "StockLocation", command: count, table: prepared.table,
        paths: [{ path: "address", table: prepared.address, many: false, optional: true }],
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] };
    const read = graph.reads[0];
    if (read === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const addressRead = { ...read, table: prepared.address, paths: [] };
    const listStockLocations = yield* defineWorkflowMethod({ command: list,
      arguments: decodeLocationListArguments,
      encode: ([filters, config]) => ({ filters, config: nativePreimageSelection(config, read) }), output: contracts.decodePreimages });
    const listStockLocationAddresses = yield* defineWorkflowMethod({ command: listAddresses,
      arguments: decodeAddressListArguments,
      encode: ([filters, config]) => ({ filters, config: nativePreimageSelection(config, addressRead) }), output: contracts.decodeAddressPreimages });
    const event = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: Modules.STOCK_LOCATION, objectName, action });
    const upsertStockLocationAddresses = yield* defineWorkflowMethod({ command: upsertAddresses,
      arguments: decodeAddressUpsertArguments, encode: ([rows]) => [...rows], output: contracts.decodeAddresses,
      moduleEvents: [event("stock_location_address", "created"), event("stock_location_address", "updated")] });
    const updateStockLocations = yield* defineWorkflowMethod({ command: updateBySelector,
      arguments: decodeLocationUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: contracts.decodeOutput, moduleEvents: [event("stock_location", "updated")] });
    const admitted = [list, count, listAddresses, upsertAddresses, updateBySelector];
    const workflow = yield* defineWorkflowModule({ name: Modules.STOCK_LOCATION, source: module.description,
      methods: { listStockLocations, listStockLocationAddresses, upsertStockLocationAddresses, updateStockLocations }, graph,
      logical: { ...stockLocationUpdateEventPolicy(contracts), commands: admitted } });
    return { list, count, listAddresses, upsertAddresses, updateBySelector, commands: admitted, workflow, graph, withService: module.use };
  }));
});
