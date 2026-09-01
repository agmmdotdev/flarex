import type { Logger } from "@medusajs/types"
import type {
  MedusaErrorHandlerFunction,
  MiddlewareDescriptor,
  MiddlewareFunction,
  RouteDescriptor,
  RouteHandler,
} from "../types"

export type HttpTraceRoute = (
  handler: RouteHandler,
  route: { route: string; method: string }
) => RouteHandler

export type HttpTraceMiddleware = (
  handler: MiddlewareFunction,
  route: { route: string; method?: string }
) => MiddlewareFunction

export type HttpRuntimeAdapterOptions = {
  logger: Logger
  traceRoute?: HttpTraceRoute
  traceMiddleware?: HttpTraceMiddleware
  isRouteFileDisabled?: (matcher: string) => boolean
}

export interface HttpRuntimeAdapter {
  registerRestrictedFields(baseRestrictedFields: string[]): void

  registerGlobalMiddleware(
    matcher: string,
    handler: MiddlewareFunction | MiddlewareFunction[]
  ): void

  registerResource(route: MiddlewareDescriptor | RouteDescriptor): void

  registerErrorHandler(handler: MedusaErrorHandlerFunction): void

  clearAllResources(initialStackLength: number): void
}
