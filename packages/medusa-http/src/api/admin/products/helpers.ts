import type { PriceDTO, ProductTypes, ProductVariantDTO } from "@medusajs/framework/types"

type ProductDTO = ProductTypes.ProductDTO

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
): ProductDTO => {
  return {
    ...product,
    variants: product.variants?.map(remapVariantResponse),
  }
}

export const remapVariantResponse = (
  variant: ProductVariantDTO
): ProductVariantDTO => {
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

  return resp
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
