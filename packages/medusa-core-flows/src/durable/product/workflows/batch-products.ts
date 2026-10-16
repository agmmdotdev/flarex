import type { BatchWorkflowOutput, ProductTypes } from "@medusajs/types"
import { createFiniteAtomicChildWorkflow } from "@medusajs/workflows-sdk/durable/engine"
import type { NormalizedProductBatchRequest } from "../../../product/utils/normalize-products-from-csv.js"

export const productImportAtomicBatchService = "productImportAtomicBatch"
export const batchProductsWorkflowId = "batch-products"

/** Explicit finite-child execution profile. The genuine native child invokes
 * the admitted Product atomic root through its current trusted resolver. */
export const batchProductsWorkflow = createFiniteAtomicChildWorkflow<
  NormalizedProductBatchRequest,
  BatchWorkflowOutput<ProductTypes.ProductDTO>
>(batchProductsWorkflowId, productImportAtomicBatchService)
