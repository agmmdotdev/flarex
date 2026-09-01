import { build } from "esbuild"
import { builtinModules } from "module"
import { resolve } from "path"

const nodeSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
])

const forbiddenStaticManifestInputs = [
  /packages[/\\]core[/\\]framework[/\\]src[/\\]logger[/\\]index\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]routes-loader\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]middleware-file-loader\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]resolvers[/\\]filesystem\.ts$/i,
  /(^|[/\\])node_modules[/\\]@medusajs[/\\]cli[/\\]/i,
  /(^|[/\\])node_modules[/\\]express[/\\]/i,
]

describe("static HTTP manifest import graph", () => {
  it("does not pull filesystem discovery, Express, or Node built-ins into the package-style manifest entrypoint", async () => {
    const result = await build({
      entryPoints: [
        resolve(
          __dirname,
          "../__fixtures__/static-http-package/static-http-manifest.ts"
        ),
      ],
      bundle: true,
      format: "esm",
      metafile: true,
      platform: "browser",
      write: false,
    })
    const bundledInputs = Object.keys(result.metafile.inputs)
    const forbiddenInputs = bundledInputs.filter((input) =>
      forbiddenStaticManifestInputs.some((pattern) => pattern.test(input))
    )
    const externalNodeImports = Object.values(result.metafile.outputs).flatMap(
      (output) =>
        output.imports
          .filter((entry) => entry.external && nodeSpecifiers.has(entry.path))
          .map((entry) => `external:${entry.path}`)
    )

    expect([...forbiddenInputs, ...externalNodeImports]).toEqual([])
  })
})
