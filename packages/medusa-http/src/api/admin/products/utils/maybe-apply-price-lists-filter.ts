import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import type { MedusaRequest, MedusaNextFunction } from "@medusajs/framework/http"

type PriceListVariantPriceRow = {
  prices?: Array<{
    price_set?: {
      variant?: {
        id?: string
      }
    }
  }>
}

export function maybeApplyPriceListsFilter() {
  return async function applyPriceListsFilter(
    req: MedusaRequest<unknown, { price_list_id?: string[]; variants?: Record<string, unknown> }>,
    _res: unknown,
    next: MedusaNextFunction
  ) {
    const filterableFields = req.filterableFields

    if (!filterableFields.price_list_id) {
      return next()
    }

    const priceListIds = filterableFields.price_list_id
    delete filterableFields.price_list_id

    const queryObject = remoteQueryObjectFromString({
      entryPoint: "price_list",
      fields: ["prices.price_set.variant.id"],
      variables: {
        id: priceListIds,
      },
    })

    const remoteQuery = req.scope.resolve<(input: typeof queryObject) => Promise<PriceListVariantPriceRow[]>>(
      ContainerRegistrationKeys.REMOTE_QUERY
    )

    const variantIds: string[] = []
    const priceLists = await remoteQuery(queryObject)

    priceLists.forEach((priceList) => {
      priceList.prices?.forEach((price) => {
        const variantId = price.price_set?.variant?.id

        if (variantId) {
          variantIds.push(variantId)
        }
      })
    })

    filterableFields.variants = {
      ...(filterableFields.variants ?? {}),
      id: variantIds,
    }

    return next()
  }
}
