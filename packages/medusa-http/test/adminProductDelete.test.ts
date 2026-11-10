import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext, PolicyAction } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_delete", actor_type: "user", auth_identity_id: "auth_delete", app_metadata: {}, user_metadata: {} }
const readPolicy = [{ resource: "product", operation: "read" }]
const deletePolicy = [{ resource: "product", operation: "delete" }]

function fixture(options: { principal?: AuthContext; deniedOperation?: string; fail?: Error } = {}) {
  const run = vi.fn(async () => {
    if (options.fail) throw options.fail
    return { result: undefined }
  })
  const graph = vi.fn()
  const evaluate = vi.fn((_principal: AuthContext, policies: readonly PolicyAction[]) =>
    !policies.some(policy => policy.operation === options.deniedOperation))
  const admission = vi.fn(() => { throw new Error("POST field admission must not run for DELETE") })
  const scopes: object[] = []
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: request => request.headers.has("x-verified-admin") ? options.principal ?? user : undefined,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    admitCatalogRefetchFields: () => undefined,
    createRequestScope: () => {
      const scope = createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) })
      scopes.push(scope)
      return scope
    },
  })
  return { handler, run, graph, evaluate, admission, scopes }
}

function request(id = "prod_delete", query = "", admin = true) {
  return new Request(`https://private.test/admin/products/${id}${query ? `?${query}` : ""}`, {
    method: "DELETE", headers: { origin: "https://admin.example", ...(admin ? { "x-verified-admin": "yes" } : {}) },
  })
}

describe("selected pinned Admin Product detail DELETE", () => {
  it("runs the exact native workflow and returns the delete envelope without a graph read or POST field admission", async () => {
    const f = fixture()
    const response = await f.handler.handle(request())
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ id: "prod_delete", object: "product", deleted: true })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-products", { input: { ids: ["prod_delete"] } })
    expect(f.evaluate.mock.calls).toEqual([[user, readPolicy], [user, deletePolicy]])
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("delegates missing and repeated IDs to the workflow without inventing an existence check", async () => {
    const f = fixture()
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.handler.handle(request("missing"))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: "missing", object: "product", deleted: true })
    }
    expect(f.run.mock.calls).toEqual([
      ["delete-products", { input: { ids: ["missing"] } }],
      ["delete-products", { input: { ids: ["missing"] } }],
    ])
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
  })

  it("requires a verified user and both native inherited read and explicit delete policies", async () => {
    for (const [options, admin, status] of [
      [{}, false, 401],
      [{ principal: { ...user, actor_type: "customer" } }, true, 401],
      [{ deniedOperation: "read" }, true, 403],
      [{ deniedOperation: "delete" }, true, 403],
    ] as const) {
      const f = fixture(options)
      expect((await f.handler.handle(request("prod_delete", "", admin))).status).toBe(status)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
      expect(f.admission).not.toHaveBeenCalled()
      if (status === 401) expect(f.evaluate).not.toHaveBeenCalled()
    }
  })

  it("preserves native detail query validation while allowing valid fields without POST projection admission", async () => {
    const f = fixture()
    expect((await f.handler.handle(request("prod_delete", "fields=id,*variants.prices"))).status).toBe(200)
    expect(f.run).toHaveBeenCalledTimes(1)
    for (const query of ["fields=__proto__.x", "title=unexpected", "limit=1"]) {
      expect((await f.handler.handle(request("prod_delete", query))).status).toBe(400)
    }
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
  })

  it("preserves native known failures and redacts unknown failures without retrying", async () => {
    for (const [fail, status, body] of [
      [new MedusaError(MedusaError.Types.INVALID_DATA, "Native deletion refused"), 400, { type: "invalid_data", message: "Native deletion refused" }],
      [new MedusaError(MedusaError.Types.NOT_FOUND, "Native product missing"), 404, { type: "not_found", message: "Native product missing" }],
      [new Error("private workflow failure"), 500, { type: "unknown_error", message: "An unknown error occurred." }],
    ] as const) {
      const f = fixture({ fail })
      const response = await f.handler.handle(request())
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject(body)
      expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-products", { input: { ids: ["prod_delete"] } })
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("serves DELETE preflight without a request scope or authentication", async () => {
    const f = fixture()
    const response = await f.handler.handle(new Request("https://private.test/admin/products/prod_delete", {
      method: "OPTIONS", headers: { origin: "https://admin.example", "access-control-request-method": "DELETE" },
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
    expect(response.headers.get("access-control-allow-methods")?.split(",")).toContain("DELETE")
    expect(f.scopes).toHaveLength(0)
    expect(f.evaluate).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
  })
})
