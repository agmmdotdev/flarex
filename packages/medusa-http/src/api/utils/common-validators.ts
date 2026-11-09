import { z } from "@medusajs/framework/zod"

export const applyAndAndOrOperators = <T extends z.ZodObject<any>>(
  schema: T
) => {
  return schema.merge(
    z.object({
      $and: z.lazy(() => schema.array()).optional(),
      $or: z.lazy(() => schema.array()).optional(),
    })
  )
}
