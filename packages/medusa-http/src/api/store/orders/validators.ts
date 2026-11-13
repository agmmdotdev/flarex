import { z } from "@medusajs/framework/zod"
import { createSelectParams } from "../../utils/validators"

export const StoreGetOrderParams = createSelectParams()
export type StoreGetOrderParamsType = z.infer<typeof StoreGetOrderParams>
