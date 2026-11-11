import type { BatchWorkflowInput, BatchWorkflowOutput, ProductTypes, CreateProductVariantWorkflowInputDTO, UpdateProductVariantWorkflowInputDTO } from "@medusajs/framework/types";
import { type WorkflowData, WorkflowResponse, createWorkflow, parallelize, transform } from "@medusajs/workflows-sdk";
import { createProductVariantsWorkflow } from "./create-product-variants";
import { updateProductVariantsWorkflow } from "./update-product-variants";
import { deleteProductVariantsWorkflow } from "./delete-product-variants";
import { validateProductVariantBatchParentStep } from "../steps/validate-product-variant-batch-parent";

export interface BatchProductVariantsWorkflowInput extends BatchWorkflowInput<CreateProductVariantWorkflowInputDTO, UpdateProductVariantWorkflowInputDTO & { product_id?: string }> {
  /** Restrict this complete atomic batch to one Product. */
  product_id?: string
}
export interface BatchProductVariantsWorkflowOutput extends BatchWorkflowOutput<ProductTypes.ProductVariantDTO> {}
export const batchProductVariantsWorkflowId = "batch-product-variants";
/** Unlike Product batch, the native Variant wrapper calls every empty child. */
export const batchProductVariantsWorkflow = createWorkflow(batchProductVariantsWorkflowId,
  (input: WorkflowData<BatchProductVariantsWorkflowInput>): WorkflowResponse<BatchProductVariantsWorkflowOutput> => {
    const checked = validateProductVariantBatchParentStep(transform({ input }, ({ input }) => ({
      ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
      create: input.create ?? [], update: input.update ?? [], delete: input.delete ?? [],
    })));
    const normalizedInput = transform(checked, input => {
      const parent = input.product_id;
      return {
        create: parent === undefined ? input.create : input.create.map(row => ({ ...row, product_id: parent })),
        update: parent === undefined ? input.update : input.update.map(row => ({ ...row, product_id: parent })),
        delete: input.delete,
        ...(parent === undefined ? {} : { product_id: parent }),
      };
    });
    const res = parallelize(
      createProductVariantsWorkflow.runAsStep({ input: { product_variants: normalizedInput.create } }),
      updateProductVariantsWorkflow.runAsStep({ input: { product_variants: normalizedInput.update } }),
      deleteProductVariantsWorkflow.runAsStep({ input: transform(normalizedInput, input => ({ ids: input.delete,
        ...(input.product_id === undefined ? {} : { product_id: input.product_id }),
      })) }),
    );
    return new WorkflowResponse(transform({ res, input }, data => ({ created: data.res[0], updated: data.res[1], deleted: data.input.delete ?? [] })));
  });
