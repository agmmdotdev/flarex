import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk"
import { createLinksWorkflow } from "../../common/workflows/create-links"
import { updateLinksWorkflow } from "../../common/workflows/update-links"
import { dismissLinksWorkflow } from "../../common/workflows/dismiss-links"
import { batchLinksWorkflow } from "../../common/workflows/batch-links"
import { validateProductVariantInventoryLinksStep, type ProductVariantInventoryLinksInput,
  type ProductVariantInventoryLinkBatchInput } from "../steps/validate-product-variant-inventory-links"

export const createProductVariantInventoryLinksWorkflow = createWorkflow(
  "create-product-variant-inventory-links", (input: WorkflowData<ProductVariantInventoryLinksInput>) => {
    const checked = validateProductVariantInventoryLinksStep(input)
    return new WorkflowResponse(createLinksWorkflow.runAsStep({ input: checked.links }))
  }
)
export const updateProductVariantInventoryLinksWorkflow = createWorkflow(
  "update-product-variant-inventory-links", (input: WorkflowData<ProductVariantInventoryLinksInput>) => {
    const checked = validateProductVariantInventoryLinksStep(input)
    return new WorkflowResponse(updateLinksWorkflow.runAsStep({ input: checked.links }))
  }
)
export const dismissProductVariantInventoryLinksWorkflow = createWorkflow(
  "dismiss-product-variant-inventory-links", (input: WorkflowData<ProductVariantInventoryLinksInput>) => {
    const checked = validateProductVariantInventoryLinksStep(input)
    return new WorkflowResponse(dismissLinksWorkflow.runAsStep({ input: checked.links }))
  }
)
export const batchProductVariantInventoryLinksWorkflow = createWorkflow(
  "batch-product-variant-inventory-links", (input: WorkflowData<ProductVariantInventoryLinkBatchInput>) => {
    const checked = validateProductVariantInventoryLinksStep(transform(input, value => ({
      product_id: value.product_id, links: [...value.create, ...value.update, ...value.delete],
    })))
    return new WorkflowResponse(batchLinksWorkflow.runAsStep({ input: transform({ input, checked }, ({ input }) => ({
      create: input.create, update: input.update, delete: input.delete,
    })) }))
  }
)
