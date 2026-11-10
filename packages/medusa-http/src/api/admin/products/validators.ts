import { ProductStatus } from "@medusajs/utils/product/enums"
import { z } from "@medusajs/framework/zod"
import { applyAndAndOrOperators, booleanString } from "../../utils/common-validators"
import { GetProductsParams, transformProductParams } from "../../utils/common-validators/products"
import { createFindParams, createOperatorMap, createSelectParams, WithAdditionalData } from "../../utils/validators"
import { AdminGetProductVariantsParamsFields } from "../product-variants/validators"

const statusEnum = z.nativeEnum(ProductStatus)

export const AdminGetProductParams = createSelectParams()
export const AdminGetProductVariantParams = createSelectParams()
export const AdminGetProductOptionParams = createSelectParams()

export const AdminGetProductOptionsParamsFields = z.object({
  q: z.string().optional(),
  id: z.union([z.string(), z.array(z.string())]).optional(),
  title: z.string().optional(),
  created_at: createOperatorMap().optional(),
  updated_at: createOperatorMap().optional(),
  deleted_at: createOperatorMap().optional(),
})

export const AdminGetProductOptionsParams = createFindParams({ offset: 0, limit: 50 })
  .merge(AdminGetProductOptionsParamsFields)
  .merge(applyAndAndOrOperators(AdminGetProductOptionsParamsFields))

export const AdminGetProductsParamsDirectFields = z.object({
  variants: AdminGetProductVariantsParamsFields.omit({ q: true })
    .merge(applyAndAndOrOperators(AdminGetProductVariantsParamsFields.omit({ q: true })))
    .optional(),
  status: statusEnum.array().optional(),
})
export const AdminGetProductsParams = createFindParams({ offset: 0, limit: 50 })
  .merge(AdminGetProductsParamsDirectFields)
  .merge(z.object({ price_list_id: z.string().array().optional() })
    .merge(applyAndAndOrOperators(AdminGetProductsParamsDirectFields))
    .merge(GetProductsParams))
  .transform(transformProductParams)

export const CreateProductOption = z.object({
  title: z.string(),
  values: z.array(z.string()),
})

export const AdminCreateProductOption = WithAdditionalData(CreateProductOption)

export type AdminCreateProductOptionBody = z.infer<ReturnType<typeof AdminCreateProductOption>>

export const AdminCreateVariantPrice = z.object({
  currency_code: z.string(),
  amount: z.number(),
  min_quantity: z.number().nullish(),
  max_quantity: z.number().nullish(),
  rules: z.record(z.string(), z.string()).optional(),
})


export const CreateProductVariant = z
  .object({
    title: z.string(),
    sku: z.string().nullish(),
    ean: z.string().nullish(),
    upc: z.string().nullish(),
    barcode: z.string().nullish(),
    hs_code: z.string().nullish(),
    mid_code: z.string().nullish(),
    allow_backorder: booleanString().optional().default(false),
    manage_inventory: booleanString().optional().default(true),
    variant_rank: z.number().optional(),
    weight: z.number().nullish(),
    length: z.number().nullish(),
    height: z.number().nullish(),
    width: z.number().nullish(),
    origin_country: z.string().nullish(),
    material: z.string().nullish(),
    metadata: z.record(z.unknown()).nullish(),
    prices: z.array(AdminCreateVariantPrice),
    options: z.record(z.string()).optional(),
    inventory_items: z
      .array(
        z.object({
          inventory_item_id: z.string(),
          required_quantity: z.number(),
        })
      )
      .optional(),
  })
  .strict()

export const IdAssociation = z.object({
  id: z.string(),
})


export const CreateProduct = z
  .object({
    title: z.string(),
    subtitle: z.string().nullish(),
    description: z.string().nullish(),
    is_giftcard: booleanString().optional().default(false),
    discountable: booleanString().optional().default(true),
    images: z.array(z.object({ url: z.string() })).optional(),
    thumbnail: z.string().nullish(),
    handle: z.string().optional(),
    status: statusEnum.nullish().default(ProductStatus.DRAFT),
    external_id: z.string().nullish(),
    type_id: z.string().nullish(),
    collection_id: z.string().nullish(),
    categories: z.array(IdAssociation).optional(),
    tags: z.array(IdAssociation).optional(),
    options: z.array(CreateProductOption).optional(),
    variants: z.array(CreateProductVariant).optional(),
    sales_channels: z.array(z.object({ id: z.string() })).optional(),
    shipping_profile_id: z.string().optional(),
    weight: z.number().nullish(),
    length: z.number().nullish(),
    height: z.number().nullish(),
    width: z.number().nullish(),
    hs_code: z.string().nullish(),
    mid_code: z.string().nullish(),
    origin_country: z.string().nullish(),
    material: z.string().nullish(),
    metadata: z.record(z.unknown()).nullish(),
  })
  .strict()

export const AdminCreateProduct = WithAdditionalData(CreateProduct)


export type AdminCreateProductBody = z.infer<ReturnType<typeof AdminCreateProduct>>

export const UpdateProductOption = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  values: z.array(z.string()).optional(),
})

export const AdminUpdateProductOption = WithAdditionalData(UpdateProductOption)

export type AdminUpdateProductOptionBody = z.infer<ReturnType<typeof AdminUpdateProductOption>>

export const AdminUpdateVariantPrice = z.object({
  id: z.string().optional(),
  currency_code: z.string().optional(),
  amount: z.number().optional(),
  min_quantity: z.number().nullish(),
  max_quantity: z.number().nullish(),
  rules: z.record(z.string(), z.string()).optional(),
})

export const UpdateProductVariant = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    prices: z.array(AdminUpdateVariantPrice).optional(),
    sku: z.string().nullish(),
    ean: z.string().nullish(),
    upc: z.string().nullish(),
    barcode: z.string().nullish(),
    hs_code: z.string().nullish(),
    mid_code: z.string().nullish(),
    thumbnail: z.string().nullish(),
    allow_backorder: booleanString().optional(),
    manage_inventory: booleanString().optional(),
    variant_rank: z.number().optional(),
    weight: z.number().nullish(),
    length: z.number().nullish(),
    height: z.number().nullish(),
    width: z.number().nullish(),
    origin_country: z.string().nullish(),
    material: z.string().nullish(),
    metadata: z.record(z.unknown()).nullish(),
    options: z.record(z.string()).optional(),
  })
  .strict()

export const UpdateProduct = z
  .object({
    title: z.string().optional(),
    discountable: booleanString().optional(),
    is_giftcard: booleanString().optional(),
    options: z.array(UpdateProductOption).optional(),
    variants: z.array(UpdateProductVariant).optional(),
    status: statusEnum.optional(),
    subtitle: z.string().nullish(),
    description: z.string().nullish(),
    images: z
      .array(z.object({ id: z.string().optional(), url: z.string() }))
      .optional(),
    thumbnail: z.string().nullish(),
    handle: z.string().nullish(),
    type_id: z.string().nullish(),
    external_id: z.string().nullish(),
    collection_id: z.string().nullish(),
    categories: z.array(IdAssociation).optional(),
    tags: z.array(IdAssociation).optional(),
    sales_channels: z.array(z.object({ id: z.string() })).optional(),
    shipping_profile_id: z.string().nullish(),
    weight: z.number().nullish(),
    length: z.number().nullish(),
    height: z.number().nullish(),
    width: z.number().nullish(),
    hs_code: z.string().nullish(),
    mid_code: z.string().nullish(),
    origin_country: z.string().nullish(),
    material: z.string().nullish(),
    metadata: z.record(z.unknown()).nullish(),
  })
  .strict()

export const AdminUpdateProduct = WithAdditionalData(UpdateProduct)

export type AdminUpdateProductBody = z.infer<ReturnType<typeof AdminUpdateProduct>>

export const AdminCreateProductVariant = WithAdditionalData(CreateProductVariant)

export const AdminUpdateProductVariant = WithAdditionalData(UpdateProductVariant)

export type AdminUpdateProductVariantBody = z.infer<ReturnType<typeof AdminUpdateProductVariant>>
