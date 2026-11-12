import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { describe, expect, it, vi } from "vitest"
import { createFetchHttpStaticHandler } from "../src/http/fetch"
import type { MedusaRequest, MedusaResponse } from "../src/http/types"

const scope: MedusaRequest["scope"] = createContainer().register({ logger: asValue({ error() {}, info() {} }) })

describe("private Fetch DELETE method admission", () => {
  it("requires explicit DELETE admission and preserves unsupported-method refusal", async () => {
    const DELETE = vi.fn((req: MedusaRequest, res: MedusaResponse) => { res.json({ id: req.params.id, body: req.body }) })
    const manifest = { routes: [{ route: "/admin/products/:id", module: { DELETE } }] }
    for (const allowedMethods of [undefined, ["GET", "POST"]] as const) {
      expect(() => createFetchHttpStaticHandler({ manifest, createRequestScope: () => scope, allowedMethods })).toThrow("unadmitted HTTP method")
    }
    for (const method of ["PUT", "PATCH", "HEAD"]) {
      expect(() => createFetchHttpStaticHandler({
        createRequestScope: () => scope,
        allowedMethods: ["GET", "POST", "DELETE"],
        manifest: { routes: [{ route: "/admin/products/:id", module: { [method]: () => undefined } }] },
      })).toThrow("unadmitted HTTP method")
    }
    const handler = createFetchHttpStaticHandler({ manifest, createRequestScope: () => scope, allowedMethods: ["DELETE"] })
    const response = await handler.handle(new Request("https://private.test/admin/products/prod_delete", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: '{"ids":["child_native"]}',
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "prod_delete", body: { ids: ["child_native"] } })
    expect(DELETE).toHaveBeenCalledOnce()
    expect((await handler.handle(new Request("https://private.test/admin/products/prod_delete", { method: "PATCH" }))).status).toBe(404)
    expect(DELETE).toHaveBeenCalledOnce()
  })

  it("retains native body/content-type selection and parser disabling for DELETE", async () => {
    const DELETE = vi.fn((req: MedusaRequest, res: MedusaResponse) => { res.json({ body: req.body }) })
    const manifest = { routes: [{ route: "/admin/products/:id", module: { DELETE } }] }
    const handler = createFetchHttpStaticHandler({ manifest, createRequestScope: () => scope, allowedMethods: ["DELETE"] })
    for (const init of [{ method: "DELETE" }, { method: "DELETE", headers: { "content-type": "text/plain" }, body: "unparsed text" }]) {
      const response = await handler.handle(new Request("https://private.test/admin/products/prod_delete", init))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
    }
    const disabled = createFetchHttpStaticHandler({ createRequestScope: () => scope, allowedMethods: ["DELETE"],
      jsonBodyLimitBytes: 8, manifest: { ...manifest, middlewares: [{ module: { default: { routes: [
        { matcher: "/admin/products/:id", method: "DELETE", bodyParser: false },
      ] } } }] } })
    const response = await disabled.handle(new Request("https://private.test/admin/products/prod_delete", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: "unparsed malformed JSON beyond limit",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(DELETE).toHaveBeenCalledTimes(3)
  })

  it("enforces DELETE JSON errors and declared/streamed byte bounds before preparation or the handler", async () => {
    const prepareRequest = vi.fn()
    const DELETE = vi.fn((_req: MedusaRequest, res: MedusaResponse) => { res.json({ reached: true }) })
    const handler = createFetchHttpStaticHandler({ createRequestScope: () => scope, prepareRequest, allowedMethods: ["DELETE"],
      jsonBodyLimitBytes: 8, manifest: { routes: [{ route: "/admin/products/:id", module: { DELETE } }] } })
    const malformed = await handler.handle(new Request("https://private.test/admin/products/prod_delete", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: '{"a":',
    }))
    expect(malformed.status).toBe(500)
    expect(await malformed.json()).toEqual({ code: "unknown_error", type: "unknown_error", message: "An unknown error occurred." })
    const declared = await handler.handle(new Request("https://private.test/admin/products/prod_delete", {
      method: "DELETE", headers: { "content-type": "application/json", "content-length": "13" }, body: '{"long":true}',
    }))
    expect(declared.status).toBe(413)
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"a":"')); controller.enqueue(new TextEncoder().encode('native"}')) }, cancel,
    })
    const init: RequestInit & { duplex: "half" } = { method: "DELETE", headers: { "content-type": "application/json" }, body: stream, duplex: "half" }
    expect((await handler.handle(new Request("https://private.test/admin/products/prod_delete", init))).status).toBe(413)
    expect(cancel).toHaveBeenCalledOnce()
    expect(prepareRequest).not.toHaveBeenCalled()
    expect(DELETE).not.toHaveBeenCalled()
  })
})
