import { z } from "@medusajs/framework/zod"
import { createSelectParams } from "../../utils/validators"

export const AdminGetPriceListParams = createSelectParams()

export const AdminRemoveProductsPriceList = z.object({
  remove: z.array(z.string()).optional(),
})

export type AdminRemoveProductsPriceListBody = z.infer<typeof AdminRemoveProductsPriceList>
