import { Effect, Result, Schema } from "effect";
import { Country, Region } from "@medusajs/region/models";
import { regionStaticResources } from "@medusajs/region/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import type { FindConfig, RegionDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import { commerceDecoder } from "../../value/decoder";
import { captureRegionMetadata } from "./schema";
import { RegionFilters, RegionReadConfig, decodeRegionReadInput } from "./input";
import { prepareRegionReadRepository } from "./repository";
import { regionReadPolicy } from "./receipt";
import { defineRegionReadModule } from "./module";

const readArguments = commerceDecoder(Schema.Union([Schema.Tuple([RegionFilters]),
  Schema.Tuple([RegionFilters, Schema.Union([RegionReadConfig, Schema.Undefined])])]), "invalidInput");

/** Genuine Region list methods only. Native full reads omit countries rather
 * than inventing a loaded empty relation. Country storage and CRUD stay denied. */
export const makeLocalRegionReadCommands = Effect.fn("RegionAdapter.readCommands")(function* () {
  const metadata = yield* captureRegionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareRegionReadRepository(metadata.frame);
    const module = yield* defineRegionReadModule({ name: "flarex-region-read", profile: "region-shipping-option-read", bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: typeof Region | typeof Country) => model === Region ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("RegionRead.prepare")(decodeRegionReadInput);
    // Checked DML selects actual field names; DTO keys are a compile-time ABI.
    const list = commands.read("regionListForShippingOptions", prepare, ({ service, context }, input) =>
      service.listRegions(input.filters, input.config as FindConfig<RegionDTO> | undefined, context));
    const count = commands.read("regionCountForShippingOptions", prepare, ({ service, context }, input) =>
      service.listAndCountRegions(input.filters, input.config as FindConfig<RegionDTO> | undefined, context));
    const listRegions = yield* defineWorkflowMethod({ command: list, arguments: readArguments,
      encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: prepared.contracts.decodeProjection });
    const joiner = regionStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "Region") });
    const graph = yield* scalarGraphDefinition(aliases, "Region", count, prepared.table), policy = regionReadPolicy(prepared), admitted = [list, count];
    const workflow = yield* defineWorkflowModule({ name: Modules.REGION, source: module.description, methods: { listRegions }, graph,
      logical: { ...policy, commands: admitted } });
    return { list, count, commands: admitted, workflow, graph, contracts: prepared.contracts, withService: module.use, logicalEventPolicy: () => policy };
  }));
});
