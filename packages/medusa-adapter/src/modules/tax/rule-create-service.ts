import { Effect, Result, Schema } from "effect";
import { TaxRateRule } from "@medusajs/tax/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureTaxMetadata } from "./schema";
import { defineTaxPersistenceModule, type TaxPersistenceModel } from "./module";
import { prepareTaxRuleCreationRepository } from "./rule-create-repository";
import { TaxRuleCreatesInput, TaxRulePhysicalDeletionIds, decodeTaxRuleCreates, decodeTaxRulePhysicalDeletionIds } from "./rule-create-input";
import { taxRuleCreationPolicy } from "./rule-create-receipt";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([TaxRuleCreatesInput]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([TaxRulePhysicalDeletionIds]), "invalidInput");

/** Confined native Rule creation and its retained physical inverse share the
 * Tax construction owner; no Rate, Region or Provider repository is granted. */
export const makeTaxRuleCreateCommands = Effect.fn("TaxAdapter.ruleCreationCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxRuleCreationRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-rule-create", profile: "tax.ruleCreate",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: TaxPersistenceModel) =>
          model === TaxRateRule ? bound.ruleRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ createTaxRateRules: native.createTaxRateRules.bind(native), deleteTaxRateRules: native.deleteTaxRateRules.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("TaxRuleCreation.prepare");
    const createForWorkflow = commands.write("taxRuleCreateForWorkflow", prepare(decodeTaxRuleCreates),
      // Native DML admits managed values and general JSON metadata beyond the
      // public DTO. Reflect preserves the genuine callable's runtime contract.
      async ({ service, context }, input) => await Reflect.apply(service.createTaxRateRules, service, [input, context]));
    const deleteForWorkflow = commands.write("taxRulePhysicalDeleteForWorkflow", prepare(decodeTaxRulePhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteTaxRateRules([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const eventName = (action: "created" | "deleted") => buildModuleResourceEventName({ prefix: Modules.TAX, objectName: "tax_rate_rule", action });
    const createTaxRateRules = yield* defineWorkflowMethod({ command: createForWorkflow, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeOutput, moduleEvents: [eventName("created")] });
    const deleteTaxRateRules = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [eventName("deleted")] });
    const policy = taxRuleCreationPolicy(prepared.contracts), admitted = [createForWorkflow, deleteForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description, methods: { createTaxRateRules, deleteTaxRateRules },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { createForWorkflow, deleteForWorkflow, commands: admitted, workflow, source: module.description,
      withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
