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
import { prepareTaxRuleDeletionRepository } from "./rule-delete-repository";
import { TaxRuleDeletionIds, decodeTaxRuleDeletionIds, decodeTaxRuleDeletionOutput } from "./rule-delete-input";
import { taxRuleDeletionPolicy } from "./rule-delete-receipt";

const decodeArguments = commerceDecoder(Schema.Tuple([TaxRuleDeletionIds]), "invalidInput");

/** Native Rule lifecycle methods retain their original requested selectors.
 * This separate Tax profile grants no creation, physical deletion or parent CRUD. */
export const makeTaxRuleDeleteCommands = Effect.fn("TaxAdapter.ruleDeletionCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxRuleDeletionRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-rule-delete", profile: "tax.ruleDelete",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: TaxPersistenceModel) =>
          model === TaxRateRule ? bound.ruleRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ softDeleteTaxRateRules: native.softDeleteTaxRateRules.bind(native), restoreTaxRateRules: native.restoreTaxRateRules.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("TaxRuleDeletion.prepare");
    const softDeleteForWorkflow = commands.write("taxRuleSoftDeleteForWorkflow", prepare(decodeTaxRuleDeletionIds),
      ({ service, context }, ids) => service.softDeleteTaxRateRules([...ids], {}, context));
    const restoreForWorkflow = commands.write("taxRuleRestoreForWorkflow", prepare(decodeTaxRuleDeletionIds),
      ({ service, context }, ids) => service.restoreTaxRateRules([...ids], {}, context));
    const softDeleteTaxRateRules = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeArguments,
      encode: ([ids]) => ids, output: decodeTaxRuleDeletionOutput, moduleEvents: [buildModuleResourceEventName({
        prefix: Modules.TAX, objectName: "tax_rate_rule", action: "deleted" })] });
    const restoreTaxRateRules = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeArguments,
      encode: ([ids]) => ids, output: decodeTaxRuleDeletionOutput });
    const policy = taxRuleDeletionPolicy(prepared.contracts), admitted = [softDeleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description, methods: { softDeleteTaxRateRules, restoreTaxRateRules },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, source: module.description,
      withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
