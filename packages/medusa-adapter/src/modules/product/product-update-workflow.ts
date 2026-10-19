import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { decodeGraphCount } from "../../local-graph/query";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { ProductLifecycleIds } from "./lifecycle";
import { variantUpdateData } from "./variant-workflow-input";
import { ProductUpdateSelector, ProductUpdateOutput, ProductUpdatePreimages, productUpdateData } from "./product-update-input";

export function productUpdateWorkflowModule(source: CommerceModuleDescription,
  commands: { readonly list: CommerceCommand; readonly upsert: CommerceCommand; readonly updateProductsForWorkflow: CommerceCommand },
  graph: GraphModuleDefinition, events: readonly string[], logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const read = graph.reads.find(read => read.model === "Product");
    const variants = graph.reads.find(read => read.model === "ProductVariant");
    if (read === undefined || variants === undefined || read.result === "list" || variants.result === "list") return yield* Result.fail(commerceError("unsupportedProfile"));
    const nestedVariants = Schema.optionalKey(Schema.Array(variantUpdateData(variants.table.columns, { id: Schema.optionalKey(ProductLifecycleIds.value) })).check(Schema.isMaxLength(4)));
    const data = productUpdateData(read.table.columns, { variants: nestedVariants });
    const entry = productUpdateData(read.table.columns, { id: ProductLifecycleIds.value, variants: nestedVariants });
    const readArguments = commerceDecoder(Schema.Union([Schema.Tuple([ProductUpdateSelector]), Schema.Tuple([ProductUpdateSelector, NativePreimageConfig])]), "invalidInput");
    const upsertArguments = commerceDecoder(Schema.Tuple([Schema.Array(entry).check(Schema.isMaxLength(4))]), "invalidInput");
    const updateArguments = commerceDecoder(Schema.Tuple([ProductUpdateSelector, data]), "invalidInput");
    const preimages = commerceDecoder(ProductUpdatePreimages, "unsupportedProfile");
    const output = commerceDecoder(ProductUpdateOutput, "unsupportedProfile");
    const listProducts = yield* defineWorkflowMethod({ command: commands.list, arguments: readArguments,
      encode: args => ({ filters: args[0], ...(args.length === 1 ? {} : { config: nativePreimageSelection(args[1], read) }) }), output: preimages });
    const upsertProducts = yield* defineWorkflowMethod({ command: commands.upsert,
      arguments: upsertArguments,
      encode: ([rows]) => rows, output, moduleEvents: events });
    const updateProducts = yield* defineWorkflowMethod({ command: commands.updateProductsForWorkflow,
      arguments: updateArguments,
      encode: ([selector, update]) => ({ selector, update }), output, moduleEvents: events });
    const boundedGraph: GraphModuleDefinition = { ...graph, reads: graph.reads.map(candidate => candidate !== read ? candidate : { ...read,
      decode: input => decodeGraphCount(input).pipe(Result.flatMap(([rows, count]) => preimages(rows).pipe(Result.map(decoded => [decoded, count] as const)))),
    }) };
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".product-update" },
      methods: { listProducts, upsertProducts, updateProducts }, graph: boundedGraph, logical });
  });
}
export type ProductUpdateWorkflowModule = Result.Result.Success<ReturnType<typeof productUpdateWorkflowModule>>;
