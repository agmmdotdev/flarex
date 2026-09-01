import { FeatureFlag } from "@medusajs/utils"
import type {
  ErrorRequestHandler,
  Express,
  IRouter,
  RequestHandler,
} from "express"
import { wrapWithPoliciesCheck } from "../middlewares/check-permissions"
import type {
  MedusaErrorHandlerFunction,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareDescriptor,
  MiddlewareFunction,
  RouteDescriptor,
} from "../types"
import { RestrictedFields } from "../utils/restricted-fields"
import { wrapHandler } from "../utils/wrap-handler"
import type { HttpRuntimeAdapter, HttpRuntimeAdapterOptions } from "./types"

type ExpressHttpAdapterOptions = HttpRuntimeAdapterOptions & {
  app: Express
}

const toExpressHandler = (handler: MiddlewareFunction): RequestHandler => {
  return handler as unknown as RequestHandler
}

const toExpressHandlers = (
  handler: MiddlewareFunction | MiddlewareFunction[]
): RequestHandler | RequestHandler[] => {
  if (Array.isArray(handler)) {
    return handler.map(toExpressHandler)
  }

  return toExpressHandler(handler)
}

const toExpressErrorHandler = (
  handler: MedusaErrorHandlerFunction
): ErrorRequestHandler => {
  return handler as unknown as ErrorRequestHandler
}

export class ExpressHttpAdapter implements HttpRuntimeAdapter {
  readonly #app: Express
  readonly #options: HttpRuntimeAdapterOptions

  constructor({ app, ...options }: ExpressHttpAdapterOptions) {
    this.#app = app
    this.#options = options
  }

  registerRestrictedFields(baseRestrictedFields: string[]): void {
    this.#app.use("/store", ((
      req: MedusaRequest,
      _: MedusaResponse,
      next: MedusaNextFunction
    ) => {
      req.restrictedFields = new RestrictedFields()
      req.restrictedFields.add(baseRestrictedFields)
      next()
    }) as RequestHandler)

    this.#app.use("/admin", ((
      req: MedusaRequest,
      _: MedusaResponse,
      next: MedusaNextFunction
    ) => {
      req.restrictedFields = new RestrictedFields()
      next()
    }) as RequestHandler)
  }

  registerGlobalMiddleware(
    matcher: string,
    handler: MiddlewareFunction | MiddlewareFunction[]
  ): void {
    this.#app.use(matcher, toExpressHandlers(handler))
  }

  registerResource(route: MiddlewareDescriptor | RouteDescriptor): void {
    if ("isRoute" in route) {
      this.#registerRoute(route)
      return
    }

    this.#registerMiddleware(route)
  }

  registerErrorHandler(handler: MedusaErrorHandlerFunction): void {
    this.#app.use(toExpressErrorHandler(handler))
  }

  clearAllResources(initialStackLength: number): void {
    const router = this.#app._router as IRouter | undefined

    if (router?.stack) {
      router.stack.splice(initialStackLength)
    }
  }

  #registerRoute(route: RouteDescriptor): void {
    this.#options.logger.debug(
      `registering route ${route.method} ${route.matcher}`
    )

    const handler = this.#options.traceRoute
      ? this.#options.traceRoute(route.handler, {
          route: route.matcher,
          method: route.method,
        })
      : route.handler

    this.#app[route.method.toLowerCase()](
      route.matcher,
      wrapHandler(handler) as unknown as RequestHandler
    )
  }

  #registerMiddleware(route: MiddlewareDescriptor): void {
    const isRbacEnabled = FeatureFlag.isFeatureEnabled("rbac")

    if (!route.methods) {
      this.#options.logger.debug(
        `registering global middleware for ${route.matcher}`
      )

      let handlerToUse = route.handler
      if (route.policies && isRbacEnabled) {
        handlerToUse = wrapWithPoliciesCheck(route.handler, route.policies)
      }

      const handler = this.#options.traceMiddleware
        ? this.#options.traceMiddleware(handlerToUse, {
            route: route.matcher,
          })
        : handlerToUse

      this.#app.use(
        route.matcher,
        wrapHandler(handler) as unknown as RequestHandler
      )
      return
    }

    const methods = Array.isArray(route.methods)
      ? route.methods
      : [route.methods]

    methods.forEach((method) => {
      const isDisabled = this.#options.isRouteFileDisabled?.(route.matcher)
      if (isDisabled) {
        this.#options.logger.debug(
          `skipping disabled route middleware registration for ${method} ${route.matcher}`
        )
        return
      }

      this.#options.logger.debug(
        `registering route middleware ${method} ${route.matcher}`
      )

      let handlerToUse = route.handler
      if (route.policies && isRbacEnabled) {
        handlerToUse = wrapWithPoliciesCheck(route.handler, route.policies)
      }

      const handler = this.#options.traceMiddleware
        ? this.#options.traceMiddleware(wrapHandler(handlerToUse), {
            route: route.matcher,
            method,
          })
        : wrapHandler(handlerToUse)

      this.#app[method.toLowerCase()](
        route.matcher,
        handler as unknown as RequestHandler
      )
    })
  }
}
