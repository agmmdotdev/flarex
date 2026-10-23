import { Effect, Result, Schema } from "effect";
import { TaxRate, TaxRateRule } from "@medusajs/tax/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { NativePreimageConfig } from "../../workflow/preimage";
import { commerceDecoder } from "../../value/decoder";
import { captureTaxMetadata } from "./schema";
import { defineTaxPersistenceModule, type TaxPersistenceModel } from "./module";
import { TaxRateUpdateSelector, TaxRateUpdateData, TaxRateUpdateUpserts,
  decodeTaxRateUpdateInput, decodeTaxRateUpdateRead, decodeTaxRateUpdateUpserts } from "./rate-update-input";
import { prepareTaxRateUpdateRepository } from "./rate-update-repository";
import { taxRateUpdatePolicy } from "./rate-update-receipt";
import { TaxRuleCreatesInput, TaxRulePhysicalDeletionIds, decodeTaxRuleCreates, decodeTaxRulePhysicalDeletionIds } from "./rule-create-input";
import { TaxRuleDeletionIds, decodeTaxRuleDeletionIds, decodeTaxRuleDeletionOutput } from "./rule-delete-input";
import { TaxRuleReplacementFilters, TaxRuleReplacementConfig, decodeTaxRuleReplacementRead, decodeTaxRuleReplacementIds } from "./rule-replacement-input";
import { prepareTaxRuleReplacementRepository } from "./rule-replacement-repository";

const decodeListArguments = commerceDecoder(Schema.Tuple([TaxRateUpdateSelector, NativePreimageConfig]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([TaxRateUpdateSelector, TaxRateUpdateData]), "invalidInput");
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([TaxRateUpdateUpserts]), "invalidInput");
const decodeRuleListArguments = commerceDecoder(Schema.Tuple([TaxRuleReplacementFilters, TaxRuleReplacementConfig]), "invalidInput");
const decodeRuleCreateArguments = commerceDecoder(Schema.Tuple([TaxRuleCreatesInput]), "invalidInput");
const decodeRuleDeleteArguments = commerceDecoder(Schema.Tuple([TaxRulePhysicalDeletionIds]), "invalidInput");
const decodeRuleLifecycleArguments = commerceDecoder(Schema.Tuple([TaxRuleDeletionIds]), "invalidInput");

/** One native service and request bridge own the connected Rate update, Rule
 * replacement and retained callbacks. No Region or provider write is granted. */
export const makeTaxRateUpdateCommands = Effect.fn("TaxAdapter.rateUpdateCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxRateUpdateRepository(metadata.frame);
    const rules = yield* prepareTaxRuleReplacementRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-rate-update", profile: "tax.rateUpdate",
      bind: (ctx, owner) => {
        const rates = prepared.bind(ctx, owner), boundRules = rules.bind(ctx, owner, rates.events, rates.bridge);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => rates.bridge.current().captureLocalEvent(message), check: work => rates.bridge.checked(ctx, work), refuse: rates.refuse });
        return { baseRepository: rates.repository, repository: (model: TaxPersistenceModel) =>
          model === TaxRate ? rates.rateRepository : model === TaxRateRule ? boundRules.ruleRepository : rates.denied,
          events: rates.mutationEvents, eventBus };
      }, service: native => ({ listTaxRates: native.listTaxRates.bind(native), updateTaxRates: native.updateTaxRates.bind(native),
        upsertTaxRates: native.upsertTaxRates.bind(native), listTaxRateRules: native.listTaxRateRules.bind(native),
        createTaxRateRules: native.createTaxRateRules.bind(native), deleteTaxRateRules: native.deleteTaxRateRules.bind(native),
        softDeleteTaxRateRules: native.softDeleteTaxRateRules.bind(native), restoreTaxRateRules: native.restoreTaxRateRules.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("TaxRateUpdate.prepare");
    const listForWorkflow = commands.read("taxRateListForUpdate", prepare(decodeTaxRateUpdateRead),
      ({ service, context }, input) => service.listTaxRates(input.filters, {
        ...(input.config.select === undefined ? {} : { select: [...input.config.select] }),
        ...(input.config.relations === undefined ? {} : { relations: [...input.config.relations] }),
      }, context));
    const updateForWorkflow = commands.write("taxRateUpdateForWorkflow", prepare(decodeTaxRateUpdateInput),
      async ({ service, context }, input) => await Reflect.apply(service.updateTaxRates, service, [input.selector, input.update, context]));
    const upsertForWorkflow = commands.write("taxRateUpsertForUpdateInverse", prepare(decodeTaxRateUpdateUpserts),
      async ({ service, context }, input) => await Reflect.apply(service.upsertTaxRates, service, [input, context]));
    const listRulesForWorkflow = commands.read("taxRuleListForReplacement", prepare(decodeTaxRuleReplacementRead),
      ({ service, context }, input) => service.listTaxRateRules(input.filters, input.config, context));
    const createRulesForWorkflow = commands.write("taxRuleCreateForWorkflow", prepare(decodeTaxRuleCreates),
      async ({ service, context }, input) => await Reflect.apply(service.createTaxRateRules, service, [input, context]));
    const deleteRulesForWorkflow = commands.write("taxRulePhysicalDeleteForWorkflow", prepare(decodeTaxRulePhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const output = await service.deleteTaxRateRules([...ids], context);
        if (output !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const softDeleteRulesForWorkflow = commands.write("taxRuleSoftDeleteForWorkflow", prepare(decodeTaxRuleDeletionIds),
      ({ service, context }, ids) => service.softDeleteTaxRateRules([...ids], {}, context));
    const restoreRulesForWorkflow = commands.write("taxRuleRestoreForWorkflow", prepare(decodeTaxRuleDeletionIds),
      ({ service, context }, ids) => service.restoreTaxRateRules([...ids], {}, context));
    const event = (objectName: "tax_rate" | "tax_rate_rule", action: "created" | "updated" | "deleted") =>
      buildModuleResourceEventName({ prefix: Modules.TAX, objectName, action });
    const listTaxRates = yield* defineWorkflowMethod({ command: listForWorkflow, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const updateTaxRates = yield* defineWorkflowMethod({ command: updateForWorkflow, arguments: decodeUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: prepared.contracts.decodeRows, moduleEvents: [event("tax_rate", "updated")] });
    const upsertTaxRates = yield* defineWorkflowMethod({ command: upsertForWorkflow, arguments: decodeUpsertArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeUpsertRows,
      moduleEvents: [event("tax_rate", "created"), event("tax_rate", "updated")] });
    const listTaxRateRules = yield* defineWorkflowMethod({ command: listRulesForWorkflow, arguments: decodeRuleListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeTaxRuleReplacementIds });
    const createTaxRateRules = yield* defineWorkflowMethod({ command: createRulesForWorkflow, arguments: decodeRuleCreateArguments,
      encode: ([input]) => input, output: rules.contracts.decodeOutput, moduleEvents: [event("tax_rate_rule", "created")] });
    const deleteTaxRateRules = yield* defineWorkflowMethod({ command: deleteRulesForWorkflow, arguments: decodeRuleDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [event("tax_rate_rule", "deleted")] });
    const softDeleteTaxRateRules = yield* defineWorkflowMethod({ command: softDeleteRulesForWorkflow, arguments: decodeRuleLifecycleArguments,
      encode: ([ids]) => ids, output: decodeTaxRuleDeletionOutput, moduleEvents: [event("tax_rate_rule", "deleted")] });
    const restoreTaxRateRules = yield* defineWorkflowMethod({ command: restoreRulesForWorkflow, arguments: decodeRuleLifecycleArguments,
      encode: ([ids]) => ids, output: decodeTaxRuleDeletionOutput });
    const admitted = [listForWorkflow, updateForWorkflow, upsertForWorkflow, listRulesForWorkflow, createRulesForWorkflow,
      deleteRulesForWorkflow, softDeleteRulesForWorkflow, restoreRulesForWorkflow];
    const policy = taxRateUpdatePolicy(prepared, rules);
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description,
      methods: { listTaxRates, updateTaxRates, upsertTaxRates, listTaxRateRules, createTaxRateRules, deleteTaxRateRules, softDeleteTaxRateRules, restoreTaxRateRules },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { listForWorkflow, updateForWorkflow, upsertForWorkflow, commands: admitted, workflow, source: module.description,
      withService: module.use, contracts: prepared.contracts, prepared, rules, logicalEventPolicy: () => policy };
  }));
});
