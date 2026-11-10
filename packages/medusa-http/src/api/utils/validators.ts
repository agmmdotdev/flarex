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

/** Selected native string/date filter operators. */
export const createOperatorMap = () => {
  const simpleType = z.string().optional()
  const arrayType = z.array(z.string()).optional()
  const unionType = z.union([simpleType, arrayType]).optional()
  return z.union([
    unionType,
    z.object({
      $eq: unionType, $ne: unionType, $in: arrayType, $nin: arrayType,
      $like: simpleType, $ilike: simpleType, $re: simpleType,
      $contains: simpleType, $gt: simpleType, $gte: simpleType,
      $lt: simpleType, $lte: simpleType,
    }),
  ])
}

export const createLinkBody = () => {
  return z.object({
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
  })
}

export const createBatchBody = (
  createValidator: z.ZodType,
  updateValidator: z.ZodType,
  deleteValidator: z.ZodType = z.string()
) => {
  return z.object({
    create: z.array(createValidator).optional(),
    update: z.array(updateValidator).optional(),
    delete: z.array(deleteValidator).optional(),
  })
}
