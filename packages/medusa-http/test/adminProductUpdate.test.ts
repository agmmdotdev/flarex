import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext, RefetchGraphQuery } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_update", actor_type: "user", auth_identity_id: "auth_update", app_metadata: {}, user_metadata: {} }
const readPolicy = [{ resource: "product", operation: "read" }]
const product = { id: "prod_updated", title: "Updated", variants: [{ id: "variant_update", price_set: { prices: [{ id: "price_update", amount: "125", currency_code: "usd", price_rules: [{ attribute: "region_id", value: "reg_update" }] }] } }] }

function fixture(options: { principal?: AuthContext; deny?: boolean; missing?: boolean; fail?: Error; refetchFail?: Error; missingRefetch?: boolean; rejectProjection?: boolean } = {}) {
  let settled = false
  const run = vi.fn(async () => {
    if (options.fail) throw options.fail
    settled = true
    return { result: [{ id: product.id }] }
  })
  const graph = vi.fn<RefetchGraphQuery<{ id: string }>["graph"]>(async () => {
    if (!settled) return { data: options.missing ? [] : [{ id: "prod_update" }] }
    if (options.refetchFail) throw options.refetchFail
    return { data: options.missingRefetch ? [] : [product] }
  })
  const evaluate = vi.fn(() => !options.deny)
  const admission = vi.fn(() => {
    if (options.rejectProjection) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product projection is outside the admitted profile")
  })
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: request => request.headers.has("x-verified-admin") ? options.principal ?? user : undefined,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    createRequestScope: () => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, run, graph, evaluate, admission }
}

function request(body: unknown = {}, query = "", admin = true) {
  return new Request(`https://private.test/admin/products/prod_update${query ? `?${query}` : ""}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://admin.example", ...(admin ? { "x-verified-admin": "yes" } : {}) }, body: JSON.stringify(body),
  })
}

describe("selected pinned Admin Product detail POST", () => {
  it("prefetches identity, forwards native normalized update, then refetches the workflow result with default fields", async () => {
    const f = fixture()
    const response = await f.handler.handle(request({ title: "Updated", discountable: "false", is_giftcard: "true", handle: null, shipping_profile_id: null, additional_data: { source: "test" } }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.evaluate).toHaveBeenCalledWith(user, readPolicy)
    expect(f.run).toHaveBeenCalledWith("update-products", { input: { selector: { id: "prod_update" }, update: { title: "Updated", discountable: false, is_giftcard: true, handle: null, shipping_profile_id: null }, additional_data: { source: "test" } } })
    expect(f.graph.mock.calls[0]).toEqual([{ entity: "product", fields: ["id"], filters: { id: "prod_update" }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined])
    expect(f.graph.mock.calls[1]?.[0]).toMatchObject({ entity: "product", filters: { id: "prod_updated" }, fields: expect.arrayContaining(["id", "title", "type.*", "variants.*", "variants.price_set.prices.*", "sales_channels.*"]) })
    expect(f.admission).toHaveBeenCalledWith(f.graph.mock.calls[1]?.[0].fields)
    expect(await response.json()).toMatchObject({ product: { id: "prod_updated", variants: [{ id: "variant_update", prices: [{ amount: 125, rules: { region_id: "reg_update" }, variant_id: "variant_update" }] }] } })
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("keeps empty updates empty and selects refetch fields without adding filters to the selector", async () => {
    const f = fixture()
    const response = await f.handler.handle(request({}, "fields=id,title"))
    expect(response.status).toBe(200)
    expect(f.run).toHaveBeenCalledWith("update-products", { input: { selector: { id: "prod_update" }, update: {}, additional_data: undefined } })
    expect(f.graph.mock.calls[1]?.[0]).toMatchObject({ fields: ["id", "title"], filters: { id: "prod_updated" } })
    const filtered = fixture()
    expect((await filtered.handler.handle(request({}, "fields=id&title=other"))).status).toBe(400)
    expect(filtered.run).not.toHaveBeenCalled()
    expect(filtered.graph).not.toHaveBeenCalled()
  })

  it("retains nested update validator optionals, nulls and boolean normalization without create defaults", async () => {
    const f = fixture()
    const update = { options: [{ id: "opt_update", values: [] }], variants: [{ id: "var_update", sku: null, manage_inventory: "false", prices: [{ id: "price_update", min_quantity: null }] }], images: [{ id: "img_update", url: "https://example.test/new.jpg" }] }
    expect((await f.handler.handle(request(update, "fields=id"))).status).toBe(200)
    expect(f.run).toHaveBeenCalledWith("update-products", { input: { selector: { id: "prod_update" }, update: { ...update, variants: [{ id: "var_update", sku: null, manage_inventory: false, prices: [{ id: "price_update", min_quantity: null }] }] }, additional_data: undefined } })
  })

  it("rejects authentication and native inherited policy denial before graph or workflow calls", async () => {
    for (const [options, admin, status] of [[{}, false, 401], [{ principal: { ...user, actor_type: "customer" } }, true, 401], [{ deny: true }, true, 403]] as const) {
      const f = fixture(options)
      expect((await f.handler.handle(request({}, "", admin))).status).toBe(status)
      expect(f.graph).not.toHaveBeenCalled()
      expect(f.run).not.toHaveBeenCalled()
    }
  })

  it("rejects strict or malformed native bodies and unsupported projections before any reads or updates", async () => {
    const f = fixture()
    for (const body of [{ id: "other" }, { title: null }, { status: null }, { variants: [{ inventory_items: [] }] }, { variants: [{ prices: [{ amount: "125" }] }] }, { unknown: true }]) {
      expect((await f.handler.handle(request(body))).status).toBe(400)
    }
    expect((await f.handler.handle(request({}, "fields=__proto__.x"))).status).toBe(400)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
    const rejected = fixture({ rejectProjection: true })
    expect((await rejected.handler.handle(request({}, "fields=id,*variants.prices"))).status).toBe(400)
    expect(rejected.graph).not.toHaveBeenCalled()
    expect(rejected.run).not.toHaveBeenCalled()
  })

  it("returns the native missing-product message before workflow execution", async () => {
    const f = fixture({ missing: true })
    const response = await f.handler.handle(request())
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ type: "not_found", message: 'Product with id "prod_update" not found' })
    expect(f.run).not.toHaveBeenCalled()
    expect(f.graph).toHaveBeenCalledTimes(1)
  })

  it("preserves known and unknown workflow failures and never replays an update after refetch failure", async () => {
    for (const [fail, status] of [[new MedusaError(MedusaError.Types.INVALID_DATA, "Native update refused"), 400], [new Error("unexpected workflow failure"), 500]] as const) {
      const f = fixture({ fail })
      const response = await f.handler.handle(request())
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject(status === 500
        ? { type: "unknown_error", message: "An unknown error occurred." }
        : { type: "invalid_data", message: "Native update refused" })
      expect(f.graph).toHaveBeenCalledTimes(1)
      expect(f.run).toHaveBeenCalledTimes(1)
    }
    for (const options of [{ missingRefetch: true }, { refetchFail: new Error("unexpected refetch failure") }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request())
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
      expect(f.graph).toHaveBeenCalledTimes(2)
      expect(f.run).toHaveBeenCalledTimes(1)
    }
  })

  it("leaves PATCH unselected", async () => {
    const f = fixture()
    expect((await f.handler.handle(new Request("https://private.test/admin/products/prod_update", { method: "PATCH" }))).status).toBe(404)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
  })
})
