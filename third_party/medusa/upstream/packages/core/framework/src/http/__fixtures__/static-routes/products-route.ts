import { MedusaRequest, MedusaResponse } from "../../types"

export const AUTHENTICATE = false

export const GET = async (_: MedusaRequest, res: MedusaResponse) => {
  res.status(200).json({
    products: [],
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  res.status(201).json({
    product: req.body,
  })
}

export const helper = () => {
  return "not a route handler"
}
