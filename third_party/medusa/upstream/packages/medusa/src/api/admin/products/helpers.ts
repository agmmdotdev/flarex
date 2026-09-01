import {
  BatchMethodResponse,
  BatchResponse,
  HttpTypes,
  LinkDefinition,
  MedusaContainer,
  PriceDTO,
  ProductDTO,
  ProductVariantDTO,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  promiseAll,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { AdminBatchVariantInventoryItemsType } from "./validators"

type ProductVariantWithPriceSet = ProductVariantDTO & {
  price_set?: {
    prices?: PriceDTO[]
  }
}

function toAdminPriceNumber(value: PriceDTO["amount"]): number {
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    return Number(value)
  }

  return 0
}

function toNullableAdminPriceNumber(
  value: PriceDTO["min_quantity"]
): number | null {
  if (value === null || value === undefined) {
    return null
  }

  return toAdminPriceNumber(value)
}

function toAdminPriceTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

const isPricing = (fieldName: string) =>
  fieldName.startsWith("variants.prices") ||
  fieldName.startsWith("*variants.prices") ||
  fieldName.startsWith("prices") ||
  fieldName.startsWith("*prices")

// The variant had prices before, but that is not part of the price_set money amounts. Do we remap the request and response or not?
export const remapKeysForProduct = (selectFields: string[]) => {
  const productFields = selectFields.filter(
    (fieldName: string) => !isPricing(fieldName)
  )

  const pricingFields = selectFields
    .filter((fieldName: string) => isPricing(fieldName))
    .map((fieldName: string) =>
      fieldName.replace("variants.prices.", "variants.price_set.prices.")
    )

  return [...productFields, ...pricingFields]
}

export const remapKeysForVariant = (selectFields: string[]) => {
  const variantFields = selectFields.filter(
    (fieldName: string) => !isPricing(fieldName)
  )

  const pricingFields = selectFields
    .filter((fieldName: string) => isPricing(fieldName))
    .map((fieldName: string) =>
      fieldName.replace("prices.", "price_set.prices.")
    )

  return [...variantFields, ...pricingFields]
}

export const remapProductResponse = (
  product: ProductDTO
): HttpTypes.AdminProduct => {
  return {
    ...product,
    variants: product.variants?.map(remapVariantResponse),
  } as HttpTypes.AdminProduct
}

export const remapVariantResponse = (
  variant: ProductVariantDTO
): HttpTypes.AdminProductVariant => {
  if (!variant) {
    return variant
  }

  const { price_set: priceSet, ...variantWithoutPriceSet } =
    variant as ProductVariantWithPriceSet

  const resp = {
    ...variantWithoutPriceSet,
    prices: priceSet?.prices?.map((price) => ({
      id: price.id,
      title: price.title ?? "",
      amount: toAdminPriceNumber(price.amount),
      raw_amount: {
        value: price.amount ?? 0,
      },
      currency_code: price.currency_code ?? "",
      min_quantity: toNullableAdminPriceNumber(price.min_quantity),
      max_quantity: toNullableAdminPriceNumber(price.max_quantity),
      price_set_id: price.price_set_id ?? "",
      variant_id: variant.id,
      created_at: toAdminPriceTimestamp(price.created_at),
      updated_at: toAdminPriceTimestamp(price.updated_at),
      deleted_at: price.deleted_at
        ? toAdminPriceTimestamp(price.deleted_at)
        : null,
      rules: buildRules(price),
    })),
  }

  return resp as HttpTypes.AdminProductVariant
}

export const buildRules = (price: PriceDTO) => {
  const rules: Record<string, string> = {}

  for (const priceRule of price.price_rules || []) {
    const ruleAttribute = priceRule.attribute

    if (ruleAttribute) {
      rules[ruleAttribute] = priceRule.value
    }
  }

  return rules
}

export const refetchVariant = async (
  variantId: string,
  scope: MedusaContainer,
  fields: string[]
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "product_variant",
    variables: {
      filters: { id: variantId },
    },
    fields: remapKeysForVariant(fields ?? []),
  })

  const [variant] = await remoteQuery(queryObject)

  return remapVariantResponse(variant)
}

export const refetchBatchProducts = async (
  batchResult: BatchMethodResponse<ProductDTO>,
  scope: MedusaContainer,
  fields: string[]
): Promise<BatchResponse<ProductDTO>> => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  let created = Promise.resolve<ProductDTO[]>([])
  let updated = Promise.resolve<ProductDTO[]>([])

  if (batchResult.created.length) {
    const createdQuery = remoteQueryObjectFromString({
      entryPoint: "product",
      variables: {
        filters: { id: batchResult.created.map((p) => p.id) },
      },
      fields: remapKeysForProduct(fields ?? []),
    })

    created = remoteQuery(createdQuery)
  }

  if (batchResult.updated.length) {
    const updatedQuery = remoteQueryObjectFromString({
      entryPoint: "product",
      variables: {
        filters: { id: batchResult.updated.map((p) => p.id) },
      },
      fields: remapKeysForProduct(fields ?? []),
    })

    updated = remoteQuery(updatedQuery)
  }

  const [createdRes, updatedRes] = await promiseAll([created, updated])
  return {
    created: createdRes,
    updated: updatedRes,
    deleted: {
      ids: batchResult.deleted,
      object: "product",
      deleted: true,
    },
  }
}

export const refetchBatchVariants = async (
  batchResult: BatchMethodResponse<ProductVariantDTO>,
  scope: MedusaContainer,
  fields: string[]
): Promise<BatchResponse<ProductVariantDTO>> => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  let created = Promise.resolve<ProductVariantDTO[]>([])
  let updated = Promise.resolve<ProductVariantDTO[]>([])

  if (batchResult.created.length) {
    const createdQuery = remoteQueryObjectFromString({
      entryPoint: "variant",
      variables: {
        filters: { id: batchResult.created.map((v) => v.id) },
      },
      fields: remapKeysForVariant(fields ?? []),
    })

    created = remoteQuery(createdQuery)
  }

  if (batchResult.updated.length) {
    const updatedQuery = remoteQueryObjectFromString({
      entryPoint: "variant",
      variables: {
        filters: { id: batchResult.updated.map((v) => v.id) },
      },
      fields: remapKeysForVariant(fields ?? []),
    })

    updated = remoteQuery(updatedQuery)
  }

  const [createdRes, updatedRes] = await promiseAll([created, updated])
  return {
    created: createdRes,
    updated: updatedRes,
    deleted: {
      ids: batchResult.deleted,
      object: "variant",
      deleted: true,
    },
  }
}

export const buildBatchVariantInventoryData = (
  inputs:
    | AdminBatchVariantInventoryItemsType["create"]
    | AdminBatchVariantInventoryItemsType["update"]
    | AdminBatchVariantInventoryItemsType["delete"]
) => {
  const results: LinkDefinition[] = []

  for (const input of inputs || []) {
    const result: LinkDefinition = {
      [Modules.PRODUCT]: { variant_id: input.variant_id },
      [Modules.INVENTORY]: {
        inventory_item_id: input.inventory_item_id,
      },
    }

    if ("required_quantity" in input) {
      result.data = {
        required_quantity: input.required_quantity,
      }
    }

    results.push(result)
  }

  return results
}
