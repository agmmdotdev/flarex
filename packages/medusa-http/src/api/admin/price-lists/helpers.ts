import type { PriceListDTO } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import { buildPriceListRules, buildPriceSetPricesForCore } from "@medusajs/utils/pricing/builders"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { isPresent } from "@medusajs/utils/common/is-present"
import { MedusaError } from "@medusajs/utils/common/errors"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"

type PriceListGraph = PriceListDTO & { rules?: Record<string, string[]> }

export const fetchPriceList = async (
  id: string,
  scope: MedusaRequest["scope"],
  fields: string[]
) => {
  const remoteQuery = scope.resolve<<T>(input: ReturnType<typeof remoteQueryObjectFromString>) => Promise<T[]>>(ContainerRegistrationKeys.REMOTE_QUERY)

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "price_lists",
    variables: {
      filters: { id },
    },
    fields,
  })

  const [priceList] = await remoteQuery<PriceListGraph>(queryObject)

  if (!isPresent(priceList)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Price list with id: ${id} was not found`
    )
  }

  return transformPriceList(priceList)
}

export const transformPriceList = (priceList: PriceListGraph) => {
  priceList.rules = buildPriceListRules(priceList.price_list_rules)
  priceList.prices = buildPriceSetPricesForCore(priceList.prices)

  delete priceList.price_list_rules

  return priceList
}

export const fetchPriceListPriceIdsForProduct = async (
  priceListId: string,
  productIds: string[],
  scope: MedusaRequest["scope"]
): Promise<string[]> => {
  const remoteQuery = scope.resolve<<T>(input: ReturnType<typeof remoteQueryObjectFromString>) => Promise<T[]>>(ContainerRegistrationKeys.REMOTE_QUERY)
  const priceSetIds: string[] = []
  const variants = await remoteQuery<{ price_set?: { id: string } }>(
    remoteQueryObjectFromString({
      entryPoint: "variants",
      variables: { filters: { product_id: productIds } },
      fields: ["price_set.id"],
    })
  )

  for (const variant of variants) {
    if (variant.price_set?.id) {
      priceSetIds.push(variant.price_set.id)
    }
  }

  const productPrices = await remoteQuery<{ id: string }>(
    remoteQueryObjectFromString({
      entryPoint: "prices",
      variables: {
        filters: { price_set_id: priceSetIds, price_list_id: priceListId },
      },
      fields: ["id"],
    })
  )

  return productPrices.map((price) => price.id)
}
