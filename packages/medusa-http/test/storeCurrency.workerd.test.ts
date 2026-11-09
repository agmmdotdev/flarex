import { builtinModules } from "node:module"
import { fileURLToPath } from "node:url"
import { Miniflare } from "miniflare"
import { build } from "vite"
import { describe, expect, it } from "vitest"

describe("portable Store Currency native route closure in an actual fixture DO", () => {
  it("bundles without filesystem HTTP loaders and executes the static native middleware and routes", async () => {
    const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
    const filesystemImporters: string[] = []
    const bundle = await build({ configFile: false, logLevel: "silent", resolve: { conditions: ["source", "workerd"] },
      plugins: [{ name: "report-worker-filesystem-importers", generateBundle() {
        for (const id of this.getModuleIds()) {
          const info = this.getModuleInfo(id)
          if (info?.importedIds.some(imported => /^(?:node:)?(?:fs|path)(?:\/|$)/.test(imported))) filesystemImporters.push(id)
        }
      } }],
      build: { write: false, minify: false, target: "es2022", lib: {
        entry: fileURLToPath(new URL("./storeCurrency.workerd.worker.ts", import.meta.url)), formats: ["es"], fileName: "worker",
      }, rolldownOptions: { external: id => id.startsWith("cloudflare:") || builtins.has(id) } },
    })
    const chunks = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => "output" in result ? result.output : [])
    const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.mjs")
      ?? chunks.find(chunk => chunk.type === "chunk")
    if (worker === undefined || worker.type !== "chunk") throw new Error("Missing Workerd route fixture bundle")
    const modules = Object.keys(worker.modules).map(path => path.replaceAll("\\", "/"))
    expect(modules.filter(path => /\/(?:express|glob|fast-glob|@mikro-orm|mikro-orm|pg)(?:\/|@)/.test(path))).toEqual([])
    expect(worker.imports.filter(path => /^(?:node:)?(?:fs|path)(?:\/|$)/.test(path)), filesystemImporters.join("\n")).toEqual([])
    expect(modules.some(path => path.endsWith("medusa-http/src/api/store/currencies/route.ts"))).toBe(true)
    expect(modules.some(path => path.endsWith("medusa-http/src/api/store/currencies/[code]/route.ts"))).toBe(true)

    const runtime = new Miniflare({ modules: [{ type: "ESModule", path: "worker.mjs", contents: worker.code }],
      compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
      durableObjects: { ROUTE_FIXTURES: { className: "StoreCurrencyRouteFixture", useSQLite: true } },
    })
    try {
      const transport = { "x-flarex-executor-token": "private-route-fixture" }
      expect((await runtime.dispatchFetch("https://routes.test/store/currencies")).status).toBe(401)
      const resources = await runtime.dispatchFetch("https://routes.test/__proof/resources", { headers: transport })
      expect(await resources.json()).toEqual({ scopes: 0, initialized: false })
      const headers = { ...transport, "x-publishable-api-key": "pk_workerd", origin: "https://store.example",
        authorization: "Bearer customer-fixture" }
      const list = await runtime.dispatchFetch("https://routes.test/store/currencies?limit=1&offset=1&fields=code,name", { headers })
      expect(list.status, await list.clone().text()).toBe(200)
      expect(await list.json()).toEqual({ currencies: [{ code: "usd", name: "US Dollar" }], count: 2, offset: 1, limit: 1 })
      expect(list.headers.get("access-control-allow-origin")).toBe("https://store.example")
      expect(list.headers.get("x-proof-customer-authorization")).toBe("true")
      const retrieve = await runtime.dispatchFetch("https://routes.test/store/currencies/eur?fields=code,name", { headers })
      expect(retrieve.status, await retrieve.clone().text()).toBe(200)
      expect(await retrieve.json()).toEqual({ currency: { code: "eur", name: "Euro" } })
      expect(retrieve.headers.get("x-proof-request-scope")).not.toBe(list.headers.get("x-proof-request-scope"))
      expect((await runtime.dispatchFetch("https://routes.test/store/currencies/missing", { headers })).status).toBe(404)
      expect((await runtime.dispatchFetch("https://routes.test/store/currencies?limit=invalid", { headers })).status).toBe(400)
      expect((await runtime.dispatchFetch("https://routes.test/store/currencies", { headers: transport })).status).toBe(400)
      expect((await runtime.dispatchFetch("https://routes.test/store/currencies", {
        headers: { ...headers, "x-publishable-api-key": "pk_invalid" },
      })).status).toBe(400)
      const preflight = await runtime.dispatchFetch("https://routes.test/store/currencies", {
        method: "OPTIONS", headers: { ...transport, origin: "https://store.example", "access-control-request-method": "GET" },
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://store.example")
      expect((await runtime.dispatchFetch("https://routes.test/admin/currencies", { headers })).status).toBe(404)
    } finally {
      try { expect((await runtime.dispatchFetch("https://routes.test/__proof/close", {
        headers: { "x-flarex-executor-token": "private-route-fixture" },
      })).status).toBe(200) }
      finally { await runtime.dispose() }
    }
  }, 120_000)
})
