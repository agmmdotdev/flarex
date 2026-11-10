import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext, RefetchGraphQuery } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_variant_update", actor_type: "user", auth_identity_id: "auth_variant_update", app_metadata: {}, user_metadata: {} }
const product = { id: "prod_variant_update", title: "Parent", variants: [{ id: "variant_update", title: "Updated", price_set: { prices: [{ id: "price_update", amount: "175", currency_code: "usd", created_at: "2026-01-01", updated_at: "2026-01-02", price_rules: [{ attribute: "region_id", value: "reg_update" }] }] } }] }

function fixture(options: { principal?: AuthContext; deny?: string; workflowError?: Error; refetchError?: Error; missingParent?: boolean; nullParent?: boolean; emptyResult?: boolean; rejectProjection?: boolean } = {}) {
  const run = vi.fn(async () => {
    if (options.workflowError) throw options.workflowError
    return { result: options.emptyResult ? [] : [{ id: "ignored_workflow_result" }] }
  })
  const graph = vi.fn<RefetchGraphQuery<{ id: string }>["graph"]>(async () => {
    if (options.refetchError) throw options.refetchError
    return { data: options.nullParent ? null : options.missingParent ? [] : structuredClone([product]) }
  })
  const evaluate = vi.fn((_principal, policies: { resource: string; operation: string }[]) => !policies.some(policy => `${policy.resource}:${policy.operation}` === options.deny))
  const admission = vi.fn(() => {
    if (options.rejectProjection) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported Product refetch fields")
  })
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: request => request.headers.has("x-verified-admin") ? options.principal ?? user : undefined,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    admitCatalogRefetchFields: () => undefined,
    createRequestScope: () => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, run, graph, evaluate, admission }
}

function request(body: unknown = {}, query = "", admin = true) {
  return new Request(`https://private.test/admin/products/${product.id}/variants/variant_update${query ? `?${query}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://admin.example", ...(admin ? { "x-verified-admin": "yes" } : {}) }, body: JSON.stringify(body),
  })
}

describe("selected pinned Admin Product variant detail POST", () => {
  it("forwards the native two-id selector, update and additional_data, then remaps the refetched parent", async () => {
    const f = fixture()
    const response = await f.handler.handle(request({ title: "Updated", sku: null, manage_inventory: "false", allow_backorder: "true", additional_data: { source: "test" } }, "fields=id,title,*variants.prices"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-variants", { input: { selector: { id: "variant_update", product_id: product.id }, update: { title: "Updated", sku: null, manage_inventory: false, allow_backorder: true }, additional_data: { source: "test" } } })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id", "title", "variants.price_set.prices.*"], filters: { id: product.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(["id", "title", "variants.price_set.prices.*"])
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.graph.mock.invocationCallOrder[0])
    expect(await response.json()).toMatchObject({ product: { id: product.id, variants: [{ id: "variant_update", prices: [{ id: "price_update", amount: 175, variant_id: "variant_update", min_quantity: null, max_quantity: null, rules: { region_id: "reg_update" } }] }] } })
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("uses native Product defaults for refetch and retains empty updates without create defaults", async () => {
    const f = fixture()
    expect((await f.handler.handle(request())).status).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-variants", { input: { selector: { id: "variant_update", product_id: product.id }, update: {}, additional_data: undefined } })
    expect(f.graph.mock.calls[0]?.[0]).toMatchObject({ fields: expect.arrayContaining(["id", "title", "variants.*", "variants.price_set.prices.*", "sales_channels.*"]) })
    expect(f.admission).toHaveBeenCalledWith(f.graph.mock.calls[0]?.[0].fields)
  })

  it("forwards native optional price fields, null values, options and body id to the workflow boundary", async () => {
    const f = fixture()
    const update = { id: "variant_update", thumbnail: null, weight: null, metadata: null, prices: [{ id: "price_update", min_quantity: null, max_quantity: 5, rules: { region_id: "reg_update" } }], options: { Size: "Large" } }
    expect((await f.handler.handle(request(update, "fields=id"))).status).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-variants", { input: { selector: { id: "variant_update", product_id: product.id }, update, additional_data: undefined } })
  })

  it("requires exactly the inherited Product read and Variant read policies before execution", async () => {
    const f = fixture()
    expect((await f.handler.handle(request())).status).toBe(200)
    expect(f.evaluate.mock.calls).toEqual([
      [user, [{ resource: "product", operation: "read" }]],
      [user, [{ resource: "product_variant", operation: "read" }]],
    ])
    for (const [options, admin, status] of [[{}, false, 401], [{ principal: { ...user, actor_type: "customer" } }, true, 401], [{ deny: "product:read" }, true, 403], [{ deny: "product_variant:read" }, true, 403]] as const) {
      const denied = fixture(options)
      expect((await denied.handler.handle(request({}, "", admin))).status).toBe(status)
      expect(denied.run).not.toHaveBeenCalled()
      expect(denied.graph).not.toHaveBeenCalled()
    }
  })

  it("rejects strict or malformed native bodies and query fields before mutation", async () => {
    const f = fixture()
    for (const body of [{ product_id: "other" }, { title: null }, { inventory_items: [] }, { manage_inventory: "invalid" }, { prices: [{ amount: "175" }] }, { options: { Size: null } }, { unknown: true }]) {
      expect((await f.handler.handle(request(body))).status).toBe(400)
    }
    expect((await f.handler.handle(request({}, "fields=__proto__.x"))).status).toBe(400)
    expect((await f.handler.handle(request({}, "fields=id&title=Other"))).status).toBe(400)
    expect(f.run).not.toHaveBeenCalled()
    expect(f.graph).not.toHaveBeenCalled()
  })

  it("rejects unsupported parent projections before workflow execution or refetch", async () => {
    const f = fixture({ rejectProjection: true })
    expect((await f.handler.handle(request({}, "fields=id,*variants.prices"))).status).toBe(400)
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(["id", "variants.price_set.prices.*"])
    expect(f.run).not.toHaveBeenCalled()
    expect(f.graph).not.toHaveBeenCalled()
  })

  it("ignores empty workflow results and refetches the URL parent without an HTTP existence precheck", async () => {
    const f = fixture({ emptyResult: true })
    const response = await f.handler.handle(request({}, "fields=id"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ product: { id: product.id } })
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.graph).toHaveBeenCalledTimes(1)
    expect(f.graph.mock.calls[0]?.[0]).toMatchObject({ entity: "product", filters: { id: product.id } })
  })

  it("preserves native not-found and validation workflow errors and redacts unknown failures without retry", async () => {
    for (const [error, status, type, message] of [
      [new MedusaError(MedusaError.Types.NOT_FOUND, "Native variant not found"), 404, "not_found", "Native variant not found"],
      [new MedusaError(MedusaError.Types.INVALID_DATA, "Native update refused"), 400, "invalid_data", "Native update refused"],
      [new Error("private workflow detail"), 500, "unknown_error", "An unknown error occurred."],
    ] as const) {
      const f = fixture({ workflowError: error })
      const response = await f.handler.handle(request())
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ type, message })
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("redacts missing or failed parent refetches and never replays the completed update", async () => {
    for (const options of [{ missingParent: true }, { nullParent: true }, { refetchError: new Error("private refetch detail") }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request())
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).toHaveBeenCalledTimes(1)
    }
  })
})
