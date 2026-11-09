import fs from "fs/promises"
import path from "path"

import { createRoutePathFromRelativePath } from "../http/utils/route-path"

export type StaticHttpManifestRouteInput = {
  binding: string
  importPath: string
  route?: string
  relativePath: string
}

export type StaticHttpManifestMiddlewareInput = {
  binding: string
  importPath: string
  source?: string
}

export type StaticHttpManifestModuleRenderOptions = {
  exportName: string
  routes: StaticHttpManifestRouteInput[]
  middlewares: StaticHttpManifestMiddlewareInput[]
  generatedBy?: string
  typeImportPath?: string
}

export type StaticHttpManifestRouteFileInput = {
  relativePath: string
  binding?: string
  importPath?: string
  route?: string
  routeRoot?: string
}

export type StaticHttpManifestRouteFolderInput = {
  relativePath: string
  routeRoot?: string
}

export type ScanStaticHttpRouteFilesOptions = {
  projectRoot: string
  folders: StaticHttpManifestRouteFolderInput[]
  routeFileName?: string
}

export type StaticHttpManifestMiddlewareFileInput = {
  relativePath: string
  binding?: string
  importPath?: string
  exportName?: string
}

export type StaticHttpManifestMiddlewareFolderInput = {
  relativePath: string
}

export type ScanStaticHttpMiddlewareFilesOptions = {
  projectRoot: string
  folders: StaticHttpManifestMiddlewareFolderInput[]
  middlewareFileName?: string
}

export type CreateStaticHttpManifestInputFromFileListOptions = {
  manifestDirectory: string
  routeRoot?: string
  routes: StaticHttpManifestRouteFileInput[]
  middlewares?: StaticHttpManifestMiddlewareFileInput[]
}

export type StaticHttpManifestInputFromFileList = {
  routes: StaticHttpManifestRouteInput[]
  middlewares: StaticHttpManifestMiddlewareInput[]
}

export async function scanStaticHttpRouteFiles({
  projectRoot,
  folders,
  routeFileName = "route.ts",
}: ScanStaticHttpRouteFilesOptions): Promise<StaticHttpManifestRouteFileInput[]> {
  const routeFiles = await Promise.all(
    folders.map(async (folder) => {
      const files = await scanRouteFiles(
        path.resolve(projectRoot, folder.relativePath),
        routeFileName
      )

      return files.map((file) => ({
        relativePath: normalizePath(path.relative(projectRoot, file)),
        routeRoot: folder.routeRoot,
      }))
    })
  )

  return routeFiles.flat()
}

export async function scanStaticHttpMiddlewareFiles({
  projectRoot,
  folders,
  middlewareFileName = "middlewares.ts",
}: ScanStaticHttpMiddlewareFilesOptions): Promise<
  StaticHttpManifestMiddlewareFileInput[]
> {
  const middlewareFiles = await Promise.all(
    folders.map(async (folder) => {
      const files = await scanNamedFiles(
        path.resolve(projectRoot, folder.relativePath),
        middlewareFileName
      )

      return Promise.all(
        files.map(async (file) => {
          const source = await fs.readFile(file, "utf8")

          return {
            relativePath: normalizePath(path.relative(projectRoot, file)),
            exportName: findSingleMiddlewareExportName(file, source),
          }
        })
      )
    })
  )

  return middlewareFiles.flat()
}

export function createStaticHttpManifestInputFromFileList({
  manifestDirectory,
  routeRoot,
  routes,
  middlewares = [],
}: CreateStaticHttpManifestInputFromFileListOptions): StaticHttpManifestInputFromFileList {
  return {
    routes: routes.map((route) =>
      createRouteManifestInput(route, manifestDirectory, routeRoot)
    ),
    middlewares: middlewares.map((middleware) =>
      createMiddlewareManifestInput(middleware, manifestDirectory)
    ),
  }
}

export function renderStaticHttpManifestModule({
  exportName,
  routes,
  middlewares,
  generatedBy,
  typeImportPath = "@medusajs/framework/http/static",
}: StaticHttpManifestModuleRenderOptions): string {
  return [
    renderGeneratedHeader(generatedBy),
    `import type { StaticHttpResourceManifest } from "${typeImportPath}"`,
    ...routes.map(
      (route) => `import * as ${route.binding} from "${route.importPath}"`
    ),
    ...middlewares.map(
      (middleware) =>
        `import { ${middleware.binding} } from "${middleware.importPath}"`
    ),
    "",
    `export const ${exportName} = {`,
    "  routes: [",
    ...routes.flatMap(renderRoute),
    "  ],",
    "  middlewares: [",
    ...middlewares.flatMap(renderMiddleware),
    "  ],",
    "} satisfies StaticHttpResourceManifest",
    "",
  ].join("\n")
}

function renderGeneratedHeader(generatedBy: string | undefined): string {
  const source = generatedBy ? ` by ${generatedBy}` : ""

  return `// Generated${source}. Do not edit by hand.`
}

function renderRoute(route: StaticHttpManifestRouteInput): string[] {
  return [
    "    {",
    ...renderOptionalStringProperty("route", route.route),
    `      module: ${route.binding},`,
    `      relativePath: "${route.relativePath}",`,
    "    },",
  ]
}

function renderMiddleware(
  middleware: StaticHttpManifestMiddlewareInput
): string[] {
  return [
    "    {",
    "      module: {",
    "        default: {",
    `          routes: ${middleware.binding},`,
    "        },",
    "      },",
    ...renderOptionalStringProperty("source", middleware.source),
    "    },",
  ]
}

function renderOptionalStringProperty(
  name: string,
  value: string | undefined
): string[] {
  if (value === undefined) {
    return []
  }

  return [`      ${name}: "${value}",`]
}

function createRouteManifestInput(
  route: StaticHttpManifestRouteFileInput,
  manifestDirectory: string,
  defaultRouteRoot: string | undefined
): StaticHttpManifestRouteInput {
  const routeRelativePath = stripRouteRoot(
    route.relativePath,
    route.routeRoot ?? defaultRouteRoot
  )

  return {
    binding: route.binding ?? deriveBindingName(routeRelativePath, "route"),
    importPath:
      route.importPath ??
      createImportPathFromRelativeFile(manifestDirectory, route.relativePath),
    route: route.route ?? createRoutePathFromRelativePath(routeRelativePath),
    relativePath: route.relativePath,
  }
}

function createMiddlewareManifestInput(
  middleware: StaticHttpManifestMiddlewareFileInput,
  manifestDirectory: string
): StaticHttpManifestMiddlewareInput {
  return {
    binding:
      middleware.binding ??
      middleware.exportName ??
      deriveBindingName(middleware.relativePath, "middlewares"),
    importPath:
      middleware.importPath ??
      createImportPathFromRelativeFile(
        manifestDirectory,
        middleware.relativePath
      ),
    source: middleware.relativePath,
  }
}

function createImportPathFromRelativeFile(
  manifestDirectory: string,
  relativePath: string
): string {
  const extensionlessPath = stripScriptExtension(normalizePath(relativePath))
  const importPath = path.posix.relative(
    normalizePath(manifestDirectory),
    extensionlessPath
  )

  return importPath.startsWith(".") ? importPath : `./${importPath}`
}

function stripRouteRoot(
  relativePath: string,
  routeRoot: string | undefined
): string {
  const normalizedPath = normalizePath(relativePath)

  if (!routeRoot) {
    return normalizedPath
  }

  const normalizedRoot = normalizePath(routeRoot)
  const rootPrefix = `${normalizedRoot}/`

  return normalizedPath.startsWith(rootPrefix)
    ? normalizedPath.slice(rootPrefix.length)
    : normalizedPath
}

function deriveBindingName(relativePath: string, suffix: string): string {
  const extensionlessPath = stripScriptExtension(normalizePath(relativePath))
  const words = extensionlessPath
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== suffix)
    .flatMap(createIdentifierWords)
    .concat(suffix)

  return toCamelCase(words)
}

function createIdentifierWords(segment: string): string[] {
  const parameterMatch = segment.match(/^\[(.+)\]$/)

  if (parameterMatch) {
    return ["by", parameterMatch[1]]
  }

  return segment.split(/[^a-zA-Z0-9]+/).filter(Boolean)
}

function toCamelCase(words: string[]): string {
  const [first = "", ...rest] = words.map(toPascalCase)

  return [first.charAt(0).toLowerCase(), first.slice(1), ...rest].join("")
}

function toPascalCase(word: string): string {
  const lower = word.toLowerCase()

  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
}

function stripScriptExtension(filePath: string): string {
  return filePath.replace(/\.[cm]?[jt]sx?$/, "")
}

function normalizePath(filePath: string): string {
  return filePath.split(/[\\/]+/).filter(Boolean).join("/")
}

async function scanRouteFiles(
  directory: string,
  routeFileName: string
): Promise<string[]> {
  return scanNamedFiles(directory, routeFileName)
}

async function scanNamedFiles(
  directory: string,
  fileName: string
): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const sortedEntries = entries.sort(compareDirectoryEntries)
  const files = await Promise.all(
    sortedEntries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        return scanNamedFiles(entryPath, fileName)
      }

      return entry.isFile() && entry.name === fileName ? [entryPath] : []
    })
  )

  return files.flat()
}

function findSingleMiddlewareExportName(filePath: string, source: string): string {
  const matches = Array.from(
    source.matchAll(
      /export\s+const\s+([A-Za-z_$][\w$]*)\s*:\s*MiddlewareRoute\[\]\s*=/g
    )
  ).map((match) => match[1])

  if (matches.length !== 1 || !matches[0]) {
    throw new Error(
      `Expected exactly one exported MiddlewareRoute[] in ${normalizePath(
        filePath
      )}. Found ${matches.length}.`
    )
  }

  return matches[0]
}

function compareDirectoryEntries(
  first: { isFile(): boolean; name: string },
  second: { isFile(): boolean; name: string }
): number {
  if (first.isFile() && !second.isFile()) {
    return -1
  }

  if (!first.isFile() && second.isFile()) {
    return 1
  }

  return first.name.localeCompare(second.name)
}
