import { Effect, Result, Schema } from "effect";
import { Country, Region } from "@medusajs/region/models";
import { regionStaticResources } from "@medusajs/region/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import type { FilterableRegionProps, FindConfig, RegionDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { captureRegionMetadata } from "./schema";
import { RegionCartFilters, RegionCartReadConfig, decodeRegionCartReadInput } from "./cart-read-input";
import { prepareRegionCartReadRepository } from "./cart-read-repository";
import { regionCartReadPolicy } from "./cart-read-receipt";
import { defineRegionReadModule } from "./module";

const readArguments = commerceDecoder(Schema.Union([Schema.Tuple([]), Schema.Tuple([Schema.Union([RegionCartFilters, Schema.Undefined])]),
  Schema.Tuple([Schema.Union([RegionCartFilters, Schema.Undefined]), Schema.Union([RegionCartReadConfig, Schema.Undefined])])]), "invalidInput");

/** Native Cart context Region reads with checked Country population. Country
 * direct methods and all mutations remain denied by this named capability. */
export const makeLocalRegionCartReadCommands = Effect.fn("RegionAdapter.cartReadCommands")(function* () {
  const metadata = yield* captureRegionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareRegionCartReadRepository(metadata.frame);
    const module = yield* defineRegionReadModule({ name: "flarex-region-cart-read", profile: "region-cart-context-read", bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: typeof Region | typeof Country) => model === Region ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("RegionCartRead.prepare")(decodeRegionCartReadInput);
    // Native Cart forwards Store.default_region_id even when it is null. The
    // DAL preserves that null selector; the DTO filter type omits this branch.
    const list = commands.read("regionListForCart", prepare, ({ service, context }, input) =>
      service.listRegions(input.filters as FilterableRegionProps | undefined, input.config as FindConfig<RegionDTO> | undefined, context));
    const count = commands.read("regionCountForCart", prepare, ({ service, context }, input) =>
      service.listAndCountRegions(input.filters as FilterableRegionProps | undefined, input.config as FindConfig<RegionDTO> | undefined, context));
    const listRegions = yield* defineWorkflowMethod({ command: list, arguments: readArguments,
      encode: ([filters, config]) => ({ ...(filters === undefined ? {} : { filters }), ...(config === undefined ? {} : { config }) }), output: prepared.contracts.decodeProjection });
    const joiner = regionStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "Region") });
    const graph = { aliases, reads: [{ model: "Region", command: count, table: prepared.table,
      paths: yield* relationPaths(prepared.catalog, prepared.table.name, ["countries"], { nativeFields: true }),
      orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] };
    const policy = regionCartReadPolicy(prepared), admitted = [list, count];
    const workflow = yield* defineWorkflowModule({ name: Modules.REGION, source: module.description, methods: { listRegions }, graph,
      logical: { ...policy, commands: admitted } });
    return { list, count, commands: admitted, workflow, graph, contracts: prepared.contracts, withService: module.use, logicalEventPolicy: () => policy };
  }));
});
