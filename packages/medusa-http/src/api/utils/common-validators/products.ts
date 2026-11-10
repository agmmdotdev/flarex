import { ProductStatus } from "@medusajs/utils/product/enums"
import { isPresent } from "@medusajs/utils/common/is-present"
import { z } from "@medusajs/framework/zod"
import { createOperatorMap } from "../validators"
import { booleanString } from "../common-validators"

export const ProductStatusEnum = z.nativeEnum(ProductStatus)
export const StoreGetProductParamsDirectFields = z.object({
  q: z.string().optional(),
  id: z.union([z.string(), z.array(z.string())]).optional(),
  title: z.union([z.string(), z.array(z.string())]).optional(),
  handle: z.union([z.string(), z.array(z.string())]).optional(),
  is_giftcard: booleanString().optional(),
  category_id: z.union([z.string(), z.array(z.string())]).optional(),
  external_id: z.union([z.string(), z.array(z.string())]).optional(),
  collection_id: z.union([z.string(), z.array(z.string())]).optional(),
  tag_id: z.union([z.string(), z.array(z.string())]).optional(),
  type_id: z.union([z.string(), z.array(z.string())]).optional(),
  created_at: createOperatorMap().optional(),
  updated_at: createOperatorMap().optional(),
  deleted_at: createOperatorMap().optional(),
})
export const GetProductsParams = z.object({
  sales_channel_id: z.union([z.string(), z.array(z.string())]).optional(),
}).merge(StoreGetProductParamsDirectFields)

/** Native tag/category remapping; retain the precise validated selector shape. */
export function transformProductParams<T extends z.infer<typeof GetProductsParams>>(data: T) {
  const res: Omit<T, "tag_id" | "category_id"> & {
    tag_id?: T["tag_id"]
    category_id?: T["category_id"]
    tags?: { id: T["tag_id"] }
    categories?: { id: T["category_id"] }
  } = { ...data }
  if (isPresent(data.tag_id)) {
    res.tags = { id: data.tag_id }
    delete res.tag_id
  }
  if (isPresent(data.category_id)) {
    res.categories = { id: data.category_id }
    delete res.category_id
  }
  return res
}
