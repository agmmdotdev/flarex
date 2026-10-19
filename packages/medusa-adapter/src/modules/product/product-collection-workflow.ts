import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { decodeGraphCount } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { ProductCollectionCreateInput, ProductCollectionUpdateData, ProductCollectionIds, ProductCollectionOutput, ProductCollectionSelector, ProductCollectionPreimages, ProductCollectionSoftDeleteOutput } from "./collection-input";

/** A named view of genuine Collection methods; physical Collection deletion remains separate. */
export function productCollectionWorkflowModule(source: CommerceModuleDescription, commands: {
  readonly createCollections: CommerceCommand; readonly listCollections: CommerceCommand;
  readonly updateCollectionsBySelector: CommerceCommand; readonly softDeleteCollections: CommerceCommand;
}, graph: GraphModuleDefinition, events: { readonly created: string; readonly updated: string; readonly deleted: string; readonly productUpdated: string }, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const read = graph.reads.find(candidate => candidate.model === "ProductCollection");
    if (read === undefined || read.result === "list") return yield* Result.fail(commerceError("unsupportedProfile"));
    const output = commerceDecoder(ProductCollectionOutput, "unsupportedProfile");
    const preimages = commerceDecoder(ProductCollectionPreimages, "unsupportedProfile");
    const createArguments = commerceDecoder(Schema.Tuple([ProductCollectionCreateInput]), "invalidInput");
    const listArguments = commerceDecoder(Schema.Tuple([ProductCollectionSelector, NativePreimageConfig]), "invalidInput");
    const updateArguments = commerceDecoder(Schema.Tuple([ProductCollectionSelector, ProductCollectionUpdateData]), "invalidInput");
    const deleteArguments = commerceDecoder(Schema.Tuple([ProductCollectionIds]), "invalidInput");
    const deleted = commerceDecoder(ProductCollectionSoftDeleteOutput, "storedCorruption");
    const createProductCollections = yield* defineWorkflowMethod({ command: commands.createCollections, arguments: createArguments,
      encode: ([collections]) => collections, output, moduleEvents: [events.created, events.productUpdated] });
    const listProductCollections = yield* defineWorkflowMethod({ command: commands.listCollections, arguments: listArguments,
      encode: ([filters, config]) => ({ filters, config: nativePreimageSelection(config, read, ["product_ids"]) }), output: preimages });
    const updateProductCollections = yield* defineWorkflowMethod({ command: commands.updateCollectionsBySelector, arguments: updateArguments,
      encode: ([selector, update]) => ({ selector, update }), output, moduleEvents: [events.updated, events.productUpdated] });
    const softDeleteProductCollections = yield* defineWorkflowMethod({ command: commands.softDeleteCollections, arguments: deleteArguments,
      encode: ([ids]) => ids, output: deleted, moduleEvents: [events.deleted] });
    const boundedGraph: GraphModuleDefinition = { ...graph, reads: graph.reads.map(candidate => candidate !== read ? candidate : { ...read,
      decode: value => decodeGraphCount(value).pipe(Result.flatMap(([rows, count]) => preimages(rows).pipe(Result.map(decoded => [decoded, count] as const)))),
    }) };
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".product-collection-workflows" },
      methods: { createProductCollections, listProductCollections, updateProductCollections, softDeleteProductCollections }, graph: boundedGraph, logical });
  });
}
export type ProductCollectionWorkflowModule = Result.Result.Success<ReturnType<typeof productCollectionWorkflowModule>>;
