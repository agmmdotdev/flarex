import { Effect, Result, Schema } from "effect";
import { TaxRate, TaxRateRule } from "@medusajs/tax/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureTaxMetadata } from "./schema";
import { defineTaxPersistenceModule, type TaxPersistenceModel } from "./module";
import { prepareTaxRateCreationRepository } from "./rate-create-repository";
import { TaxRateCreatesInput, TaxRatePhysicalDeletionIds, decodeTaxRateCreates, decodeTaxRatePhysicalDeletionIds } from "./rate-create-input";
import { taxRateCreationPolicy } from "./rate-create-receipt";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([TaxRateCreatesInput]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([TaxRatePhysicalDeletionIds]), "invalidInput");

/** Genuine native Tax service and shared construction, with only bounded Rate
 * creation and its physical inverse granted to the trusted workflow owner. */
export const makeTaxRateCreateCommands = Effect.fn("TaxAdapter.rateCreationCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxRateCreationRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-rate-create", profile: "tax.rateCreate",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: TaxPersistenceModel) =>
          model === TaxRate ? bound.rateRepository : model === TaxRateRule ? bound.ruleRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ createTaxRates: native.createTaxRates.bind(native), deleteTaxRates: native.deleteTaxRates.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("TaxRateCreation.prepare");
    const createForWorkflow = commands.write("taxRateCreateForWorkflow", prepare(decodeTaxRateCreates),
      // Runtime DML also admits managed fields and is_combinable, omitted from
      // the narrower public DTO. The native callable retains its actual shape.
      async ({ service, context }, input) => await Reflect.apply(service.createTaxRates, service, [input, context]));
    const deleteForWorkflow = commands.write("taxRatePhysicalDeleteForWorkflow", prepare(decodeTaxRatePhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteTaxRates([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const eventName = (objectName: string, action: "created" | "deleted") => buildModuleResourceEventName({ prefix: Modules.TAX, objectName, action });
    const createTaxRates = yield* defineWorkflowMethod({ command: createForWorkflow, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeOutput,
      moduleEvents: [eventName("tax_rate", "created"), eventName("tax_rate_rule", "created")] });
    const deleteTaxRates = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [eventName("tax_rate", "deleted")] });
    const policy = taxRateCreationPolicy(prepared.contracts), admitted = [createForWorkflow, deleteForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description, methods: { createTaxRates, deleteTaxRates },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { createForWorkflow, deleteForWorkflow, commands: admitted, workflow, source: module.description,
      withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
