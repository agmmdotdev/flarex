import type {
  ProductTypes,
  ProductCategoryWorkflow,
} from "@medusajs/types"
import { ProductCategoryWorkflowEvents } from "@medusajs/utils/core-flows/events"
import {
  createHook,
  createWorkflow,
  transform,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import { emitEventStep } from "../../common/steps/emit-event"
import { createProductCategoriesStep } from "../steps/create-product-categories"

/**
 * The created product categories.
 */
export type CreateProductCategoriesWorkflowOutput = ProductTypes.ProductCategoryDTO[]

export const createProductCategoriesWorkflowId = "create-product-categories"
/**
 * This workflow creates one or more product categories. It's used by the
 * [Create Product Category Admin API Route](https://docs.medusajs.com/api/admin#product-categories_postproductcategories).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to
 * create product categories within your custom flows.
 *
 * @example
 * const { result } = await createProductCategoriesWorkflow(container)
 * .run({
 *   input: {
 *     product_categories: [
 *       {
 *         name: "Shoes",
 *       }
 *     ]
 *   }
 * })
 *
 * @summary
 *
 * Create product categories.
 */
export const createProductCategoriesWorkflow = createWorkflow(
  createProductCategoriesWorkflowId,
  (
    input: WorkflowData<ProductCategoryWorkflow.CreateProductCategoriesWorkflowInput>
  ) => {
    const createdCategories = createProductCategoriesStep(input)

    const productCategoryIdEvents = transform(
      { createdCategories },
      ({ createdCategories }) => {
        return createdCategories.map((v) => {
          return { id: v.id }
        })
      }
    )

    emitEventStep({
      eventName: ProductCategoryWorkflowEvents.CREATED,
      data: productCategoryIdEvents,
    })

    const categoriesCreated = createHook("categoriesCreated", {
      categories: createdCategories,
      additional_data: input.additional_data,
    })

    return new WorkflowResponse(createdCategories, {
      hooks: [categoriesCreated],
    })
  }
)
