import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_option_delete", actor_type: "user", auth_identity_id: "auth_option_delete", app_metadata: {}, user_metadata: {} }
const parent = { id: "prod_option_delete", title: "Parent", options: [], variants: [{ id: "variant_retained", price_set: { prices: [{ id: "price_retained", amount: "350", currency_code: "usd" }] } }] }

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
    admitVariantRefetchFields: () => undefined,
    admitProductRefetchFields: admission,
    admitCatalogRefetchFields: () => undefined,
    createRequestScope,
  })
  return { handler, run, graph, admission, evaluate, createRequestScope }
}

function request(query = "", optionId = "option_delete", body?: unknown) {
  return new Request(`https://private.test/admin/products/${parent.id}/options/${optionId}${query ? `?${query}` : ""}`, {
    method: "DELETE", headers: { origin: "https://admin.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe("parent-qualified native Admin Product Option DELETE", () => {
  it("passes URL Product ownership and returns the exact native raw-parent envelope", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("fields=id,title,*variants.prices"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-product-options", { input: { ids: ["option_delete"], product_id: parent.id } })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id", "title", "variants.price_set.prices.*"], filters: { id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    // Native Option DELETE returns the graph DTO directly, retaining price_set
    // and its amount representation instead of the POST Product remapping.
    expect(await response.json()).toEqual({ id: "option_delete", object: "product_option", deleted: true, parent })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(["id", "title", "variants.price_set.prices.*"])
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.graph.mock.invocationCallOrder[0])
    expect(f.evaluate.mock.calls).toEqual([
      [user, [{ resource: "product", operation: "read" }]],
      [user, [{ resource: "product_option", operation: "read" }]],
      [user, [{ resource: "product_option", operation: "delete" }]],
    ])
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("uses native parent default fields and ignores a body trying to replace the route selector", async () => {
    const f = fixture()
    expect((await f.handler.handle(request("", "option_delete", { ids: ["other_option"], product_id: "other_product" }))).status).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-product-options", { input: { ids: ["option_delete"], product_id: parent.id } })
    expect(f.admission).toHaveBeenCalledWith(expect.arrayContaining(["id", "title", "options.*", "options.values.*", "variants.price_set.prices.*"]))
    expect(f.graph).toHaveBeenCalledTimes(1)
  })

  it("keeps no-op results successful without an HTTP Option existence precheck", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("fields=id", "absent_or_wrong_parent"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "absent_or_wrong_parent", object: "product_option", deleted: true, parent })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-product-options", { input: { ids: ["absent_or_wrong_parent"], product_id: parent.id } })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id"], filters: { id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
  })

  it("requires authentication and all three native read/delete policies before execution", async () => {
    for (const options of [{ anonymous: true }, { deny: "product:read" }, { deny: "product_option:read" }, { deny: "product_option:delete" }]) {
      const f = fixture(options)
      expect((await f.handler.handle(request())).status).toBe("anonymous" in options ? 401 : 403)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("refuses invalid query filters and unsupported parent projections before mutation", async () => {
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

  it("preserves native workflow refusals and redacts unknown failures without replay or refetch", async () => {
    for (const [workflowError, status, type, message] of [
      [new MedusaError(MedusaError.Types.NOT_FOUND, "Native Option missing"), 404, "not_found", "Native Option missing"],
      [new MedusaError(MedusaError.Types.INVALID_DATA, "Native Option deletion refused"), 400, "invalid_data", "Native Option deletion refused"],
      [new Error("private Option detail"), 500, "unknown_error", "An unknown error occurred."],
    ] as const) {
      const f = fixture({ workflowError })
      const response = await f.handler.handle(request())
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ type, message })
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("preserves the native raw-parent absence response after a completed deletion", async () => {
    for (const options of [{ missingParent: true }, { nullParent: true }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: "option_delete", object: "product_option", deleted: true, ...("nullParent" in options ? { parent: null } : {}) })
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).toHaveBeenCalledTimes(1)
    }
  })

  it("redacts a failed parent refetch and never replays the committed deletion", async () => {
    const f = fixture({ graphError: new Error("private parent detail") })
    const response = await f.handler.handle(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.graph).toHaveBeenCalledTimes(1)
  })

  it("serves DELETE preflight without authentication or a request scope", async () => {
    const f = fixture({ anonymous: true })
    const response = await f.handler.handle(new Request(`https://private.test/admin/products/${parent.id}/options/option_delete`, {
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
