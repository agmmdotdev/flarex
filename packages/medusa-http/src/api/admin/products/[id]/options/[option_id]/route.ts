import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
  refetchEntity,
} from "@medusajs/framework/http"
import type { ProductTypes } from "@medusajs/framework/types"
import { remapKeysForProduct, remapProductResponse } from "../../../helpers"
import type { AdminUpdateProductOptionBody } from "../../../validators"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const updateProductOptionsWorkflowId = "update-product-options"
const deleteProductOptionsWorkflowId = "delete-product-options"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ product_option?: ProductTypes.ProductOptionDTO | null | undefined }>
) => {
  const productId = req.params.id
  const optionId = req.params.option_id
  const productOption = await refetchEntity<ProductTypes.ProductOptionDTO>({
    entity: "product_option",
    idOrFilter: { id: optionId, product_id: productId },
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ product_option: productOption })
}

type UpdateProductOptionsWorkflowEngine = {
  run(id: typeof updateProductOptionsWorkflowId, options: {
    input: {
      selector: { id: string; product_id: string }
      update: Omit<AdminUpdateProductOptionBody, "additional_data">
      additional_data?: AdminUpdateProductOptionBody["additional_data"]
    }
  }): Promise<unknown>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<AdminUpdateProductOptionBody>,
  res: MedusaResponse<{ product: ReturnType<typeof remapProductResponse> }>
) => {
  const productId = req.params.id
  const optionId = req.params.option_id
  const { additional_data, ...update } = req.validatedBody
  const workflowEngine = req.scope.resolve<UpdateProductOptionsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updateProductOptionsWorkflowId, {
    input: {
      selector: { id: optionId, product_id: productId },
      update,
      additional_data,
    },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: productId,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  if (!product) throw new Error("Updated Product option parent was not returned by native refetch")
  res.status(200).json({ product: remapProductResponse(product) })
}

type DeleteProductOptionsWorkflowEngine = {
  run(id: typeof deleteProductOptionsWorkflowId, options: {
    input: { ids: string[]; product_id: string }
  }): Promise<unknown>
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: string; object: "product_option"; deleted: true; parent?: ProductTypes.ProductDTO | null | undefined }>
) => {
  const productId = req.params.id
  const optionId = req.params.option_id

  const workflowEngine = req.scope.resolve<DeleteProductOptionsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deleteProductOptionsWorkflowId, {
    input: { ids: [optionId], product_id: productId },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: productId,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  res.status(200).json({
    id: optionId,
    object: "product_option",
    deleted: true,
    parent: product,
  })
}
