import type {
  HttpResourceSet,
  StaticHttpResourceSetInput,
} from "../resolvers/types"
import { createRoutePathFromRelativePath } from "./route-path"
import type { StaticHttpBuilderLogger } from "./static-builder-logger"
import { buildStaticMiddlewareResources } from "./static-middleware-resources"
import { buildStaticRouteDescriptors } from "./static-route-descriptors"

export type StaticRouteModuleResource = {
  route?: string
  module: object
  absolutePath?: string
  relativePath?: string
}

export type StaticMiddlewareModuleResource = {
  module: object
  source?: string
}

export type StaticHttpResourceManifest = {
  routes?: StaticRouteModuleResource[]
  middlewares?: StaticMiddlewareModuleResource[]
}

export type StaticHttpResourceBuildOptions = {
  logger?: StaticHttpBuilderLogger
}

type StaticHttpManifestEntryKeyResolver<TEntry> = (
  entry: TEntry
) => string | undefined

export function mergeStaticHttpResourceManifests(
  ...manifests: StaticHttpResourceManifest[]
): StaticHttpResourceManifest {
  return {
    routes: mergeStaticHttpManifestEntries(
      manifests.map((manifest) => manifest.routes ?? []),
      (route) => route.relativePath
    ),
    middlewares: mergeStaticHttpManifestEntries(
      manifests.map((manifest) => manifest.middlewares ?? []),
      (middleware) => middleware.source
    ),
  }
}

export function buildStaticHttpResources(
  { routes = [], middlewares = [] }: StaticHttpResourceManifest,
  { logger }: StaticHttpResourceBuildOptions = {}
): HttpResourceSet {
  const middlewareResources = middlewares.map((middleware) =>
    buildStaticMiddlewareResources({
      ...middleware,
      logger,
    })
  )
  const errorHandler = middlewareResources.reduce<HttpResourceSet["errorHandler"]>(
    (handler, resources) => resources.errorHandler ?? handler,
    undefined
  )

  return {
    routes: routes.flatMap((route) =>
      buildStaticRouteDescriptors({
        ...route,
        route: resolveStaticRoutePath(route, logger),
        logger,
      })
    ),
    middlewares: middlewareResources.flatMap(
      (resources) => resources.middlewares
    ),
    errorHandler,
    bodyParserConfigRoutes: middlewareResources.flatMap(
      (resources) => resources.bodyParserConfigRoutes
    ),
    additionalDataValidatorRoutes: middlewareResources.flatMap(
      (resources) => resources.additionalDataValidatorRoutes
    ),
  }
}

export function composeStaticHttpResourceSets(
  ...resourceSets: StaticHttpResourceSetInput[]
): HttpResourceSet {
  const routes: HttpResourceSet["routes"] = []
  const middlewares: HttpResourceSet["middlewares"] = []
  const bodyParserConfigRoutes: HttpResourceSet["bodyParserConfigRoutes"] = []
  const additionalDataValidatorRoutes: HttpResourceSet["additionalDataValidatorRoutes"] =
    []
  let errorHandler: HttpResourceSet["errorHandler"]

  for (const resourceSet of resourceSets) {
    routes.push(...(resourceSet.routes ?? []))
    middlewares.push(...(resourceSet.middlewares ?? []))
    bodyParserConfigRoutes.push(...(resourceSet.bodyParserConfigRoutes ?? []))
    additionalDataValidatorRoutes.push(
      ...(resourceSet.additionalDataValidatorRoutes ?? [])
    )

    if (resourceSet.errorHandler) {
      errorHandler = resourceSet.errorHandler
    }
  }

  return {
    routes,
    middlewares,
    errorHandler,
    bodyParserConfigRoutes,
    additionalDataValidatorRoutes,
  }
}

function mergeStaticHttpManifestEntries<TEntry>(
  entryGroups: TEntry[][],
  getKey: StaticHttpManifestEntryKeyResolver<TEntry>
): TEntry[] {
  const merged: TEntry[] = []
  const keyedEntries = new Map<string, number>()

  for (const entries of entryGroups) {
    for (const entry of entries) {
      const key = getKey(entry)

      if (!key) {
        merged.push(entry)
        continue
      }

      const existingIndex = keyedEntries.get(key)
      if (existingIndex !== undefined) {
        merged[existingIndex] = entry
        continue
      }

      keyedEntries.set(key, merged.length)
      merged.push(entry)
    }
  }

  return merged
}

function resolveStaticRoutePath(
  route: StaticRouteModuleResource,
  logger?: StaticHttpBuilderLogger
): string {
  if (route.route) {
    return route.route
  }

  if (route.relativePath) {
    return createRoutePathFromRelativePath(route.relativePath, { logger })
  }

  throw new Error(
    "Static route module resources require either a route or relativePath."
  )
}
