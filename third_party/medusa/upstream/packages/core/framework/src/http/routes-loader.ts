import { dynamicImport, readDirRecursive } from "@medusajs/utils"
import { join, parse } from "path"
import { logger } from "../logger"
import { buildStaticRouteDescriptors } from "./utils/static-route-descriptors"
import { createRoutePathFromRelativePath } from "./utils/route-path"
import { type RouteDescriptor } from "./types"

/**
 * File name that is used to indicate that the file is a route file
 */
const ROUTE_NAME = "route"

function toPortableRelativePath(relativePath: string): string {
  const portablePath = relativePath.replace(/\\/g, "/")
  return portablePath.startsWith("/") ? portablePath : `/${portablePath}`
}

/**
 * Exposes to API to register routes manually or by scanning the filesystem from a
 * source directory.
 *
 * In case of duplicates routes, the route registered afterwards will override the
 * one registered first.
 */
export class RoutesLoader {
  /**
   * Routes collected manually or by scanning directories
   */
  #routes: Record<string, Record<string, RouteDescriptor>> = {}

  /**
   * Creates the route path from its relative file path.
   */
  createRoutePath(relativePath: string): string {
    return createRoutePathFromRelativePath(relativePath, { logger })
  }

  /**
   * Returns the route config by exporting the route file and parsing
   * its exports
   */
  async #getRoutesForFile(
    routePath: string,
    absolutePath: string
  ): Promise<RouteDescriptor[]> {
    const routeExports = await dynamicImport(absolutePath)

    return buildStaticRouteDescriptors({
      route: routePath,
      module: routeExports,
      logger,
    })
  }

  /**
   * Scans a given directory and loads all routes from it. You can access the loaded
   * routes via "getRoutes" method
   */
  async scanDir(sourceDir: string) {
    const entries = await readDirRecursive(sourceDir, {
      ignoreMissing: true,
    })

    const routeEntries = entries
      .filter((entry) => {
        if (entry.isDirectory()) {
          return false
        }

        const { name, ext } = parse(entry.name)
        if (name === ROUTE_NAME && [".js", ".ts"].includes(ext)) {
          const routeFilePathSegment = toPortableRelativePath(
            join(entry.path, entry.name).replace(sourceDir, "")
          ).split("/")

          return !routeFilePathSegment.some((segment) =>
            segment.startsWith("_")
          )
        }

        return false
      })
      .map((entry) => {
        const absolutePath = join(entry.path, entry.name)
        const relativePath = toPortableRelativePath(
          absolutePath.replace(sourceDir, "")
        )
        return {
          absolutePath,
          relativePath,
        }
      })
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

    for (const { absolutePath, relativePath } of routeEntries) {
      const route = this.createRoutePath(relativePath)
      const routes = await this.#getRoutesForFile(route, absolutePath)

      routes.forEach((routeConfig) => {
        this.registerRoute({
          ...routeConfig,
          absolutePath,
          relativePath,
        })
      })
    }
  }

  /**
   * Register a route
   */
  registerRoute(route: RouteDescriptor) {
    this.#routes[route.matcher] = this.#routes[route.matcher] ?? {}
    const trackedRoute = this.#routes[route.matcher]
    trackedRoute[route.method] = route
  }

  /**
   * Register one or more routes
   */
  registerRoutes(routes: RouteDescriptor[]) {
    routes.forEach((route) => this.registerRoute(route))
  }

  /**
   * Returns an array of routes scanned by the routes loader or registered
   * manually.
   */
  getRoutes() {
    return Object.keys(this.#routes).reduce<RouteDescriptor[]>(
      (result, routePattern) => {
        const methodsRoutes = this.#routes[routePattern]
        Object.keys(methodsRoutes).forEach((method) => {
          const route = methodsRoutes[method]
          result.push(route)
        })
        return result
      },
      []
    )
  }

  /**
   * Reload a single route file
   * This is used by HMR to reload routes when files change
   */
  async reloadRouteFile(
    absolutePath: string,
    sourceDir: string
  ): Promise<RouteDescriptor[]> {
    const relativePath = toPortableRelativePath(absolutePath.replace(sourceDir, ""))
    const route = this.createRoutePath(relativePath)
    const routes = await this.#getRoutesForFile(route, absolutePath)

    // Register the new routes (will overwrite existing)
    routes.forEach((routeConfig) => {
      this.registerRoute({
        ...routeConfig,
        absolutePath,
        relativePath,
      })
    })

    return routes.map((routeConfig) => ({
      ...routeConfig,
      absolutePath,
      relativePath,
    }))
  }
}
