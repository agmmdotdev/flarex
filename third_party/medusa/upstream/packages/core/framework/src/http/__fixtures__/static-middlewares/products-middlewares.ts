import { z } from "../../../deps/zod"
import {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "../../types"
import { defineMiddlewares } from "../../utils/define-middlewares"

function detectAdditionalDataValidator(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  req.context = {
    ...(req.context ?? {}),
    hasAdditionalDataValidator: Boolean(req.additionalDataValidator),
  }
  next()
}

export default defineMiddlewares({
  errorHandler: (err, _req, res, _next) => {
    res.status(418).json({
      message: err.message,
    })
  },
  routes: [
    {
      matcher: "/static-middleware-products",
      method: "POST",
      additionalDataValidator: {
        title: z.string(),
      },
      middlewares: [detectAdditionalDataValidator],
    },
    {
      matcher: "/static-raw",
      method: "POST",
      bodyParser: false,
    },
  ],
})
