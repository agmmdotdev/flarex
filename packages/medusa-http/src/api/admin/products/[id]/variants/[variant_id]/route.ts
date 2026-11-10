import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ProductTypes, ProductVariantDTO } from "@medusajs/framework/types"
import { refetchEntity } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import type { AdminUpdateProductVariantBody } from "../../../validators"
import { remapKeysForProduct, remapKeysForVariant, remapProductResponse, remapVariantResponse } from "../../../helpers"

const updateProductVariantsWorkflowId = "update-product-variants"
const deleteProductVariantsWorkflowId = "delete-product-variants"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ variant?: ProductVariantDTO | null | undefined }>
) => {
  const productId = req.params.id
  const variantId = req.params.variant_id
  const variables = { id: variantId, product_id: productId }

  const variant = await refetchEntity<ProductVariantDTO>({
    entity: "variant",
    idOrFilter: variables,
    scope: req.scope,
    fields: remapKeysForVariant(req.queryConfig.fields ?? []),
  })

  res.status(200).json({ variant: remapVariantResponse(variant) })
}

type UpdateProductVariantsWorkflowEngine = {
  run(id: typeof updateProductVariantsWorkflowId, options: {
    input: {
      selector: { id: string; product_id: string }
      update: Omit<AdminUpdateProductVariantBody, "additional_data">
      additional_data?: AdminUpdateProductVariantBody["additional_data"]
    }
  }): Promise<unknown>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<AdminUpdateProductVariantBody>,
  res: MedusaResponse<{ product: ReturnType<typeof remapProductResponse> }>
) => {
  const productId = req.params.id
  const variantId = req.params.variant_id
  const { additional_data, ...update } = req.validatedBody

  const workflowEngine = req.scope.resolve<UpdateProductVariantsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updateProductVariantsWorkflowId, {
    input: {
      selector: { id: variantId, product_id: productId },
      update: update,
      additional_data,
    },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: productId,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  if (!product) throw new Error("Updated Product variant parent was not returned by native refetch")
  res.status(200).json({ product: remapProductResponse(product) })
}

type DeleteProductVariantsWorkflowEngine = {
  run(id: typeof deleteProductVariantsWorkflowId, options: {
    input: { ids: string[]; product_id: string }
  }): Promise<unknown>
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: string; object: "variant"; deleted: true; parent: ReturnType<typeof remapProductResponse> }>
) => {
  const productId = req.params.id
  const variantId = req.params.variant_id

  const workflowEngine = req.scope.resolve<DeleteProductVariantsWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deleteProductVariantsWorkflowId, {
    input: { ids: [variantId], product_id: productId },
  })

  const product = await refetchEntity<ProductTypes.ProductDTO>({
    entity: "product",
    idOrFilter: productId,
    scope: req.scope,
    fields: remapKeysForProduct(req.queryConfig.fields ?? []),
  })

  if (!product) throw new Error("Deleted Product variant parent was not returned by native refetch")
  res.status(200).json({
    id: variantId,
    object: "variant",
    deleted: true,
    parent: remapProductResponse(product),
  })
}
