import { Effect, Result } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { captureTaxMetadata } from "./schema";
import { defineTaxLinesPersistenceModule } from "./module";
import { decodeTaxLinesArguments, decodeTaxLinesCommandInput, decodeTaxLinesOutput } from "./input";
import { taxLinesReadPolicy } from "./receipt";

/** One genuine native Tax call owns all its local reads and provider work. */
export const makeTaxLinesCommands = Effect.fn("TaxAdapter.itemTaxLinesCommands")(function* (logger: Logger) {
  const metadata = yield* captureTaxMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const { module, prepared } = yield* defineTaxLinesPersistenceModule(metadata.frame, logger);
    const commands = commerceServiceCommands(module.use);
    const getTaxLines = commands.read("taxGetItemTaxLines", commerceCommandPreparation("Tax.prepareItemTaxLines")(decodeTaxLinesCommandInput),
      async ({ native, context }, input) => {
        // The native step permits own undefined/null custom-line references
        // beyond its narrower DTO aliases. The checked method grammar preserves
        // those values at this genuine foreign callable boundary.
        return await Reflect.apply(native.getTaxLines, native, [[...input.items], input.context, context]);
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
