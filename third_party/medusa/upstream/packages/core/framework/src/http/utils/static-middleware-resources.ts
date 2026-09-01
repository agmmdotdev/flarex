import { z } from "@medusajs/deps/zod"

import {
  type AdditionalDataValidatorRoute,
  type BodyParserConfigRoute,
  HTTP_METHODS,
  type HttpPathMatching,
  type MedusaErrorHandlerFunction,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
  type MiddlewareDescriptor,
  type MiddlewaresConfig,
} from "../types"
import { isStaticHttpFileSkipped } from "./static-skip-file"
import {
  silentStaticHttpBuilderLogger,
  type StaticHttpBuilderLogger,
} from "./static-builder-logger"

export type StaticMiddlewareResources = {
  middlewares: MiddlewareDescriptor[]
  errorHandler?: MedusaErrorHandlerFunction
  bodyParserConfigRoutes: BodyParserConfigRoute[]
  additionalDataValidatorRoutes: AdditionalDataValidatorRoute[]
}

export type StaticMiddlewareResourceInput = {
  module: object
  source?: string
  logger?: StaticHttpBuilderLogger
}

function emptyMiddlewareResources(): StaticMiddlewareResources {
  return {
    middlewares: [],
    bodyParserConfigRoutes: [],
    additionalDataValidatorRoutes: [],
  }
}

function getHttpMethods(
  route: NonNullable<MiddlewaresConfig["routes"]>[number]
): BodyParserConfigRoute["methods"] {
  let methods = route.methods ?? route.method ?? [...HTTP_METHODS]
  const methodList = Array.isArray(methods) ? methods : [methods]

  if (methodList.includes("ALL")) {
    methods = [...HTTP_METHODS]
  }

  return methods
}

function getPathMatching(
  route: NonNullable<MiddlewaresConfig["routes"]>[number]
): HttpPathMatching {
  const matcher = String(route.matcher)
  if (matcher.includes("*")) {
    return "prefix"
  }

  return route.methods || route.method ? "exact" : "prefix"
}

function noopMiddleware(
  _req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  next()
}

export function buildStaticMiddlewareResources({
  module: middlewareModule,
  source,
  logger = silentStaticHttpBuilderLogger,
}: StaticMiddlewareResourceInput): StaticMiddlewareResources {
  // Middleware modules enter through dynamic filesystem imports today and
  // static manifest imports later, so validate the export bag at this boundary.
  const middlewareExports = middlewareModule as Record<string, unknown>

  if (isStaticHttpFileSkipped(middlewareExports, source)) {
    return emptyMiddlewareResources()
  }

  const middlewareConfig = middlewareExports.default
  if (!middlewareConfig) {
    logger.warn(
      `No middleware configuration found in ${
        source ?? "static middleware module"
      }. Skipping middleware configuration.`
    )
    return emptyMiddlewareResources()
  }

  const routes = (middlewareConfig as MiddlewaresConfig).routes
  if (!routes || !Array.isArray(routes)) {
    logger.warn(
      `Invalid default export found in ${
        source ?? "static middleware module"
      }. Make sure to use "defineMiddlewares" function and export its output.`
    )
    return emptyMiddlewareResources()
  }

  const result = routes.reduce<StaticMiddlewareResources>(
    (result, route) => {
      if (!route.matcher) {
        throw new Error(
          `Middleware is missing a \`matcher\` field. The 'matcher' field is required when applying middleware. ${JSON.stringify(
            route,
            null,
            2
          )}`
        )
      }

      const matcher = String(route.matcher)

      const methods = getHttpMethods(route)
      const pathMatching = getPathMatching(route)

      if (route.bodyParser !== undefined) {

        logger.debug(
          `using custom bodyparser config on matcher ${methods}:${route.matcher}`
        )

        result.bodyParserConfigRoutes.push({
          matcher,
          methods,
          pathMatching,
          config: route.bodyParser,
        })
      }

      if (route.additionalDataValidator !== undefined) {

        logger.debug(
          `assigning additionalData validator on matcher ${methods}:${route.matcher}`
        )

        result.additionalDataValidatorRoutes.push({
          matcher,
          methods,
          pathMatching,
          schema: route.additionalDataValidator,
          validator: z.object(route.additionalDataValidator).nullish(),
        })
      }

      if (route.middlewares || route.policies) {
        const middlewares = route.middlewares ?? []
        if (route.policies && !route.middlewares?.length) {
          middlewares.push(noopMiddleware)
        }

        middlewares.forEach((middleware) => {
          result.middlewares.push({
            handler: middleware,
            matcher,
            methods,
            pathMatching,
            policies: route.policies,
          })
        })
      }

      return result
    },
    emptyMiddlewareResources()
  )

  const errorHandler = (middlewareConfig as MiddlewaresConfig).errorHandler
  if (errorHandler) {
    result.errorHandler = errorHandler
  }

  return result
}
