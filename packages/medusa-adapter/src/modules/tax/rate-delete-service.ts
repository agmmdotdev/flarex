import { Effect, Result, Schema } from "effect";
import { TaxRate } from "@medusajs/tax/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureTaxMetadata } from "./schema";
import { defineTaxPersistenceModule, type TaxPersistenceModel } from "./module";
import { prepareTaxRateDeletionRepository } from "./rate-delete-repository";
import { TaxRateDeletionIds, decodeTaxRateDeletionIds, decodeTaxRateDeletionOutput } from "./rate-delete-input";
import { taxRateDeletionPolicy } from "./rate-delete-receipt";

const decodeArguments = commerceDecoder(Schema.Tuple([TaxRateDeletionIds]), "invalidInput");

/** Native Rate lifecycle methods retain their original requested selectors.
 * This separate Tax profile grants no creation, physical deletion or parent CRUD. */
export const makeTaxRateDeleteCommands = Effect.fn("TaxAdapter.rateDeletionCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxRateDeletionRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-rate-delete", profile: "tax.rateDelete",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: TaxPersistenceModel) =>
          model === TaxRate ? bound.rateRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ softDeleteTaxRates: native.softDeleteTaxRates.bind(native), restoreTaxRates: native.restoreTaxRates.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("TaxRateDeletion.prepare");
    const softDeleteForWorkflow = commands.write("taxRateSoftDeleteForWorkflow", prepare(decodeTaxRateDeletionIds),
      ({ service, context }, ids) => service.softDeleteTaxRates([...ids], {}, context));
    const restoreForWorkflow = commands.write("taxRateRestoreForWorkflow", prepare(decodeTaxRateDeletionIds),
      ({ service, context }, ids) => service.restoreTaxRates([...ids], {}, context));
    const softDeleteTaxRates = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeArguments,
      encode: ([ids]) => ids, output: decodeTaxRateDeletionOutput, moduleEvents: ["tax_rate", "tax_rate_rule"].flatMap(objectName =>
        ["deleted", "updated"].map(action => buildModuleResourceEventName({ prefix: Modules.TAX, objectName, action }))) });
    const restoreTaxRates = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeArguments,
      encode: ([ids]) => ids, output: decodeTaxRateDeletionOutput });
    const policy = taxRateDeletionPolicy(prepared.contracts), admitted = [softDeleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description, methods: { softDeleteTaxRates, restoreTaxRates },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, source: module.description,
      withService: module.use, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
