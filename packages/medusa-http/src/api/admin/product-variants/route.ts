import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
  refetchEntities,
} from "@medusajs/framework/http"
import type { ProductTypes } from "@medusajs/framework/types"
import { wrapVariantsWithTotalInventoryQuantity } from "../../utils/middlewares/products/variant-inventory-quantity"
import { remapKeysForVariant, remapVariantResponse } from "../products/helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ variants: ProductTypes.ProductVariantDTO[]; count?: number; offset?: number; limit?: number }>
) => {
  const withInventoryQuantity = req.queryConfig.fields.some((field) =>
    field.includes("inventory_quantity")
  )

  if (withInventoryQuantity) {
    req.queryConfig.fields = req.queryConfig.fields.filter(
      (field) => !field.includes("inventory_quantity")
    )
  }

  const { data: variants, metadata } = await refetchEntities<ProductTypes.ProductVariantDTO>({
    entity: "variant",
    idOrFilter: { ...req.filterableFields },
    scope: req.scope,
    fields: remapKeysForVariant(req.queryConfig.fields ?? []),
    pagination: req.queryConfig.pagination,
  })

  if (withInventoryQuantity) {
    await wrapVariantsWithTotalInventoryQuantity(req, variants || [])
  }

  res.json({
    variants: variants.map<ProductTypes.ProductVariantDTO>(remapVariantResponse),
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
