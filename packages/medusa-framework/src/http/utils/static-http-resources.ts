import type { MiddlewaresConfig, MiddlewareDescriptor, RouteDescriptor } from "../types"
import { RoutesSorter } from "../routes-sorter"
import { buildStaticRouteDescriptors } from "./static-route-descriptors"
import { createRoutePathFromRelativePath } from "./route-path"

export type StaticHttpResourceManifest = {
  routes?: { route?: string; relativePath?: string; module: object }[]
  middlewares?: { module: { default: MiddlewaresConfig }; source?: string }[]
}
export type HttpResourceSet = {
  routes: RouteDescriptor[]
  middlewares: MiddlewareDescriptor[]
  errorHandler?: MiddlewaresConfig["errorHandler"]
}
export function buildStaticHttpResources(manifest: StaticHttpResourceManifest): HttpResourceSet {
  const middlewares: MiddlewareDescriptor[] = []
  let errorHandler: MiddlewaresConfig["errorHandler"]
  for (const entry of manifest.middlewares ?? []) {
    const config = entry.module.default
    if (config.errorHandler) errorHandler = config.errorHandler
    for (const route of config.routes ?? []) {
      const methods = route.methods ?? route.method
      const pathMatching = route.matcher.includes("*") || !methods ? "prefix" : "exact"
      for (const handler of route.middlewares ?? []) {
        middlewares.push({ matcher: route.matcher, methods, pathMatching, handler })
      }
    }
  }
  return {
    routes: (manifest.routes ?? []).flatMap((entry) => buildStaticRouteDescriptors({ ...entry, route: entry.route ?? createRoutePathFromRelativePath(entry.relativePath ?? "") })),
    middlewares,
    errorHandler,
  }
}
export function sortHttpResources(resources: HttpResourceSet): (RouteDescriptor | MiddlewareDescriptor)[] {
  return new RoutesSorter<RouteDescriptor | MiddlewareDescriptor>([...resources.middlewares, ...resources.routes]).sort()
}
