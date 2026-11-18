import { Effect, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, workflowMethodDefinition, workflowModuleDefinition, type WorkflowLogicalPolicy } from "../../workflow/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { CommerceModuleDescription } from "../../module/definition";
import type { ProductWorkflowModule } from "./workflow";
import type { ProductUpdateWorkflowModule } from "./product-update-workflow";
import type { ProductVariantUpdateWorkflowModule } from "./variant-update-workflow";
import type { ProductDeletionWorkflowModule } from "./product-deletion-workflow";
import type { ProductRuntimeMetadata } from "./runtime-metadata";
import { productBatchInitialVariantReceipt } from "./product-batch-receipt";

/** One authentic Product view over the existing native command owners. The
 * read tokens also identify genuine Query calls in the root's transcript. */
export function productBatchWorkflowModule(source: CommerceModuleDescription, catalog: ProductRuntimeMetadata, modules: {
  readonly creation: ProductWorkflowModule; readonly update: ProductUpdateWorkflowModule;
  readonly variantUpdate: ProductVariantUpdateWorkflowModule; readonly deletion: ProductDeletionWorkflowModule;
}, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const update = workflowModuleDefinition(modules.update), deletion = workflowModuleDefinition(modules.deletion);
    const products = deletion?.graph.reads.find(read => read.model === "Product");
    const variants = deletion?.graph.reads.find(read => read.model === "ProductVariant");
    const updateCommands = [modules.update.methods.upsertProducts, modules.update.methods.updateProducts]
      .map(method => workflowMethodDefinition(method)?.command);
    const deletionCommand = workflowMethodDefinition(modules.deletion.methods.softDeleteProducts)?.command;
    if (update?.logical === undefined || deletion === undefined || products === undefined || variants === undefined || deletionCommand === undefined)
      return yield* Result.fail(commerceError("invalidAuthority"));
    const admittedUpdates = [];
    for (const command of updateCommands) {
      if (command === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
      admittedUpdates.push(command);
    }
    const validateLogical = yield* productBatchInitialVariantReceipt(catalog, admittedUpdates, deletionCommand);
    const updatePolicy = update.logical;
    const argumentsDecoder = commerceDecoder(Schema.Tuple([Schema.JsonObject]), "invalidInput");
    const countProductVariantsForBatch = yield* defineWorkflowMethod({ command: variants.command, arguments: argumentsDecoder,
      encode: ([query]) => query, output: decodeGraphCount });
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".product-batches" },
      methods: {
        createProducts: modules.creation.methods.createProducts, createProductVariants: modules.creation.methods.createProductVariants,
        listProducts: modules.update.methods.listProducts, upsertProducts: modules.update.methods.upsertProducts, updateProducts: modules.update.methods.updateProducts,
        listProductVariants: modules.variantUpdate.methods.listProductVariants, upsertProductVariants: modules.variantUpdate.methods.upsertProductVariants,
        updateProductVariants: modules.variantUpdate.methods.updateProductVariants,
        softDeleteProducts: modules.deletion.methods.softDeleteProducts, softDeleteProductVariants: modules.deletion.methods.softDeleteProductVariants,
        countProductVariantsForBatch,
      }, graph: deletion.graph, logical: { ...logical,
        validateLogical,
        validateLogicalCall: Effect.fn("ProductBatch.validateNativeCall")((call: Parameters<LogicalCommerceCallValidation>[0],
          activity: Parameters<LogicalCommerceCallValidation>[1], command: Parameters<LogicalCommerceCallValidation>[2]) =>
          updateCommands.includes(command) ? updatePolicy.validateLogicalCall(call, activity, command) : logical.validateLogicalCall(call, activity, command)),
      } });
  });
}
export type ProductBatchWorkflowModule = Result.Result.Success<ReturnType<typeof productBatchWorkflowModule>>;
