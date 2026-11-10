import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_variant_delete", actor_type: "user", auth_identity_id: "auth_variant_delete", app_metadata: {}, user_metadata: {} }
const parent = { id: "prod_variant_delete", title: "Parent", variants: [{ id: "variant_retained", price_set: { prices: [{ id: "price_retained", amount: "350", currency_code: "usd", created_at: "2026-01-01", updated_at: "2026-01-01" }] } }] }

function fixture(options: { anonymous?: boolean; deny?: string; workflowError?: Error; graphError?: Error; missingParent?: boolean; nullParent?: boolean; rejectProjection?: boolean } = {}) {
  const run = vi.fn(async () => {
    if (options.workflowError) throw options.workflowError
    return { result: null }
  })
  const graph = vi.fn(async () => {
    if (options.graphError) throw options.graphError
    return { data: options.nullParent ? null : options.missingParent ? [] : structuredClone([parent]) }
  })
  const admission = vi.fn(() => { if (options.rejectProjection) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported Product refetch fields") })
  const evaluate = vi.fn((_principal, policies: { resource: string; operation: string }[]) => !policies.some(policy => `${policy.resource}:${policy.operation}` === options.deny))
  const createRequestScope = vi.fn(() => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) }))
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: () => options.anonymous ? undefined : user,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    admitCatalogRefetchFields: () => undefined,
    createRequestScope,
  })
  return { handler, run, graph, admission, evaluate, createRequestScope }
}

function request(query = "", variantId = "variant_delete", body?: unknown) {
  return new Request(`https://private.test/admin/products/${parent.id}/variants/${variantId}${query ? `?${query}` : ""}`, {
    method: "DELETE", headers: { origin: "https://admin.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe("parent-qualified native Admin Product variant DELETE", () => {
  it("passes URL Product ownership to the workflow, refetches the parent and returns the native delete envelope", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("fields=id,title,*variants.prices"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-product-variants", { input: { ids: ["variant_delete"], product_id: parent.id } })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id", "title", "variants.price_set.prices.*"], filters: { id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(await response.json()).toMatchObject({ id: "variant_delete", object: "variant", deleted: true,
      parent: { id: parent.id, variants: [{ id: "variant_retained", prices: [{ id: "price_retained", amount: 350, variant_id: "variant_retained" }] }] } })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(["id", "title", "variants.price_set.prices.*"])
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.graph.mock.invocationCallOrder[0])
    expect(f.evaluate.mock.calls).toEqual([
      [user, [{ resource: "product", operation: "read" }]],
      [user, [{ resource: "product_variant", operation: "read" }]],
      [user, [{ resource: "product_variant", operation: "delete" }]],
    ])
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("uses native parent default fields and ignores a body attempting to change the route selector", async () => {
    const f = fixture()
    expect((await f.handler.handle(request("", "variant_delete", { ids: ["other_variant"], product_id: "other_product" }))).status).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-product-variants", { input: { ids: ["variant_delete"], product_id: parent.id } })
    expect(f.admission).toHaveBeenCalledWith(expect.arrayContaining(["id", "title", "options.*", "variants.*", "variants.price_set.prices.*"]))
    expect(f.graph).toHaveBeenCalledTimes(1)
  })

  it("keeps a no-op workflow result successful without an HTTP variant existence precheck", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("fields=id", "absent_or_wrong_parent"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "absent_or_wrong_parent", object: "variant", deleted: true, parent: { id: parent.id } })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-product-variants", { input: { ids: ["absent_or_wrong_parent"], product_id: parent.id } })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id"], filters: { id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
  })

  it("rejects authentication and each native read/delete policy before execution", async () => {
    for (const options of [{ anonymous: true }, { deny: "product:read" }, { deny: "product_variant:read" }, { deny: "product_variant:delete" }]) {
      const f = fixture(options)
      expect((await f.handler.handle(request())).status).toBe("anonymous" in options ? 401 : 403)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("refuses invalid query filters and unsupported parent projections before deletion", async () => {
    const invalid = fixture()
    for (const query of ["fields=__proto__.x", "fields=id&product_id=other", "fields=id&title=Other"]) {
      expect((await invalid.handler.handle(request(query))).status).toBe(400)
    }
    expect(invalid.run).not.toHaveBeenCalled()
    expect(invalid.graph).not.toHaveBeenCalled()
    const unsupported = fixture({ rejectProjection: true })
    expect((await unsupported.handler.handle(request("fields=id,*variants.prices"))).status).toBe(400)
    expect(unsupported.admission).toHaveBeenCalledExactlyOnceWith(["id", "variants.price_set.prices.*"])
    expect(unsupported.run).not.toHaveBeenCalled()
    expect(unsupported.graph).not.toHaveBeenCalled()
  })

  it("preserves native workflow errors and redacts unknown failures without retry or parent refetch", async () => {
    for (const [workflowError, status, type, message] of [
      [new MedusaError(MedusaError.Types.NOT_FOUND, "Native Variant missing"), 404, "not_found", "Native Variant missing"],
      [new MedusaError(MedusaError.Types.INVALID_DATA, "Native Variant deletion refused"), 400, "invalid_data", "Native Variant deletion refused"],
      [new Error("private deletion detail"), 500, "unknown_error", "An unknown error occurred."],
    ] as const) {
      const f = fixture({ workflowError })
      const response = await f.handler.handle(request())
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ type, message })
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("redacts missing, null or failed parent refetches and never replays a completed deletion", async () => {
    for (const options of [{ missingParent: true }, { nullParent: true }, { graphError: new Error("private parent detail") }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request())
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).toHaveBeenCalledTimes(1)
    }
  })

  it("serves native DELETE preflight without authentication or acquiring a request scope", async () => {
    const f = fixture({ anonymous: true })
    const response = await f.handler.handle(new Request(`https://private.test/admin/products/${parent.id}/variants/variant_delete`, {
      method: "OPTIONS", headers: { origin: "https://admin.example", "access-control-request-method": "DELETE" },
    }))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
    expect(response.headers.get("access-control-allow-methods")?.split(",")).toContain("DELETE")
    expect(f.createRequestScope).not.toHaveBeenCalled()
    expect(f.evaluate).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
  })
})
