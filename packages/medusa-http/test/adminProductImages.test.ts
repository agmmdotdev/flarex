import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"
import { adminProductRoutesMiddlewares } from "../src/api/admin/products/middlewares"

const user: AuthContext = { actor_id: "user_images", actor_type: "user", auth_identity_id: "auth_images", app_metadata: {}, user_metadata: {} }
const productId = "prod_url_images"
const result = { added: ["added_one", "added_one"], removed: ["removed_one"] }
const endpoints = [{
  path: `/admin/products/${productId}/variants/variant_url/images/batch`,
  matcher: "/admin/products/:id/variants/:variant_id/images/batch",
  workflow: "batch-variant-images", selector: { variant_id: "variant_url" }, variantPolicy: true,
}, {
  path: `/admin/products/${productId}/images/image_url/variants/batch`,
  matcher: "/admin/products/:id/images/:image_id/variants/batch",
  workflow: "batch-image-variants", selector: { image_id: "image_url" }, variantPolicy: false,
}] as const

function fixture(options: { anonymous?: boolean; deny?: string; workflowError?: Error; wait?: Promise<void> } = {}) {
  const run = vi.fn(async (_id: string, _options: unknown) => {
    await options.wait
    if (options.workflowError) throw options.workflowError
    return { result: structuredClone(result) }
  })
  const graph = vi.fn()
  const admission = vi.fn()
  const evaluate = vi.fn((_principal, policies: { resource: string; operation: string }[]) => !policies.some(policy => `${policy.resource}:${policy.operation}` === options.deny))
  const createRequestScope = vi.fn(() => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) }))
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: () => options.anonymous ? undefined : user,
    evaluateAdminPolicies: evaluate,
    admitSalesChannelRefetchFields: () => undefined,
    admitPriceListRefetchFields: () => undefined,
    admitVariantRefetchFields: () => undefined,
    admitProductRefetchFields: admission,
    admitCatalogRefetchFields: () => undefined,
    createRequestScope,
  })
  return { handler, run, graph, admission, evaluate, createRequestScope }
}

function request(path: string, body: unknown = {}, query = "", method = "POST") {
  return new Request(`https://private.test${path}${query ? `?${query}` : ""}`, {
    method, headers: { origin: "https://admin.example", "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  })
}

describe.each(endpoints)("native Product image batch $workflow", endpoint => {
  it("passes the URL parent and endpoint unchanged and returns the native result without a graph read", async () => {
    const f = fixture()
    const body = { add: ["same", "same", "third", "fourth", "fifth"], remove: ["same", "same"] }
    const response = await f.handler.handle(request(endpoint.path, body))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith(endpoint.workflow, { input: { ...endpoint.selector, product_id: productId, ...body } })
    expect(await response.json()).toEqual(result)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
    expect(f.evaluate.mock.calls).toEqual([
      [user, [{ resource: "product", operation: "read" }]],
      ...(endpoint.variantPolicy ? [[user, [{ resource: "product_variant", operation: "read" }]]] : []),
    ])
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
    expect(adminProductRoutesMiddlewares.find(route => route.matcher === endpoint.matcher)?.bodyParser).toEqual({ sizeLimit: "2mb" })
  })

  it("preserves omitted versus explicit empty arms and native unvalidated query fields", async () => {
    for (const body of [{}, { add: [] }, { remove: [] }, { add: [], remove: [] }]) {
      const f = fixture()
      const response = await f.handler.handle(request(endpoint.path, body, "fields=unsupported_field&limit=invalid&product_id=body_cannot_select"))
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toEqual(result)
      expect(f.run).toHaveBeenCalledExactlyOnceWith(endpoint.workflow, { input: {
        ...endpoint.selector, product_id: productId, add: "add" in body ? body.add : undefined, remove: "remove" in body ? body.remove : undefined,
      } })
      expect(f.graph).not.toHaveBeenCalled()
      expect(f.admission).not.toHaveBeenCalled()
    }
  })

  it("awaits the workflow and never adds a response refetch or projection gate", async () => {
    let release = () => {}
    const wait = new Promise<void>(resolve => { release = resolve })
    const f = fixture({ wait })
    let completed = false
    const pending = f.handler.handle(request(endpoint.path, { add: ["one"] })).then(response => { completed = true; return response })
    try {
      await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
      expect(completed).toBe(false)
      expect(f.graph).not.toHaveBeenCalled()
      expect(f.admission).not.toHaveBeenCalled()
    } finally { release() }
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(f.run).toHaveBeenCalledTimes(1)
  })

  it("enforces authentication and only the native applicable wildcard policies", async () => {
    for (const options of [{ anonymous: true }, { deny: "product:read" }, ...(endpoint.variantPolicy ? [{ deny: "product_variant:read" }] : [])]) {
      const f = fixture(options)
      const response = await f.handler.handle(request(endpoint.path, { add: ["one"] }))
      expect(response.status).toBe("anonymous" in options ? 401 : 403)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
    const noInventedPolicy = fixture({ deny: "product_variant:update" })
    expect((await noInventedPolicy.handler.handle(request(endpoint.path))).status).toBe(200)
    expect(noInventedPolicy.run).toHaveBeenCalledTimes(1)
  })

  it("rejects malformed native bodies and selector overrides without invoking the workflow", async () => {
    for (const body of [null, [], { add: "one" }, { remove: [42] }, { add: null },
      { product_id: "other", add: [] }, { variant_id: "other", add: [] }, { image_id: "other", add: [] },
      JSON.parse('{"__proto__":{"polluted":true},"add":[]}')]) {
      const f = fixture()
      const response = await f.handler.handle(request(endpoint.path, body))
      expect(response.status, await response.clone().text()).toBe(400)
      expect(await response.json()).toMatchObject({ type: "invalid_data" })
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("rejects prototype query keys and the existing private byte ceiling before execution", async () => {
    const invalid = fixture()
    expect((await invalid.handler.handle(request(endpoint.path, {}, "__proto__[x]=value"))).status).toBe(400)
    expect(invalid.run).not.toHaveBeenCalled()
    const oversized = fixture()
    const response = await oversized.handler.handle(request(endpoint.path, { add: ["x".repeat(1024 * 1024)] }))
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ type: "payload_too_large" })
    expect(oversized.run).not.toHaveBeenCalled()
    expect(oversized.graph).not.toHaveBeenCalled()
  })

  it("preserves native workflow errors and redacts unknown errors without replay", async () => {
    for (const [workflowError, status, type, message] of [
      [new MedusaError(MedusaError.Types.NOT_FOUND, "Native endpoint missing"), 404, "not_found", "Native endpoint missing"],
      [new MedusaError(MedusaError.Types.INVALID_DATA, "Native parent ownership refused"), 400, "invalid_data", "Native parent ownership refused"],
      [new Error("private image detail"), 500, "unknown_error", "An unknown error occurred."],
    ] as const) {
      const f = fixture({ workflowError })
      const response = await f.handler.handle(request(endpoint.path, { add: ["one"] }))
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ type, message })
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).not.toHaveBeenCalled()
      expect(f.admission).not.toHaveBeenCalled()
    }
  })

  it("serves native POST preflight without authentication or a request scope and leaves other methods unselected", async () => {
    const f = fixture({ anonymous: true })
    const preflight = await f.handler.handle(new Request(`https://private.test${endpoint.path}`, {
      method: "OPTIONS", headers: { origin: "https://admin.example", "access-control-request-method": "POST" },
    }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://admin.example")
    expect(f.createRequestScope).not.toHaveBeenCalled()
    expect(f.evaluate).not.toHaveBeenCalled()
    for (const method of ["GET", "DELETE", "PATCH"]) expect((await f.handler.handle(request(endpoint.path, {}, "", method))).status).toBe(404)
    expect(f.run).not.toHaveBeenCalled()
  })
})
