import type { BatchWorkflowInput, BatchWorkflowOutput, CreateProductWorkflowInputDTO, ProductTypes, UpdateProductWorkflowInputDTO } from "@medusajs/framework/types";
import { type WorkflowData, WorkflowResponse, createWorkflow, parallelize, transform, when } from "@medusajs/workflows-sdk";
import { createProductsWorkflow } from "./create-products";
import { updateProductsWorkflow } from "./update-products";
import { deleteProductsWorkflow } from "./delete-products";

export interface BatchProductWorkflowInput extends BatchWorkflowInput<CreateProductWorkflowInputDTO, UpdateProductWorkflowInputDTO> {}

const conditionallyCreateProducts = (input: BatchProductWorkflowInput) =>
  when({ input }, ({ input }) => !!input.create?.length).then(() =>
    createProductsWorkflow.runAsStep({ input: { products: input.create! } }));
const conditionallyUpdateProducts = (input: BatchProductWorkflowInput) =>
  when({ input }, ({ input }) => !!input.update?.length).then(() =>
    updateProductsWorkflow.runAsStep({ input: { products: input.update! } }));
const conditionallyDeleteProducts = (input: BatchProductWorkflowInput) =>
  when({ input }, ({ input }) => !!input.delete?.length).then(() =>
    deleteProductsWorkflow.runAsStep({ input: { ids: input.delete! } }));

export const batchProductsWorkflowId = "batch-products";
/** Pinned native branch selection, result ordering and requested deletion IDs.
 * Authentic SDK parallel regions share the existing atomic root. */
export const batchProductsWorkflow = createWorkflow(batchProductsWorkflowId,
  (input: WorkflowData<BatchProductWorkflowInput>): WorkflowResponse<BatchWorkflowOutput<ProductTypes.ProductDTO>> => {
    const res = parallelize(conditionallyCreateProducts(input), conditionallyUpdateProducts(input), conditionallyDeleteProducts(input));
    return new WorkflowResponse(transform({ res, input }, data => ({
      created: data.res[0] ?? [], updated: data.res[1] ?? [], deleted: data.input.delete ?? [],
    })));
  });
