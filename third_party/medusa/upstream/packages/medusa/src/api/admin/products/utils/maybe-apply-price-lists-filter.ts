import { HttpTypes } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import type { NextFunction } from "express"

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
    req: MedusaRequest,
    _res: unknown,
    next: NextFunction
  ) {
    const filterableFields: HttpTypes.AdminProductListParams =
      req.filterableFields

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

    const remoteQuery = req.scope.resolve(
      ContainerRegistrationKeys.REMOTE_QUERY
    )

    const variantIds: string[] = []
    const priceLists = (await remoteQuery(
      queryObject
    )) as PriceListVariantPriceRow[]

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
