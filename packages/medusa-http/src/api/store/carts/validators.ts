import { z } from "@medusajs/framework/zod"
import { AddressPayload } from "../../utils/common-validators"
import { createSelectParams, WithAdditionalData } from "../../utils/validators"

export type StoreGetPromotionType = z.infer<typeof StoreGetCartsCart>
export const StoreGetCartsCart = createSelectParams()

const ItemSchema = z.object({
  variant_id: z.string(),
  quantity: z.number().gt(0),
  metadata: z.record(z.unknown()).nullish(),
})

export type StoreCreateCartType = z.infer<typeof CreateCart>
export const CreateCart = z
  .object({
    region_id: z.string().nullish(),
    shipping_address: z.union([AddressPayload, z.string()]).optional(),
    billing_address: z.union([AddressPayload, z.string()]).optional(),
    email: z.string().email().nullish(),
    currency_code: z.string().nullish(),
    items: z.array(ItemSchema).optional(),
    sales_channel_id: z.string().nullish(),
    promo_codes: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).nullish(),
    locale: z.string().nullish(),
  })
  .strict()
export const StoreCreateCart = WithAdditionalData(CreateCart)
