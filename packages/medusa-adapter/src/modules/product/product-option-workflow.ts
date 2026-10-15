import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import type { GraphReadCommand } from "../../local-graph/commands";
import { decodeGraphCount } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { ProductOptionCreateInput, ProductOptionUpdateData, ProductOptionIds, ProductOptionSelector,
  ProductOptionSoftDeleteOutput, decodeProductOptionOutput, decodeProductOptionPreimages } from "./option-input";

/** Genuine native Option methods share the Product owner and its Value graph. */
export function productOptionWorkflowModule(source: CommerceModuleDescription, commands: {
  readonly createOptions: CommerceCommand; readonly listOptions: CommerceCommand; readonly countOptions: GraphReadCommand;
  readonly updateOptionsBySelector: CommerceCommand; readonly softDeleteOptions: CommerceCommand;
}, graph: GraphModuleDefinition, events: {
  readonly created: string; readonly updated: string; readonly deleted: string;
  readonly valueCreated: string; readonly valueUpdated: string; readonly valueDeleted: string;
}, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const read = graph.reads.find(candidate => candidate.model === "ProductOption");
    if (read === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const createArguments = commerceDecoder(Schema.Tuple([ProductOptionCreateInput]), "invalidInput");
    const listArguments = commerceDecoder(Schema.Tuple([ProductOptionSelector, NativePreimageConfig]), "invalidInput");
    const updateArguments = commerceDecoder(Schema.Tuple([ProductOptionSelector, ProductOptionUpdateData]), "invalidInput");
    const deleteArguments = commerceDecoder(Schema.Tuple([ProductOptionIds]), "invalidInput");
    const deleted = commerceDecoder(ProductOptionSoftDeleteOutput, "storedCorruption");
    const createProductOptions = yield* defineWorkflowMethod({ command: commands.createOptions, arguments: createArguments,
      encode: ([options]) => options, output: decodeProductOptionOutput, moduleEvents: [events.created, events.valueCreated] });
    const listProductOptions = yield* defineWorkflowMethod({ command: commands.listOptions, arguments: listArguments,
      encode: ([filters, config]) => ({ filters, config: nativePreimageSelection(config, read) }), output: decodeProductOptionPreimages });
    const updateProductOptions = yield* defineWorkflowMethod({ command: commands.updateOptionsBySelector, arguments: updateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: decodeProductOptionOutput,
      moduleEvents: [events.updated, events.valueCreated, events.valueUpdated, events.valueDeleted] });
    const softDeleteProductOptions = yield* defineWorkflowMethod({ command: commands.softDeleteOptions, arguments: deleteArguments,
      encode: ([ids]) => ids, output: deleted, moduleEvents: [events.deleted, events.valueDeleted, events.valueUpdated] });
    const boundedGraph: GraphModuleDefinition = { ...graph, reads: graph.reads.map(candidate => candidate !== read ? candidate : { ...read, command: commands.countOptions,
      decode: value => decodeGraphCount(value).pipe(Result.flatMap(([rows, count]) => decodeProductOptionPreimages(rows).pipe(Result.map(decoded => [decoded, count] as const)))),
    }) };
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".product-option-workflows" },
      methods: { createProductOptions, listProductOptions, updateProductOptions, softDeleteProductOptions }, graph: boundedGraph, logical });
  });
}
export type ProductOptionWorkflowModule = Result.Result.Success<ReturnType<typeof productOptionWorkflowModule>>;
