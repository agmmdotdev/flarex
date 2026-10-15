import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import type { GraphReadCommand } from "../../local-graph/commands";
import { decodeGraphCount } from "../../local-graph/query";
import { NativePreimageConfig } from "../../workflow/preimage";
import { ProductUpdatePreimages } from "./product-update-input";
import { ProductDeletionIds } from "./commands/deletion";

export function productDeletionWorkflowModule(source: CommerceModuleDescription, commands: {
  readonly list: CommerceCommand; readonly softDeleteProducts: CommerceCommand; readonly softDeleteVariants: CommerceCommand;
  readonly countVariants: GraphReadCommand;
}, graph: GraphModuleDefinition, events: { readonly product: readonly string[]; readonly variant: string }, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const products = graph.reads.find(read => read.model === "Product"), variants = graph.reads.find(read => read.model === "ProductVariant");
    if (!products || !variants) return yield* Result.fail(commerceError("unsupportedProfile"));
    const preimages = commerceDecoder(ProductUpdatePreimages, "unsupportedProfile");
    const readArguments = commerceDecoder(Schema.Tuple([Schema.Struct({ id: ProductDeletionIds }), NativePreimageConfig]), "invalidInput");
    const deleteArguments = commerceDecoder(Schema.Tuple([ProductDeletionIds]), "invalidInput");
    const output = commerceDecoder(Schema.Union([Schema.Null, Schema.Record(Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(36)))]), "storedCorruption");
    const listProducts = yield* defineWorkflowMethod({ command: commands.list, arguments: readArguments,
      encode: ([filters, config]) => ({ filters, config }), output: preimages });
    const softDeleteProducts = yield* defineWorkflowMethod({ command: commands.softDeleteProducts, arguments: deleteArguments,
      encode: ([ids]) => ids, output, moduleEvents: events.product });
    const softDeleteProductVariants = yield* defineWorkflowMethod({ command: commands.softDeleteVariants, arguments: deleteArguments,
      encode: ([ids]) => ids, output, moduleEvents: [events.variant] });
    const inverse = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(32)), "unsupportedProfile");
    const boundedGraph: GraphModuleDefinition = { aliases: graph.aliases.filter(alias => ["Product", "ProductVariant"].includes(alias.model)), reads: [
      { ...products, decode: value => decodeGraphCount(value).pipe(Result.flatMap(([rows, count]) => preimages(rows).pipe(Result.map(rows => [rows, count] as const)))) },
      { ...variants, command: commands.countVariants, decode: value => decodeGraphCount(value).pipe(Result.flatMap(([rows, count]) => inverse(rows).pipe(Result.map(rows => [rows, count] as const)))) },
    ] };
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".product-deletion" },
      methods: { listProducts, softDeleteProducts, softDeleteProductVariants }, graph: boundedGraph, logical });
  });
}
export type ProductDeletionWorkflowModule = Result.Result.Success<ReturnType<typeof productDeletionWorkflowModule>>;
