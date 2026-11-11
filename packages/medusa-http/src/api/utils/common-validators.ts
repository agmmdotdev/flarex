import { z } from "@medusajs/framework/zod"

export const AddressPayload = z
  .object({
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    phone: z.string().nullish(),
    company: z.string().nullish(),
    address_1: z.string().nullish(),
    address_2: z.string().nullish(),
    city: z.string().nullish(),
    country_code: z.string().nullish(),
    province: z.string().nullish(),
    postal_code: z.string().nullish(),
    metadata: z.record(z.unknown()).nullish(),
  })
  .strict()

export const applyAndAndOrOperators = <Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>
) => {
  return schema.merge(
    z.object({
      $and: z.lazy(() => schema.array()).optional(),
      $or: z.lazy(() => schema.array()).optional(),
    })
  )
}

export const booleanString = () =>
  z
    .union([z.boolean(), z.string()])
    .refine((value) => {
      return ["true", "false"].includes(value.toString().toLowerCase())
    })
    .transform((value) => {
      return value.toString().toLowerCase() === "true"
    })

export function recursivelyNormalizeSchema<
  Data extends object,
  NormalizedData extends object
>(transform: (data: Data) => NormalizedData): (data: Data) => NormalizedData {
  type LogicalOperator = "$and" | "$or"
  type InputLogicalData = Partial<Record<LogicalOperator, Data[]>>
  type OutputLogicalData = Partial<Record<LogicalOperator, NormalizedData[]>>

  return (data: Data) => {
    const normalizedData = transform(data)
    const logicalInput = normalizedData as NormalizedData & InputLogicalData
    const logicalOutput = normalizedData as NormalizedData & OutputLogicalData

    for (const key of ["$and", "$or"] as const) {
      const value = logicalInput[key]
      if (Array.isArray(value)) {
        logicalOutput[key] = value.map(transform)
      }
    }

    return logicalOutput
  }
}
