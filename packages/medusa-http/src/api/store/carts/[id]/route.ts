import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refetchCart } from "../helpers"

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const cart = await refetchCart(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.json({ cart })
}
