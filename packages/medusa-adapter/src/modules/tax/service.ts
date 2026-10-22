import { Effect, Result } from "effect";
import { TaxRate, TaxRegion } from "@medusajs/tax/models";
import { Modules } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { captureTaxMetadata } from "./schema";
import { defineTaxPersistenceModule, type TaxPersistenceModel } from "./module";
import { prepareTaxLinesRepository } from "./repository";
import { decodeTaxLinesArguments, decodeTaxLinesCommandInput, decodeTaxLinesOutput } from "./input";
import { taxLinesReadPolicy } from "./receipt";

/** One genuine native Tax call owns all its local reads and provider work. */
export const makeTaxLinesCommands = Effect.fn("TaxAdapter.itemTaxLinesCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareTaxLinesRepository(metadata.frame);
    const module = yield* defineTaxPersistenceModule({ name: "flarex-tax-item-lines", profile: "tax.itemTaxLines",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: TaxPersistenceModel) =>
          model === TaxRegion ? bound.regionRepository : model === TaxRate ? bound.rateRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ getTaxLines: native.getTaxLines.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use);
    const getTaxLines = commands.read("taxGetItemTaxLines", commerceCommandPreparation("Tax.prepareItemTaxLines")(decodeTaxLinesCommandInput),
      async ({ service, context }, input) => {
        // The native step permits own undefined/null custom-line references
        // beyond its narrower DTO aliases. The checked method grammar preserves
        // those values at this genuine foreign callable boundary.
        return await Reflect.apply(service.getTaxLines, service, [[...input.items], input.context, context]);
      });
    const method = yield* defineWorkflowMethod({ command: getTaxLines, arguments: decodeTaxLinesArguments,
      inputPresence: "preserveOwnUndefined", encode: ([items, context]) => ({ items, context }), output: decodeTaxLinesOutput });
    const policy = taxLinesReadPolicy(prepared), admitted = [getTaxLines];
    const workflow = yield* defineWorkflowModule({ name: Modules.TAX, source: module.description, methods: { getTaxLines: method },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { getTaxLines, commands: admitted, workflow, source: module.description, withService: module.use,
      contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});
