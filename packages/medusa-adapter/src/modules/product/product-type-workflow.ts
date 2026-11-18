import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { decodeGraphCount } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { ProductTypeCreateInput, ProductTypeUpdateData, ProductTypeIds, ProductTypeOutput, ProductTypeSelector, ProductTypePreimages, ProductTypeSoftDeleteOutput } from "./type-input";

/** A named view of genuine Type methods; physical Type deletion remains separate. */
export function productTypeWorkflowModule(source: CommerceModuleDescription, commands: {
  readonly createTypes: CommerceCommand; readonly listTypes: CommerceCommand;
  readonly updateTypesBySelector: CommerceCommand; readonly softDeleteTypes: CommerceCommand;
}, graph: GraphModuleDefinition, events: { readonly created: string; readonly updated: string; readonly deleted: string }, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const read = graph.reads.find(candidate => candidate.model === "ProductType");
    if (read === undefined || read.result === "list") return yield* Result.fail(commerceError("unsupportedProfile"));
    const output = commerceDecoder(ProductTypeOutput, "unsupportedProfile");
    const preimages = commerceDecoder(ProductTypePreimages, "unsupportedProfile");
    const createArguments = commerceDecoder(Schema.Tuple([ProductTypeCreateInput]), "invalidInput");
    const listArguments = commerceDecoder(Schema.Tuple([ProductTypeSelector, NativePreimageConfig]), "invalidInput");
    const updateArguments = commerceDecoder(Schema.Tuple([ProductTypeSelector, ProductTypeUpdateData]), "invalidInput");
    const deleteArguments = commerceDecoder(Schema.Tuple([ProductTypeIds]), "invalidInput");
    const deleted = commerceDecoder(ProductTypeSoftDeleteOutput, "storedCorruption");
    const createProductTypes = yield* defineWorkflowMethod({ command: commands.createTypes, arguments: createArguments,
      encode: ([types]) => types, output, moduleEvents: [events.created] });
    const listProductTypes = yield* defineWorkflowMethod({ command: commands.listTypes, arguments: listArguments,
      encode: ([filters, config]) => ({ filters, config: nativePreimageSelection(config, read) }), output: preimages });
    const updateProductTypes = yield* defineWorkflowMethod({ command: commands.updateTypesBySelector, arguments: updateArguments,
      encode: ([selector, update]) => ({ selector, update }), output, moduleEvents: [events.updated] });
    const softDeleteProductTypes = yield* defineWorkflowMethod({ command: commands.softDeleteTypes, arguments: deleteArguments,
      encode: ([ids]) => ids, output: deleted, moduleEvents: [events.deleted] });
    const boundedGraph: GraphModuleDefinition = { ...graph, reads: graph.reads.map(candidate => candidate !== read ? candidate : { ...read,
      decode: value => decodeGraphCount(value).pipe(Result.flatMap(([rows, count]) => preimages(rows).pipe(Result.map(decoded => [decoded, count] as const)))),
    }) };
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".product-type-workflows" },
      methods: { createProductTypes, listProductTypes, updateProductTypes, softDeleteProductTypes }, graph: boundedGraph, logical });
  });
}
export type ProductTypeWorkflowModule = Result.Result.Success<ReturnType<typeof productTypeWorkflowModule>>;
