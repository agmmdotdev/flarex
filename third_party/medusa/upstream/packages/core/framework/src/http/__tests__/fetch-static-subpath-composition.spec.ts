import { build, type Plugin } from "esbuild"
import { builtinModules } from "module"
import { resolve } from "path"
import { FetchHttpAdapter } from "../fetch"
import { StaticHttpManifestResolver } from "../static"
import {
  customersCreateMiddlewareMock,
  customersCreateMiddlewareValidatorMock,
  customersGlobalMiddlewareMock,
  storeGlobalMiddlewareMock,
} from "../__fixtures__/mocks"
import { staticHttpManifest } from "../__fixtures__/static-http-package/static-http-manifest"

const nodeSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
])

const forbiddenComposedSubpathInputs = [
  /packages[/\\]core[/\\]framework[/\\]src[/\\]logger[/\\]index\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]adapters[/\\]express\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]express-loader\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]middleware-file-loader\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]middlewares[/\\]bodyparser\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]resolvers[/\\]filesystem\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]router\.ts$/i,
  /packages[/\\]core[/\\]framework[/\\]src[/\\]http[/\\]routes-loader\.ts$/i,
  /(^|[/\\])node_modules[/\\]@medusajs[/\\]cli[/\\]/i,
  /(^|[/\\])node_modules[/\\]express[/\\]/i,
]

const frameworkHttpSubpathPlugin = {
  name: "framework-http-subpath-source",
  setup(buildContext) {
    buildContext.onResolve(
      { filter: /^@medusajs\/framework\/http\/fetch$/ },
      () => ({
        path: resolve(__dirname, "../fetch.ts"),
      })
    )
    buildContext.onResolve(
      { filter: /^@medusajs\/framework\/http\/static$/ },
      () => ({
        path: resolve(__dirname, "../static.ts"),
      })
    )
  },
} satisfies Plugin

describe("Fetch and static HTTP subpath composition", () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it("builds static resources and executes them through Fetch", async () => {
    const resources = await new StaticHttpManifestResolver(
      staticHttpManifest
    ).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const createCustomerResponse = await adapter.handle(
      new Request("https://medusa.test/customers", { method: "POST" })
    )

    expect(createCustomerResponse.status).toBe(200)
    expect(await createCustomerResponse.text()).toBe("create customer")
    expect(customersGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareValidatorMock).toHaveBeenCalled()

    jest.clearAllMocks()

    const syncProductResponse = await adapter.handle(
      new Request("https://medusa.test/store/products/prod_123/sync", {
        method: "POST",
      })
    )

    expect(syncProductResponse.status).toBe(200)
    expect(await syncProductResponse.text()).toBe("sync product prod_123")
    expect(storeGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersGlobalMiddlewareMock).not.toHaveBeenCalled()
  })

  it("keeps the composed package subpath import graph Worker-clean", async () => {
    const result = await build({
      bundle: true,
      format: "esm",
      metafile: true,
      platform: "browser",
      plugins: [frameworkHttpSubpathPlugin],
      stdin: {
        contents: [
          `import { createFetchHttpStaticHandler, FetchHttpAdapter, getMedusaRequestAuthContext, setMedusaRequestAuthContext } from "@medusajs/framework/http/fetch"`,
          `import { StaticHttpManifestResolver } from "@medusajs/framework/http/static"`,
          `export { createFetchHttpStaticHandler, FetchHttpAdapter, getMedusaRequestAuthContext, setMedusaRequestAuthContext, StaticHttpManifestResolver }`,
        ].join("\n"),
        loader: "ts",
        resolveDir: __dirname,
      },
      write: false,
    })
    const bundledInputs = Object.keys(result.metafile.inputs)
    const forbiddenInputs = bundledInputs.filter((input) =>
      forbiddenComposedSubpathInputs.some((pattern) => pattern.test(input))
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
