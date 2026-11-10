import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { refetchProductType } from "../helpers"
import type { ProductTypes } from "@medusajs/framework/types"
import type { AdminUpdateProductTypeType } from "../validators"
import { MedusaError } from "@medusajs/utils/common/errors"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const updateProductTypesWorkflowId = "update-product-types"
const deleteProductTypesWorkflowId = "delete-product-types"

type UpdateProductTypesWorkflowEngine = {
  run(id: typeof updateProductTypesWorkflowId, options: { input: { selector: { id: string }; update: AdminUpdateProductTypeType } }): Promise<{ result: { id: string }[] }>
}
type DeleteProductTypesWorkflowEngine = {
  run(id: typeof deleteProductTypesWorkflowId, options: { input: { ids: string[] } }): Promise<unknown>
}

export const GET = async (
  req: AuthenticatedMedusaRequest<
    Record<string, unknown>
  >,
  res: MedusaResponse<{ product_type: ProductTypes.ProductTypeDTO | undefined }>
) => {
  const productType = await refetchProductType(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ product_type: productType })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminUpdateProductTypeType,
    Record<string, unknown>
  >,
  res: MedusaResponse<{ product_type: ProductTypes.ProductTypeDTO | undefined }>
) => {
  const existingProductType = await refetchProductType(
    req.params.id,
    req.scope,
    ["id"]
  )

  if (!existingProductType) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product type with id "${req.params.id}" not found`
    )
  }

  const workflowEngine = req.scope.resolve<UpdateProductTypesWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(updateProductTypesWorkflowId, {
    input: {
      selector: { id: req.params.id },
      update: req.validatedBody,
    },
  })

  const productType = await refetchProductType(
    result[0].id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ product_type: productType })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: string; object: "product_type"; deleted: true }>
) => {
  const id = req.params.id

  const workflowEngine = req.scope.resolve<DeleteProductTypesWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(deleteProductTypesWorkflowId, {
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "product_type",
    deleted: true,
  })
}
