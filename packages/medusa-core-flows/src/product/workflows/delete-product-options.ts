import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { ProductOptionWorkflowEvents } from "@medusajs/utils/core-flows/events"
import {
  WorkflowData,
  WorkflowResponse,
  createHook,
  createWorkflow,
  parallelize,
  transform,
  when,
} from "@medusajs/workflows-sdk"
import { emitEventStep } from "../../common/steps/emit-event"
import { removeRemoteLinkStep } from "../../common/steps/remove-remote-links"
import { useQueryGraphStep } from "../../common/steps/use-query-graph"
import { deleteProductOptionsStep, type DeleteProductOptionsStepInput } from "../steps/delete-product-options"

/**
 * The data to delete one or more product options.
 */
export type DeleteProductOptionsWorkflowInput = {
  /**
   * The IDs of the options to delete.
   */
  ids: string[]
  /** Restrict the complete deletion graph to options owned by this Product. */
  product_id?: string
}

export const deleteProductOptionsWorkflowId = "delete-product-options"
/**
 * This workflow deletes one or more product options. It's used by the
 * [Delete Product Option Admin API Route](https://docs.medusajs.com/api/admin#products_deleteproductsidoptionsoption_id).
 *
 * This workflow has a hook that allows you to perform custom actions after the product options are deleted. For example,
 * you can delete custom records linked to the product colleciton.
 *
 * You can also use this workflow within your own custom workflows, allowing you to wrap custom logic around product-option deletion.
 *
 * @example
 * const { result } = await deleteProductOptionsWorkflow(container)
 * .run({
 *   input: {
 *     ids: ["poption_123"],
 *   }
 * })
 *
 * @summary
 *
 * Delete one or more product option.
 *
 * @property hooks.productOptionsDeleted - This hook is executed after the options are deleted. You can consume this hook to perform custom actions on the deleted options.
 */
export const deleteProductOptionsWorkflow = createWorkflow(
  deleteProductOptionsWorkflowId,
  (input: WorkflowData<DeleteProductOptionsWorkflowInput>) => {
    const scopedOptions = when("query-option-deletion-parent", { input }, ({ input }) => input.product_id !== undefined).then(() =>
      useQueryGraphStep({
        entity: "product_option",
        fields: ["id"],
        filters: transform({ input }, ({ input }) => input.product_id === undefined
          ? { id: input.ids }
          : { id: input.ids, product_id: input.product_id }),
      })
    )
    const effectiveIds = transform({ input, scopedOptions }, ({ input, scopedOptions }) => {
      if (input.product_id === undefined) return input.ids
      const matchingIds = new Set(scopedOptions?.data.map(option => option.id))
      return input.ids.filter(id => matchingIds.has(id))
    })
    const optionDeletionInput = transform(
      { input, effectiveIds },
      ({ input, effectiveIds }): DeleteProductOptionsStepInput => input.product_id === undefined
        ? effectiveIds
        : { id: effectiveIds, product_id: input.product_id }
    )
    const deletedProductOptions = deleteProductOptionsStep(optionDeletionInput)
    const productOptionsDeleted = createHook<"productOptionsDeleted", Pick<DeleteProductOptionsWorkflowInput, "ids">>("productOptionsDeleted", {
      ids: effectiveIds,
    })

    const optionIdEvents = transform({ effectiveIds }, ({ effectiveIds }) => {
      return effectiveIds?.map((id) => {
        return { id }
      })
    })

    parallelize(
      removeRemoteLinkStep({
        [Modules.PRODUCT]: { product_option_id: effectiveIds },
      }),
      emitEventStep({
        eventName: ProductOptionWorkflowEvents.DELETED,
        data: optionIdEvents,
      })
    )

    return new WorkflowResponse(deletedProductOptions, {
      hooks: [productOptionsDeleted],
    })
  }
)
