import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import type { MedusaErrorHandlerFunction } from "../types"
import { formatException } from "./exception-formatter"

/** Native HTTP exception, status and JSON projection for the selected routes. */
export function errorHandler(): MedusaErrorHandlerFunction {
  return (error, req, res) => {
    const logger = req.scope.resolve<{ error(error: unknown): void; info(message: string): void }>(ContainerRegistrationKeys.LOGGER)
    const err = formatException(error instanceof Error ? error : new Error("Unknown HTTP failure"))
    let status = 500
    let code = err?.code
    let type = err?.type
    let message = err?.message
    switch (type || err.name) {
      case "QueryRunnerAlreadyReleasedError":
      case "TransactionAlreadyStartedError":
      case "TransactionNotStartedError":
      case "conflict":
        status = 409; code = "invalid_state_error"
        message = "The request conflicted with another request. You may retry the request with the provided Idempotency-Key."
        break
      case "unauthorized": status = 401; break
      case "forbidden": status = 403; break
      case "payment_authorization_error": status = 422; break
      case "payload_too_large": status = 413; break
      case "duplicate_error": status = 422; code = "invalid_request_error"; break
      case "not_allowed": case "invalid_data": status = 400; break
      case "not_found": status = 404; break
      case "database_error": code = "api_error"; break
      case "unexpected_state": case "invalid_argument": break
      default: code = "unknown_error"; type = "unknown_error"; message = "An unknown error occurred."
    }
    if (status >= 500) logger.error(err)
    else logger.info(err.message)
    res.status(status).json({ code, type, message })
  }
}
