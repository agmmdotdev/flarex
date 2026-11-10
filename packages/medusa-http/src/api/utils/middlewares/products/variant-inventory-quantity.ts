import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { getTotalVariantAvailability } from "@medusajs/utils/product/get-variant-availability"
import type { MedusaRequest } from "@medusajs/framework/http"

export const wrapVariantsWithTotalInventoryQuantity = async (
  req: MedusaRequest,
  variants: VariantInput[]
) => {
  const variantIds = (variants ?? []).map((variant) => variant.id).flat(1)

  if (!variantIds.length) {
    return
  }

  const query = req.scope.resolve<Parameters<typeof getTotalVariantAvailability>[0]>(ContainerRegistrationKeys.QUERY)
  const availability = await getTotalVariantAvailability(query, {
    variant_ids: variantIds,
  })

  wrapVariants(variants, availability)
}

type VariantInput = {
  id: string
  inventory_quantity?: number | null
  manage_inventory?: boolean | null
}

type VariantAvailability = Awaited<
  ReturnType<typeof getTotalVariantAvailability>
>

const wrapVariants = (
  variants: VariantInput[],
  availability: VariantAvailability
) => {
  for (const variant of variants) {
    if (!variant.manage_inventory) {
      continue
    }

    variant.inventory_quantity = availability[variant.id].availability
  }
}
