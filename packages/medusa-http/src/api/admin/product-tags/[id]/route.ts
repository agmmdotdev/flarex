import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntity,
} from "@medusajs/framework/http"
import type { ProductTypes } from "@medusajs/framework/types"
import type { AdminUpdateProductTagType } from "../validators"
import { MedusaError } from "@medusajs/utils/common/errors"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const updateProductTagsWorkflowId = "update-product-tags"
const deleteProductTagsWorkflowId = "delete-product-tags"

type UpdateProductTagsWorkflowEngine = {
  run(id: typeof updateProductTagsWorkflowId, options: { input: { selector: { id: string }; update: AdminUpdateProductTagType } }): Promise<{ result: { id: string }[] }>
}
type DeleteProductTagsWorkflowEngine = {
  run(id: typeof deleteProductTagsWorkflowId, options: { input: { ids: string[] } }): Promise<unknown>
}

export const GET = async (
  req: AuthenticatedMedusaRequest<
    Record<string, unknown>
  >,
  res: MedusaResponse<{ product_tag: ProductTypes.ProductTagDTO | undefined }>
) => {
  const productTag = await refetchEntity<ProductTypes.ProductTagDTO>({
    entity: "product_tag",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ product_tag: productTag })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminUpdateProductTagType,
    Record<string, unknown>
  >,
  res: MedusaResponse<{ product_tag: ProductTypes.ProductTagDTO | undefined }>
) => {
  const existingProductTag = await refetchEntity<ProductTypes.ProductTagDTO>({
    entity: "product_tag",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: ["id"],
  })

  if (!existingProductTag) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product tag with id "${req.params.id}" not found`
    )
  }

  const workflowEngine = req.scope.resolve<UpdateProductTagsWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(updateProductTagsWorkflowId, {
    input: {
      selector: { id: req.params.id },
      update: req.validatedBody,
    },
  })

  const productTag = await refetchEntity<ProductTypes.ProductTagDTO>({
    entity: "product_tag",
    idOrFilter: result[0].id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ product_tag: productTag })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: string; object: "product_tag"; deleted: true }>
) => {
  const id = req.params.id

  const workflowEngine = req.scope.resolve<DeleteProductTagsWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(deleteProductTagsWorkflowId, {
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "product_tag",
    deleted: true,
  })
}
