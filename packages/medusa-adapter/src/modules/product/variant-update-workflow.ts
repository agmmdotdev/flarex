import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { VariantUpdateSelector, variantUpdateInput, variantUpdateData } from "./variant-workflow-input";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";

/** A named finite native view over the same Product command owner. The image
 * workflow retains its existing thumbnail-only update method and token. */
export function productVariantUpdateWorkflowModule(source: CommerceModuleDescription,
  commands: { readonly listVariants: CommerceCommand; readonly upsertVariants: CommerceCommand; readonly updateVariantsForWorkflow: CommerceCommand },
  graph: GraphModuleDefinition, updatedEvent: string, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const read = graph.reads.find(read => read.model === "ProductVariant");
    if (read === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const table = read.table, config = NativePreimageConfig;
    const readArguments = commerceDecoder(Schema.Union([Schema.Tuple([VariantUpdateSelector]), Schema.Tuple([VariantUpdateSelector, config])]), "invalidInput");
    const upsertArguments = commerceDecoder(Schema.Tuple([Schema.Array(variantUpdateInput(table.columns)).check(Schema.isMaxLength(4))]), "invalidInput");
    const updateArguments = commerceDecoder(Schema.Tuple([VariantUpdateSelector, variantUpdateData(table.columns, {})]), "invalidInput");
    const output = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
    const listProductVariants = yield* defineWorkflowMethod({ command: commands.listVariants, arguments: readArguments,
      encode: args => ({ filters: args[0], ...(args.length === 1 ? {} : { config: nativePreimageSelection(args[1], read) }) }), output });
    const upsertProductVariants = yield* defineWorkflowMethod({ command: commands.upsertVariants, arguments: upsertArguments,
      encode: ([rows]) => rows, output, moduleEvents: [updatedEvent] });
    const updateProductVariants = yield* defineWorkflowMethod({ command: commands.updateVariantsForWorkflow, arguments: updateArguments,
      encode: ([selector, update]) => ({ selector, update }), output, moduleEvents: [updatedEvent] });
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".variant-update" },
      methods: { listProductVariants, upsertProductVariants, updateProductVariants }, graph, logical });
  });
}
export type ProductVariantUpdateWorkflowModule = Result.Result.Success<ReturnType<typeof productVariantUpdateWorkflowModule>>;
