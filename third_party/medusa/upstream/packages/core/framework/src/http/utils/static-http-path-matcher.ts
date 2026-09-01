import type { StaticHttpResourceManifest } from "./static-http-resources"
import { createRoutePathFromRelativePath } from "./route-path"

export type StaticHttpPathMatcher = (pathname: string) => boolean
export type StaticHttpPathPattern = string | RegExp
export type StaticHttpPathMatch = Record<string, string>
export type StaticHttpPathMatchOptions = {
  partial?: boolean
}

export function createStaticHttpManifestPathMatcher(
  manifest: StaticHttpResourceManifest
): StaticHttpPathMatcher {
  const routeMatchers = (manifest.routes ?? []).map((route) =>
    createStaticHttpRoutePathMatcher(resolveStaticRouteMatcher(route))
  )

  return (pathname) => routeMatchers.some((matches) => matches(pathname))
}

export function createStaticHttpRoutePathMatcher(
  route: string
): StaticHttpPathMatcher {
  return (pathname) => matchStaticHttpPath(route, pathname) !== undefined
}

export function createStaticHttpPathPatternMatcher(
  patterns: readonly StaticHttpPathPattern[]
): StaticHttpPathMatcher {
  return (pathname) =>
    patterns.some((pattern) => matchStaticHttpPathPattern(pattern, pathname))
}

export function matchStaticHttpPathPattern(
  pattern: StaticHttpPathPattern,
  pathname: string
): boolean {
  if (typeof pattern === "string") {
    return pattern === pathname
  }

  pattern.lastIndex = 0
  return pattern.test(pathname)
}

export function matchStaticHttpPath(
  matcher: string,
  pathname: string,
  options: StaticHttpPathMatchOptions = {}
): StaticHttpPathMatch | undefined {
  const matcherSegments = splitPath(matcher)
  const pathSegments = splitPath(pathname)

  if (!options.partial && matcherSegments.length !== pathSegments.length) {
    return undefined
  }

  if (options.partial && matcherSegments.length > pathSegments.length) {
    return undefined
  }

  return matcherSegments.reduce<StaticHttpPathMatch | undefined>(
    (params, segment, index) => {
      if (!params) {
        return undefined
      }

      const pathSegment = pathSegments[index]
      if (segment === "*" || segment.startsWith("*")) {
        return params
      }

      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(pathSegment)
        return params
      }

      return segment === pathSegment ? params : undefined
    },
    {}
  )
}

function resolveStaticRouteMatcher(
  route: NonNullable<StaticHttpResourceManifest["routes"]>[number]
): string {
  if (route.route) {
    return route.route
  }

  if (route.relativePath) {
    return createRoutePathFromRelativePath(route.relativePath)
  }

  throw new Error(
    "Static route module resources require either a route or relativePath."
  )
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean)
}
