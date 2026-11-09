import { z } from "@medusajs/framework/zod"

/** Selected native default additional-data branch; no route extension is admitted. */
export const WithAdditionalData = <T extends z.AnyZodObject>(originalSchema: T) => () =>
  originalSchema.extend({ additional_data: z.record(z.unknown()).nullish() })

export const createSelectParams = () => {
  return z.object({
    fields: z.string().optional(),
  })
}

export const createFindParams = ({
  offset,
  limit,
  order,
}: {
  offset?: number
  limit?: number
  order?: string
} = {}) => {
  const selectParams = createSelectParams()

  return selectParams.merge(
    z.object({
      offset: z.preprocess(
        (val) => {
          if (val && typeof val === "string") {
            return parseInt(val)
          }
          return val
        },
        z
          .number()
          .optional()
          .default(offset ?? 0)
      ),
      limit: z.preprocess(
        (val) => {
          if (val && typeof val === "string") {
            return parseInt(val)
          }
          return val
        },
        z
          .number()
          .optional()
          .default(limit ?? 20)
      ),
      order: order
        ? z.string().optional().default(order)
        : z.string().optional(),
      with_deleted: z.preprocess((val) => {
        if (val && typeof val === "string") {
          return val === "true" ? true : val === "false" ? false : val
        }
        return val
      }, z.boolean().optional()),
    })
  )
}
