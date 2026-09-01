import { build } from "esbuild"
import { builtinModules } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(appDirectory, "../../..")
const strict = process.argv.includes("--strict")

const externalSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
  "better-sqlite3",
  "libsql",
  "mariadb/callback",
])

const aliases = {
  "@models": path.join(
    rootDirectory,
    "packages/modules/currency/src/models/index.ts"
  ),
  "@medusajs/framework/utils": path.join(
    rootDirectory,
    "packages/core/framework/src/utils/index.ts"
  ),
  "@medusajs/framework/types": path.join(
    rootDirectory,
    "packages/core/framework/src/types/index.ts"
  ),
  "@medusajs/types": path.join(
    rootDirectory,
    "packages/core/types/src/index.ts"
  ),
  "@medusajs/utils": path.join(
    rootDirectory,
    "packages/core/utils/src/index.ts"
  ),
  "@medusajs/utils/dml/model": path.join(
    rootDirectory,
    "packages/core/utils/src/dml/entity-builder.ts"
  ),
  "@medusajs/utils/modules-sdk/medusa-service": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/medusa-service.ts"
  ),
}

const result = await build({
  entryPoints: [
    path.join(
      rootDirectory,
      "packages/modules/currency/src/services/currency-module-service.ts"
    ),
  ],
  bundle: true,
  format: "esm",
  metafile: true,
  platform: "browser",
  write: false,
  plugins: [
    {
      name: "real-medusa-currency-audit",
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, (args) => {
          if (externalSpecifiers.has(args.path)) {
            return {
              path: args.path,
              external: true,
            }
          }
        })

        for (const [specifier, target] of Object.entries(aliases)) {
          buildApi.onResolve(
            { filter: new RegExp(`^${escapeRegExp(specifier)}$`) },
            () => ({
              path: target,
            })
          )
        }
      },
    },
  ],
})

const bundledInputs = Object.keys(result.metafile.inputs)
const entryPoint = Object.values(result.metafile.outputs).find(
  (output) => output.entryPoint
)?.entryPoint
const externalImports = Object.values(result.metafile.outputs).flatMap(
  (output) => output.imports.filter((entry) => entry.external)
)
const violations = [
  ...bundledInputs.filter((input) =>
    [
      /(^|[/\\])node_modules[/\\]@mikro-orm[/\\]/i,
      /packages[/\\]core[/\\]utils[/\\]src[/\\]dal[/\\]mikro-orm[/\\]/i,
      /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\]medusa-internal-service\.ts$/i,
      /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\](create-medusa-mikro-orm-event-subscriber|create-pg-connection|load-module-database-config|mikro-orm-cli-config-builder)/i,
      /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\](loaders|migration-scripts)[/\\]/i,
    ].some((pattern) => pattern.test(input))
  ),
  ...externalImports
    .filter((entry) => externalSpecifiers.has(entry.path))
    .map((entry) => `external:${entry.path}`),
]
const firstPartyBlockerEdges = Object.entries(result.metafile.inputs).flatMap(
  ([input, metadata]) => {
    if (!input.includes("packages/")) {
      return []
    }

    return metadata.imports
      .filter(
        (entry) =>
          /mikro-orm/i.test(entry.path) ||
          externalSpecifiers.has(entry.path)
      )
      .map((entry) => `${input} -> ${entry.path}`)
  }
)
const broadFirstPartyEdges = Object.entries(result.metafile.inputs).flatMap(
  ([input, metadata]) =>
    metadata.imports
      .filter((entry) =>
        [
          /packages[/\\]core[/\\]utils[/\\]src[/\\]common[/\\]index\.ts/i,
          /packages[/\\]core[/\\]utils[/\\]src[/\\]dal[/\\]index\.ts/i,
          /packages[/\\]core[/\\]utils[/\\]src[/\\]dml[/\\]index\.ts/i,
          /create-medusa-mikro-orm-event-subscriber/i,
        ].some((pattern) => pattern.test(entry.path))
      )
      .map((entry) => `${input} -> ${entry.path}`)
)
const persistenceHelperInboundEdges = Object.entries(
  result.metafile.inputs
).flatMap(([input, metadata]) =>
  metadata.imports
    .filter((entry) =>
      [
        /dml[/\\]helpers[/\\]create-mikro-orm-entity/i,
        /dml[/\\]helpers[/\\]entity-builder[/\\](apply-searchable|define-property|define-relationship)/i,
        /dml[/\\]helpers[/\\]mikro-orm/i,
      ].some((pattern) => pattern.test(entry.path))
    )
    .map((entry) => `${input} -> ${entry.path}`)
)
const boundaryInboundEdges = Object.entries(result.metafile.inputs).flatMap(
  ([input, metadata]) =>
    metadata.imports
      .filter((entry) =>
        [
          /modules-sdk[/\\]joiner-config-builder/i,
          /modules-sdk[/\\]index\.ts/i,
          /modules-sdk[/\\]medusa-internal-service\.ts/i,
          /modules-sdk[/\\]module\.ts/i,
          /core[/\\]utils[/\\]src[/\\]index\.ts/i,
          /dml[/\\]index\.ts/i,
          /dal[/\\]index\.ts/i,
        ].some((pattern) => pattern.test(entry.path))
      )
      .map((entry) => `${input} -> ${entry.path}`)
)
const boundaryPaths = [
  /modules-sdk[/\\]index\.ts/i,
  /dml[/\\]index\.ts/i,
  /dal[/\\]index\.ts/i,
  /node_modules[/\\]@mikro-orm[/\\]/i,
].flatMap((pattern) => {
  const path = findShortestImportPath(entryPoint, pattern)
  return path ? [path] : []
})

console.log(
  `Real Currency module audit: ${bundledInputs.length} bundled inputs, ${violations.length} Worker blockers`
)

if (violations.length) {
  console.log(violations.slice(0, 25).map((input) => `- ${input}`).join("\n"))
}

if (firstPartyBlockerEdges.length) {
  console.log("First-party blocker edges:")
  console.log(
    firstPartyBlockerEdges.slice(0, 25).map((edge) => `- ${edge}`).join("\n")
  )
}

if (broadFirstPartyEdges.length) {
  console.log("Broad first-party edges:")
  console.log(
    broadFirstPartyEdges.slice(0, 25).map((edge) => `- ${edge}`).join("\n")
  )
}

if (persistenceHelperInboundEdges.length) {
  console.log("Persistence-helper inbound edges:")
  console.log(
    persistenceHelperInboundEdges
      .slice(0, 25)
      .map((edge) => `- ${edge}`)
      .join("\n")
  )
}

if (boundaryInboundEdges.length) {
  console.log("Boundary inbound edges:")
  console.log(
    boundaryInboundEdges
      .slice(0, 100)
      .map((edge) => `- ${edge}`)
      .join("\n")
  )
}

if (boundaryPaths.length) {
  console.log("Shortest boundary paths:")
  console.log(boundaryPaths.map((path) => `- ${path.join(" -> ")}`).join("\n"))
}

if (strict && violations.length) {
  throw new Error(
    "Real Currency module is not Worker-portable. Remove all reported blockers."
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findShortestImportPath(start, targetPattern) {
  if (!start) {
    return undefined
  }

  const queue = [[start]]
  const visited = new Set([start])

  while (queue.length) {
    const currentPath = queue.shift()
    const current = currentPath.at(-1)

    if (targetPattern.test(current)) {
      return currentPath
    }

    for (const imported of result.metafile.inputs[current]?.imports ?? []) {
      if (
        !(imported.path in result.metafile.inputs) ||
        visited.has(imported.path)
      ) {
        continue
      }

      visited.add(imported.path)
      queue.push([...currentPath, imported.path])
    }
  }

  return undefined
}
