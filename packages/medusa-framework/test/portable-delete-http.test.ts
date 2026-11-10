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
      method: "DELETE", headers: { "content-type": "application/json" }, body: "invalid JSON is not a POST body",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "prod_delete" })
    expect(DELETE).toHaveBeenCalledOnce()
    expect((await handler.handle(new Request("https://private.test/admin/products/prod_delete", { method: "PATCH" }))).status).toBe(404)
    expect(DELETE).toHaveBeenCalledOnce()
  })
})
