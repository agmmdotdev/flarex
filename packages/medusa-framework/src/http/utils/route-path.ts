import {
  silentStaticHttpBuilderLogger,
  type StaticHttpBuilderLogger,
} from "./static-builder-logger"

const ROUTE_FILE_MATCHER = /route(\.js|\.ts)$/
const PARAM_SEGMENT_MATCHER = /\[(\w+)\]/
const PATH_SEPARATOR_MATCHER = /[\\/]+/

export type CreateRoutePathFromRelativePathOptions = {
  logger?: StaticHttpBuilderLogger
}

export function createRoutePathFromRelativePath(
  relativePath: string,
  { logger = silentStaticHttpBuilderLogger }: CreateRoutePathFromRelativePathOptions = {}
): string {
  const segments = relativePath
    .replace(ROUTE_FILE_MATCHER, "")
    .split(PATH_SEPARATOR_MATCHER)
  const params: Record<string, boolean> = {}
  const displayPath = relativePath.split(PATH_SEPARATOR_MATCHER).join("/")

  return `/${segments
    .filter((segment) => !!segment)
    .map((segment) => {
      if (segment.startsWith("[")) {
        segment = segment.replace(PARAM_SEGMENT_MATCHER, (_, group) => {
          if (params[group]) {
            logger.debug(
              `Duplicate parameters found in route ${displayPath} (${group})`
            )

            throw new Error(
              `Duplicate parameters found in route ${displayPath} (${group}). Make sure that all parameters are unique.`
            )
          }

          params[group] = true
          return `:${group}`
        })
      }

      return segment
    })
    .join("/")}`
}
