import { z } from "@medusajs/framework/zod"
import { applyAndAndOrOperators, booleanString } from "../../utils/common-validators"
import { createFindParams } from "../../utils/validators"

export const StoreGetShippingOptionsFields = z
  .object({
    cart_id: z.string(),
    is_return: booleanString().optional(),
  })
  .strict()
export const StoreGetShippingOptions = createFindParams({
  limit: 20,
  offset: 0,
})
  .merge(StoreGetShippingOptionsFields)
  .merge(applyAndAndOrOperators(StoreGetShippingOptionsFields))
export type StoreGetShippingOptionsType = z.infer<typeof StoreGetShippingOptions>
