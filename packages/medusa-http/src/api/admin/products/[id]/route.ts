import { refetchEntity, type AuthenticatedMedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { ProductTypes } from "@medusajs/framework/types"
import { remapKeysForProduct, remapProductResponse } from "../helpers"

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
