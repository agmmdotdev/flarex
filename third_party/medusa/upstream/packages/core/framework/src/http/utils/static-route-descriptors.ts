import {
  HTTP_METHODS,
  type RouteDescriptor,
  type RouteHandler,
  type RouteVerb,
} from "../types"
import { isStaticHttpFileSkipped } from "./static-skip-file"
import {
  silentStaticHttpBuilderLogger,
  type StaticHttpBuilderLogger,
} from "./static-builder-logger"

const AUTHTHENTICATION_FLAG = "AUTHENTICATE"
const CORS_FLAG = "CORS"

const ADMIN_ROUTE_MATCH = /(\/admin$|\/admin\/)/
const STORE_ROUTE_MATCH = /(\/store$|\/store\/)/
const AUTH_ROUTE_MATCH = /(\/auth$|\/auth\/)/

export type StaticRouteDescriptorInput = {
  route: string
  module: object
  absolutePath?: string
  relativePath?: string
  logger?: StaticHttpBuilderLogger
}

function isRouteHandler(value: unknown): value is RouteHandler {
  return typeof value === "function"
}

export function buildStaticRouteDescriptors({
  route,
  module: routeModule,
  absolutePath,
  relativePath,
  logger = silentStaticHttpBuilderLogger,
}: StaticRouteDescriptorInput): RouteDescriptor[] {
  // Route modules are imported dynamically or statically from user files, so
  // their export bag is only validated at this HTTP resource boundary.
  const routeExports = routeModule as Record<string, unknown>

  if (isStaticHttpFileSkipped(routeExports, absolutePath ?? relativePath)) {
    return []
  }

  const routeType = ADMIN_ROUTE_MATCH.test(route)
    ? "admin"
    : STORE_ROUTE_MATCH.test(route)
    ? "store"
    : AUTH_ROUTE_MATCH.test(route)
    ? "auth"
    : undefined

  const shouldAuthenticate =
    AUTHTHENTICATION_FLAG in routeExports
      ? !!routeExports[AUTHTHENTICATION_FLAG]
      : true

  const shouldApplyCors =
    CORS_FLAG in routeExports ? !!routeExports[CORS_FLAG] : true

  return Object.keys(routeExports)
    .filter((key) => {
      if (!isRouteHandler(routeExports[key])) {
        return false
      }

      if (!HTTP_METHODS.includes(key as RouteVerb)) {
        logger.debug(
          `Skipping handler ${key} in ${absolutePath ?? route}. Invalid HTTP method: ${key}.`
        )
        return false
      }

      return true
    })
    .map((key) => {
      const handler = routeExports[key]

      if (!isRouteHandler(handler)) {
        throw new Error(
          `Route handler ${key} in ${absolutePath ?? route} is not a function.`
        )
      }

      return {
        isRoute: true,
        matcher: route,
        method: key as RouteVerb,
        handler,
        optedOutOfAuth: !shouldAuthenticate,
        absolutePath,
        relativePath,
        shouldAppendAdminCors: shouldApplyCors && routeType === "admin",
        shouldAppendAuthCors: shouldApplyCors && routeType === "auth",
        shouldAppendStoreCors: shouldApplyCors && routeType === "store",
      } satisfies RouteDescriptor
    })
}
