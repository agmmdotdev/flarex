import { build } from "esbuild"
import { builtinModules } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(appDirectory, "../../..")

const entrypoints = {
  "@medusajs/utils/modules-sdk/decorators/emit-events": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/decorators/emit-events.ts"
  ),
  "@medusajs/utils/modules-sdk/portable": path.join(
    rootDirectory,
    "packages/core/utils/src/modules-sdk/portable.ts"
  ),
  "@medusajs/modules-sdk/static-app": path.join(
    rootDirectory,
    "packages/core/modules-sdk/src/static-app.ts"
  ),
  "@medusajs/modules-sdk/remote-query/portable": path.join(
    rootDirectory,
    "packages/core/modules-sdk/src/remote-query/portable.ts"
  ),
}

const nodeSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
])

for (const [specifier, target] of Object.entries(entrypoints)) {
  const result = await build({
    stdin: {
      contents: `export * from "${specifier}"`,
      resolveDir: rootDirectory,
      sourcefile: `${specifier}.entry.ts`,
    },
    bundle: true,
    format: "esm",
    metafile: true,
    platform: "browser",
    write: false,
    plugins: [
      {
        name: "portable-entrypoint-aliases",
        setup(buildApi) {
          buildApi.onResolve({ filter: /.*/ }, (args) => {
            if (nodeSpecifiers.has(args.path)) {
              return {
                path: args.path,
                external: true,
              }
            }
          })

          buildApi.onResolve(
            { filter: new RegExp(`^${escapeRegExp(specifier)}$`) },
            () => ({ path: target })
          )
        },
      },
    ],
  })

  const bundledInputs = Object.keys(result.metafile.inputs)
  const externalNodeImports = Object.values(result.metafile.outputs).flatMap(
    (output) =>
      output.imports
        .filter((entry) => entry.external && nodeSpecifiers.has(entry.path))
        .map((entry) => `external:${entry.path}`)
  )
  const forbiddenInputs = bundledInputs.filter((input) =>
    [
      /(^|[/\\])express([/\\]|$)/i,
      /mikro-orm/i,
      /(^|[/\\])pg([/\\]|$)/i,
      /postgres/i,
      /packages[/\\]core[/\\]utils[/\\]src[/\\]common[/\\]index\.ts$/i,
      /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\]index\.ts$/i,
      /packages[/\\]core[/\\]utils[/\\]src[/\\]modules-sdk[/\\](loaders|migration-scripts)[/\\]/i,
    ].some((pattern) => pattern.test(input))
  )
  const violations = [...forbiddenInputs, ...externalNodeImports]

  if (violations.length) {
    throw new Error(
      `Portable entrypoint ${specifier} is not Worker-safe:\n${violations
        .map((input) => `- ${input}`)
        .join("\n")}`
    )
  }

  console.log(
    `Portable entrypoint ${specifier} passed (${bundledInputs.length} bundled inputs)`
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
