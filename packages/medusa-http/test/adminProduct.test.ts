import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_test", actor_type: "user", auth_identity_id: "auth_test", app_metadata: {}, user_metadata: {} }
const policies = [
  { resource: "product", operation: "create" },
  { resource: "inventory_item", operation: "create" },
  { resource: "price", operation: "create" },
]
const body = { title: "Test Product", options: [{ title: "Size", values: ["One"] }] }
const fields = "id,title,handle,status"

function fixture(options: { principal?: AuthContext | undefined; deny?: boolean; fail?: boolean; refetchFail?: boolean } = {}) {
  let committed = false
  const run = vi.fn(async () => {
    if (options.fail) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Native creation refused")
    committed = true
    return { result: [{ id: "prod_test" }] }
  })
  const graph = vi.fn(async () => {
    expect(committed).toBe(true)
    if (options.refetchFail) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product missing after settlement")
    return { data: [{ id: "prod_test", title: "Test Product", handle: "test-product", status: "draft" }] }
  })
  const evaluate = vi.fn(() => !options.deny)
  const admission = vi.fn((selection: readonly string[]) => {
    if (selection.some(field => !["id", "title", "handle", "status"].includes(field))) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product projection is outside the admitted profile")
    }
  })
  const scopes: object[] = []
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: request => request.headers.get("x-verified-admin") === "test" ? options.principal ?? user : undefined,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    createRequestScope: () => {
      const scope = createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), logger: asValue({ error: () => undefined, info: () => undefined }) })
      scopes.push(scope)
      return scope
    },
  })
  return { handler, run, graph, evaluate, admission, scopes }
}

function request(input: unknown = body, selection: string | null = fields, admin = true) {
  return new Request(`https://private.test/admin/products${selection === null ? "" : `?fields=${encodeURIComponent(selection)}`}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://admin.example", ...(admin ? { "x-verified-admin": "test" } : {}) }, body: JSON.stringify(input),
  })
}

describe("private native Admin Product POST", () => {
  it("runs native normalized input, settles, then independently refetches the response", async () => {
    const f = fixture()
    const response = await f.handler.handle(request({ ...body, is_giftcard: "false", discountable: "true", additional_data: { fixture: true } }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ product: { id: "prod_test", title: "Test Product", handle: "test-product", status: "draft" } })
    expect(f.run).toHaveBeenCalledWith("create-products", { input: { products: [{ ...body, is_giftcard: false, discountable: true, status: "draft" }], additional_data: { fixture: true } } })
    expect(f.graph).toHaveBeenCalledWith({ entity: "product", fields: ["id", "title", "handle", "status"], filters: { id: "prod_test" }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.evaluate).toHaveBeenCalledWith(user, policies)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("never elevates anonymous, wrong-actor or policy-denied principals", async () => {
    const anonymous = fixture()
    expect((await anonymous.handler.handle(request(body, fields, false))).status).toBe(401)
    expect(anonymous.evaluate).not.toHaveBeenCalled()
    expect(anonymous.run).not.toHaveBeenCalled()
    const wrongActor = fixture({ principal: { ...user, actor_type: "customer" } })
    expect((await wrongActor.handler.handle(request())).status).toBe(401)
    expect(wrongActor.run).not.toHaveBeenCalled()
    const denied = fixture({ deny: true })
    expect((await denied.handler.handle(request())).status).toBe(403)
    expect(denied.run).not.toHaveBeenCalled()
  })

  it("rejects unsupported defaults or fields and malformed bodies before the workflow", async () => {
    const f = fixture()
    expect((await f.handler.handle(request(body, null))).status).toBe(400)
    expect((await f.handler.handle(request(body, "id,*variants.prices"))).status).toBe(400)
    expect((await f.handler.handle(request({ ...body, unknown: true }))).status).toBe(400)
    expect((await f.handler.handle(request({ options: [] }))).status).toBe(400)
    expect(f.run).not.toHaveBeenCalled()
    expect(f.graph).not.toHaveBeenCalled()
  })

  it("does not refetch an uncommitted workflow result or replay a committed write on refetch failure", async () => {
    const failed = fixture({ fail: true })
    expect((await failed.handler.handle(request())).status).toBe(400)
    expect(failed.graph).not.toHaveBeenCalled()
    const refetchFailed = fixture({ refetchFail: true })
    expect((await refetchFailed.handler.handle(request())).status).toBe(404)
    expect(refetchFailed.run).toHaveBeenCalledTimes(1)
    expect(refetchFailed.graph).toHaveBeenCalledTimes(1)
    const missing = fixture()
    missing.graph.mockResolvedValueOnce({ data: [] })
    expect((await missing.handler.handle(request())).status).toBe(500)
    expect(missing.run).toHaveBeenCalledTimes(1)
    expect(missing.graph).toHaveBeenCalledTimes(1)
  })

  it("answers preflight without authentication or scope and authenticates activated reads", async () => {
    const f = fixture()
    const preflight = await f.handler.handle(new Request("https://private.test/admin/products", { method: "OPTIONS", headers: { origin: "https://admin.example", "access-control-request-method": "POST" } }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://admin.example")
    expect(f.scopes).toHaveLength(0)
    expect((await f.handler.handle(new Request("https://private.test/admin/products"))).status).toBe(401)
    expect(await f.handler.tryHandle(new Request("https://private.test/admin/other"))).toBeUndefined()
  })
})
