import { Effect, Result, Schema } from "effect";
import { TaxRegion, TaxRate, TaxRateRule } from "@medusajs/tax/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureTaxMetadata } from "./schema";
import { defineTaxPersistenceModule, type TaxPersistenceModel } from "./module";
import { prepareTaxRegionCreationRepository } from "./region-create-repository";
import { taxRegionCreationPolicy } from "./region-create-receipt";

/** Genuine native Region creation owns its nested Rate/Rule dispatch. The
 * explicit manager-only entry lets its native transaction decorator select the
 * existing borrowed module callback/flush boundary inside the one outer root. */
export const makeTaxRegionCreateCommands = Effect.fn("TaxAdapter.regionCreationCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxRegionCreationRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-region-create", profile: "tax.regionCreate",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.baseRepository, repository: (model: TaxPersistenceModel) =>
          model === TaxRegion ? bound.regionRepository : model === TaxRate ? bound.rateRepository
            : model === TaxRateRule ? bound.ruleRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ createTaxRegions: native.createTaxRegions.bind(native), deleteTaxRegions: native.deleteTaxRegions.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("TaxRegionCreation.prepare");
    const createForWorkflow = commands.write("taxRegionCreateForWorkflow", prepare(prepared.contracts.decodeInput),
      async ({ service, context }, input) => await Reflect.apply(service.createTaxRegions, service, [input, { manager: context.manager }]));
    const deleteForWorkflow = commands.write("taxRegionPhysicalDeleteForWorkflow", prepare(prepared.contracts.decodePhysicalIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteTaxRegions([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const eventName = (objectName: string, action: "created" | "deleted") => buildModuleResourceEventName({ prefix: Modules.TAX, objectName, action });
    const decodeCreateArguments = commerceDecoder(Schema.Tuple([prepared.contracts.Input]), "invalidInput");
    const decodeDeleteArguments = commerceDecoder(Schema.Tuple([prepared.contracts.PhysicalIds]), "invalidInput");
    const createTaxRegions = yield* defineWorkflowMethod({ command: createForWorkflow,
      arguments: decodeCreateArguments, encode: ([input]) => input,
      output: prepared.contracts.decodeOutput,
      moduleEvents: [eventName("tax_region", "created"), eventName("tax_rate", "created"), eventName("tax_rate_rule", "created")] });
    const deleteTaxRegions = yield* defineWorkflowMethod({ command: deleteForWorkflow,
      arguments: decodeDeleteArguments, encode: ([ids]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [eventName("tax_region", "deleted")] });
    const policy = taxRegionCreationPolicy(prepared.contracts), admitted = [createForWorkflow, deleteForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description, methods: { createTaxRegions, deleteTaxRegions },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { createForWorkflow, deleteForWorkflow, commands: admitted, workflow, source: module.description,
      withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
