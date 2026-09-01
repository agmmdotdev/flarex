import { build } from "esbuild"
import { builtinModules } from "module"
import frameworkPackageJson from "../../../package.json"
import { resolve } from "path"

const nodeSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
])

const forbiddenFetchAdapterInputs = [
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]adapters[/\\]express\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]express-loader\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]middleware-file-loader\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]middlewares[/\\]bodyparser\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]resolvers[/\\]filesystem\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]router\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]routes-loader\.ts$/i,
  /(^|[/\\])node_modules[/\\]express[/\\]/i,
]

describe("Fetch HTTP adapter import graph", () => {
  it("does not pull Express, filesystem discovery, or Node built-ins into the browser bundle", async () => {
    const result = await build({
      entryPoints: [resolve(__dirname, "../fetch.ts")],
      bundle: true,
      format: "esm",
      metafile: true,
      platform: "browser",
      write: false,
    })
    const bundledInputs = Object.keys(result.metafile.inputs)
    const forbiddenInputs = bundledInputs.filter((input) =>
      forbiddenFetchAdapterInputs.some((pattern) => pattern.test(input))
    )
    const externalNodeImports = Object.values(result.metafile.outputs).flatMap(
      (output) =>
        output.imports
          .filter((entry) => entry.external && nodeSpecifiers.has(entry.path))
          .map((entry) => `external:${entry.path}`)
    )

    expect([...forbiddenInputs, ...externalNodeImports]).toEqual([])
  })

  it("exposes the Worker-safe Fetch HTTP package subpath", () => {
    expect(frameworkPackageJson.exports["./http/fetch"]).toEqual({
      types: "./dist/http/fetch.d.ts",
      default: "./dist/http/fetch.js",
    })
  })
})
