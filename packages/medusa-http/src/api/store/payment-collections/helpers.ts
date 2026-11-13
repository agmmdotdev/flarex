import type { MedusaRequest } from "@medusajs/framework/http"
import { refetchEntity } from "@medusajs/framework/http"

export const refetchPaymentCollection = async (
  id: string,
  scope: MedusaRequest["scope"],
  fields: string[]
): Promise<unknown> => {
  return refetchEntity({
    entity: "payment_collection",
    idOrFilter: id,
    scope,
    fields,
  })
}
