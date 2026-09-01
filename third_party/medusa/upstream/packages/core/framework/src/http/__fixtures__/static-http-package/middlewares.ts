import { z } from "../../../deps/zod"
import {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "../../types"
import { defineMiddlewares } from "../../utils/define-middlewares"
import {
  customersCreateMiddlewareMock,
  customersCreateMiddlewareValidatorMock,
  customersGlobalMiddlewareMock,
  storeGlobalMiddlewareMock,
} from "../mocks"

const customersGlobalMiddleware = (
  _req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  customersGlobalMiddlewareMock()
  next()
}

const customersCreateMiddleware = (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  if (req.additionalDataValidator) {
    customersCreateMiddlewareValidatorMock()
  }
  customersCreateMiddlewareMock()
  next()
}

const storeGlobal = (
  _req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  storeGlobalMiddlewareMock()
  next()
}

export default defineMiddlewares([
  {
    matcher: "/customers",
    middlewares: [customersGlobalMiddleware],
  },
  {
    method: "POST",
    matcher: "/customers",
    additionalDataValidator: {
      group_id: z.string(),
    },
    middlewares: [customersCreateMiddleware],
  },
  {
    matcher: "/store/*",
    middlewares: [storeGlobal],
  },
])
