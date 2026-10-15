import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { ProductCategoryWorkflowEvents } from "@medusajs/utils/core-flows/events"
import {
  WorkflowData,
  WorkflowResponse,
  createHook,
  createWorkflow,
  parallelize,
  transform,
} from "@medusajs/workflows-sdk"
import { emitEventStep } from "../../common/steps/emit-event"
import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"
import { deleteProductCategoriesStep } from "../steps/delete-product-categories"

/**
 * The IDs of product categories to delete.
 */
export type DeleteProductCategoriesWorkflowInput = string[]

export const deleteProductCategoriesWorkflowId = "delete-product-categories"
/**
 * This workflow deletes one or more product categories. It's used by the
 * [Delete Product Category Admin API Route](https://docs.medusajs.com/api/admin#product-categories_deleteproductcategoriesid).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to
 * delete product categories within your custom flows.
 *
 * @example
 * const { result } = await deleteProductCategoriesWorkflow(container)
 * .run({
 *   input: ["pcat_123"]
 * })
 *
 * @summary
 *
 * Delete product categories.
 */
export const deleteProductCategoriesWorkflow = createWorkflow(
  deleteProductCategoriesWorkflowId,
  (input: WorkflowData<DeleteProductCategoriesWorkflowInput>) => {
    const deleted = deleteProductCategoriesStep(input)

    const productCategoryIdEvents = transform({ input }, ({ input }) => {
      return input?.map((id) => {
        return { id }
      })
    })

    parallelize(
      removeRemoteLinkStep({
        [Modules.PRODUCT]: {
          product_category_id: input,
        },
      }),
      emitEventStep({
        eventName: ProductCategoryWorkflowEvents.DELETED,
        data: productCategoryIdEvents,
      })
    )

    const categoriesDeleted = createHook<"categoriesDeleted", { ids: DeleteProductCategoriesWorkflowInput }>("categoriesDeleted", {
      ids: input,
    })

    return new WorkflowResponse(deleted, {
      hooks: [categoriesDeleted],
    })
  }
)
