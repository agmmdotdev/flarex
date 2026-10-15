import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { ProductCategoryCreateInput, ProductCategoryUpdateData, ProductCategoryIds, ProductCategorySelector,
  ProductCategorySoftDeleteOutput, decodeProductCategoryOutput, decodeProductCategoryPreimages } from "./category-input";

/** Named genuine Category methods retain tree service normalization and its
 * projection representation; physical Category deletion remains separate. */
export function productCategoryWorkflowModule(source: CommerceModuleDescription, commands: {
  readonly createCategories: CommerceCommand; readonly listCategories: CommerceCommand;
  readonly updateCategoriesBySelector: CommerceCommand; readonly softDeleteCategories: CommerceCommand;
}, graph: GraphModuleDefinition, events: { readonly created: string; readonly updated: string; readonly deleted: string }, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const read = graph.reads.find(candidate => candidate.model === "ProductCategory");
    if (read === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const createArguments = commerceDecoder(Schema.Tuple([ProductCategoryCreateInput]), "invalidInput");
    const listArguments = commerceDecoder(Schema.Tuple([ProductCategorySelector, NativePreimageConfig]), "invalidInput");
    const updateArguments = commerceDecoder(Schema.Tuple([ProductCategorySelector, ProductCategoryUpdateData]), "invalidInput");
    const deleteArguments = commerceDecoder(Schema.Tuple([ProductCategoryIds]), "invalidInput");
    const deleted = commerceDecoder(ProductCategorySoftDeleteOutput, "storedCorruption");
    const createProductCategories = yield* defineWorkflowMethod({ command: commands.createCategories, arguments: createArguments,
      encode: ([categories]) => categories, output: decodeProductCategoryOutput, moduleEvents: [events.created, events.updated] });
    const listProductCategories = yield* defineWorkflowMethod({ command: commands.listCategories, arguments: listArguments,
      encode: ([filters, config]) => ({ filters, config: nativePreimageSelection(config, read) }), output: decodeProductCategoryPreimages });
    const updateProductCategories = yield* defineWorkflowMethod({ command: commands.updateCategoriesBySelector, arguments: updateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: decodeProductCategoryOutput, moduleEvents: [events.updated] });
    const softDeleteProductCategories = yield* defineWorkflowMethod({ command: commands.softDeleteCategories, arguments: deleteArguments,
      encode: ([ids]) => ids, output: deleted, moduleEvents: [events.updated, events.deleted] });
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".product-category-workflows" },
      methods: { createProductCategories, listProductCategories, updateProductCategories, softDeleteProductCategories }, graph, logical });
  });
}
export type ProductCategoryWorkflowModule = Result.Result.Success<ReturnType<typeof productCategoryWorkflowModule>>;
