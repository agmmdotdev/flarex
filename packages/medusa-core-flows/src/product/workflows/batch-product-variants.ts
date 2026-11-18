import type { BatchWorkflowInput, BatchWorkflowOutput, ProductTypes, CreateProductVariantWorkflowInputDTO, UpdateProductVariantWorkflowInputDTO } from "@medusajs/framework/types";
import { type WorkflowData, WorkflowResponse, createWorkflow, parallelize, transform } from "@medusajs/workflows-sdk";
import { createProductVariantsWorkflow } from "./create-product-variants";
import { updateProductVariantsWorkflow } from "./update-product-variants";
import { deleteProductVariantsWorkflow } from "./delete-product-variants";

export interface BatchProductVariantsWorkflowInput extends BatchWorkflowInput<CreateProductVariantWorkflowInputDTO, UpdateProductVariantWorkflowInputDTO> {}
export interface BatchProductVariantsWorkflowOutput extends BatchWorkflowOutput<ProductTypes.ProductVariantDTO> {}
export const batchProductVariantsWorkflowId = "batch-product-variants";
/** Unlike Product batch, the native Variant wrapper calls every empty child. */
export const batchProductVariantsWorkflow = createWorkflow(batchProductVariantsWorkflowId,
  (input: WorkflowData<BatchProductVariantsWorkflowInput>): WorkflowResponse<BatchProductVariantsWorkflowOutput> => {
    const normalizedInput = transform({ input }, data => ({ create: data.input.create ?? [], update: data.input.update ?? [], delete: data.input.delete ?? [] }));
    const res = parallelize(
      createProductVariantsWorkflow.runAsStep({ input: { product_variants: normalizedInput.create } }),
      updateProductVariantsWorkflow.runAsStep({ input: { product_variants: normalizedInput.update } }),
      deleteProductVariantsWorkflow.runAsStep({ input: { ids: normalizedInput.delete } }),
    );
    return new WorkflowResponse(transform({ res, input }, data => ({ created: data.res[0], updated: data.res[1], deleted: data.input.delete ?? [] })));
  });
