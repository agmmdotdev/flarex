import { refetchEntity, type AuthenticatedMedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { ProductTypes } from "@medusajs/framework/types"
import type { AdminUpdateProductBody } from "../validators"
import { remapKeysForProduct, remapProductResponse } from "../helpers"

const updateProductsWorkflowId = "update-products"
const deleteProductsWorkflowId = "delete-products"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ product: ProductTypes.ProductDTO }>
) => {
  const selectFields = remapKeysForProduct(req.queryConfig.fields ?? [])
  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product", idOrFilter: req.params.id, scope: req.scope, fields: selectFields,
  })
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found")
  }
  res.status(200).json({ product: remapProductResponse(product) })
}

type UpdateProductsWorkflowEngine = {
  run(id: typeof updateProductsWorkflowId, options: {
    input: {
      selector: { id: string }
      update: Omit<AdminUpdateProductBody, "additional_data">
      additional_data?: AdminUpdateProductBody["additional_data"]
    }
  }): Promise<{ result: { id: string }[] }>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<AdminUpdateProductBody>,
  res: MedusaResponse<{ product: ReturnType<typeof remapProductResponse> }>
) => {
  const { additional_data, ...update } = req.validatedBody

  const existingProduct = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: ["id"],
  })
  /**
   * Check if the product exists with the id or not before calling the workflow.
   */
  if (!existingProduct) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product with id "${req.params.id}" not found`
    )
  }

  const workflowEngine = req.scope.resolve<UpdateProductsWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(updateProductsWorkflowId, {
    input: {
      selector: { id: req.params.id },
      update,
      additional_data,
    },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: result[0].id,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  if (!product) throw new Error("Updated Product was not returned by native refetch")

  res.status(200).json({ product: remapProductResponse(product) })
}

type DeleteProductsWorkflowEngine = {
  run(id: typeof deleteProductsWorkflowId, options: { input: { ids: string[] } }): Promise<unknown>
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: string; object: "product"; deleted: true }>
) => {
  const id = req.params.id
  const workflowEngine = req.scope.resolve<DeleteProductsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deleteProductsWorkflowId, {
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "product",
    deleted: true,
  })
}
