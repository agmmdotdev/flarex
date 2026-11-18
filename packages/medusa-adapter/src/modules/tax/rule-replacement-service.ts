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
import { TaxRuleCreatesInput, TaxRulePhysicalDeletionIds, decodeTaxRuleCreates, decodeTaxRulePhysicalDeletionIds } from "./rule-create-input";
import { TaxRuleDeletionIds, decodeTaxRuleDeletionIds, decodeTaxRuleDeletionOutput } from "./rule-delete-input";
import { TaxRuleReplacementFilters, TaxRuleReplacementConfig, decodeTaxRuleReplacementRead, decodeTaxRuleReplacementIds } from "./rule-replacement-input";
import { prepareTaxRuleReplacementRepository } from "./rule-replacement-repository";
import { taxRuleReplacementPolicy } from "./rule-replacement-receipt";

const decodeListArguments = commerceDecoder(Schema.Tuple([TaxRuleReplacementFilters, TaxRuleReplacementConfig]), "invalidInput");
const decodeCreateArguments = commerceDecoder(Schema.Tuple([TaxRuleCreatesInput]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([TaxRulePhysicalDeletionIds]), "invalidInput");
const decodeLifecycleArguments = commerceDecoder(Schema.Tuple([TaxRuleDeletionIds]), "invalidInput");

/** Replacement has one native Tax service, repository bridge and participant.
 * List, creation and both retained inverses retain their native empty branches. */
export const makeTaxRuleReplacementCommands = Effect.fn("TaxAdapter.ruleReplacementCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxRuleReplacementRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-rule-replacement", profile: "tax.ruleReplacement",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: TaxPersistenceModel) =>
          model === TaxRateRule ? bound.ruleRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listTaxRateRules: native.listTaxRateRules.bind(native), createTaxRateRules: native.createTaxRateRules.bind(native),
        deleteTaxRateRules: native.deleteTaxRateRules.bind(native), softDeleteTaxRateRules: native.softDeleteTaxRateRules.bind(native),
        restoreTaxRateRules: native.restoreTaxRateRules.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("TaxRuleReplacement.prepare");
    const listForWorkflow = commands.read("taxRuleListForReplacement", prepare(decodeTaxRuleReplacementRead),
      ({ service, context }, input) => service.listTaxRateRules(input.filters, input.config, context));
    const createForWorkflow = commands.write("taxRuleCreateForWorkflow", prepare(decodeTaxRuleCreates),
      async ({ service, context }, input) => await Reflect.apply(service.createTaxRateRules, service, [input, context]));
    const deleteForWorkflow = commands.write("taxRulePhysicalDeleteForWorkflow", prepare(decodeTaxRulePhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteTaxRateRules([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const softDeleteForWorkflow = commands.write("taxRuleSoftDeleteForWorkflow", prepare(decodeTaxRuleDeletionIds),
      ({ service, context }, ids) => service.softDeleteTaxRateRules([...ids], {}, context));
    const restoreForWorkflow = commands.write("taxRuleRestoreForWorkflow", prepare(decodeTaxRuleDeletionIds),
      ({ service, context }, ids) => service.restoreTaxRateRules([...ids], {}, context));
    const eventName = (action: "created" | "deleted") => buildModuleResourceEventName({ prefix: Modules.TAX, objectName: "tax_rate_rule", action });
    const listTaxRateRules = yield* defineWorkflowMethod({ command: listForWorkflow, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeTaxRuleReplacementIds });
    const createTaxRateRules = yield* defineWorkflowMethod({ command: createForWorkflow, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeOutput, moduleEvents: [eventName("created")] });
    const deleteTaxRateRules = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [eventName("deleted")] });
    const softDeleteTaxRateRules = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeLifecycleArguments,
      encode: ([ids]) => ids, output: decodeTaxRuleDeletionOutput, moduleEvents: [eventName("deleted")] });
    const restoreTaxRateRules = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeLifecycleArguments,
      encode: ([ids]) => ids, output: decodeTaxRuleDeletionOutput });
    const policy = taxRuleReplacementPolicy(prepared), admitted = [listForWorkflow, createForWorkflow, deleteForWorkflow, softDeleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description,
      methods: { listTaxRateRules, createTaxRateRules, deleteTaxRateRules, softDeleteTaxRateRules, restoreTaxRateRules },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { listForWorkflow, createForWorkflow, deleteForWorkflow, softDeleteForWorkflow, restoreForWorkflow, commands: admitted,
      workflow, source: module.description, withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
