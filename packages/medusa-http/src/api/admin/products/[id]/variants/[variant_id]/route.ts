import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ProductVariantDTO } from "@medusajs/framework/types"
import { refetchEntity } from "@medusajs/framework/http"
import { remapKeysForVariant, remapVariantResponse } from "../../../helpers"

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
