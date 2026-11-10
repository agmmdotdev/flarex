import { z } from "@medusajs/framework/zod"
import { booleanString } from "../../utils/common-validators"
import { createOperatorMap } from "../../utils/validators"

export const AdminGetProductVariantsParamsFields = z.object({
  q: z.string().optional(),
  id: z.union([z.string(), z.array(z.string())]).optional(),
  manage_inventory: booleanString().optional(),
  allow_backorder: booleanString().optional(),
  ean: z.union([z.string(), z.array(z.string())]).optional(),
  upc: z.union([z.string(), z.array(z.string())]).optional(),
  barcode: z.union([z.string(), z.array(z.string())]).optional(),
  created_at: createOperatorMap().optional(),
  updated_at: createOperatorMap().optional(),
  deleted_at: createOperatorMap().optional(),
})
