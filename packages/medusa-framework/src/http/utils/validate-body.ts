import { zodValidator } from "../../zod"
import type { AdditionalDataValidator, BodySchema, MiddlewareFunction } from "../types"

/** Selected native http/utils/validate-body.ts, with neutral schema signatures. */
export function validateAndTransformBody(
  zodSchema: BodySchema | ((customSchema?: AdditionalDataValidator) => BodySchema)
): MiddlewareFunction {
  return async function validateBody(req, _res, next) {
    try {
      const schema = typeof zodSchema === "function" ? zodSchema(req.additionalDataValidator) : zodSchema
      req.validatedBody = await zodValidator(schema, req.body)
      next()
    } catch (error) {
      next(error)
    }
  }
}
