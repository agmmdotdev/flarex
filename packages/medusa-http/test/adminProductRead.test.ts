import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import type { AuthContext } from "@medusajs/framework/http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_read", actor_type: "user", auth_identity_id: "auth_read", app_metadata: {}, user_metadata: {} }
const readPolicy = [{ resource: "product", operation: "read" }]
const product = { id: "prod_read", title: "Read Product", variants: [{ id: "variant_read", price_set: { prices: [{ id: "price_read", amount: "123", currency_code: "usd", created_at: "2026-01-01", updated_at: "2026-01-01", price_rules: [{ attribute: "region_id", value: "region_read" }] }] } }] }

function fixture(options: { missing?: boolean; nullData?: boolean; denyRead?: boolean; principal?: AuthContext } = {}) {
  const graph = vi.fn(async (input: { entity: string }) => input.entity === "product_sales_channel"
    ? { data: [{ product_id: product.id }] }
    : { data: options.nullData ? null : options.missing ? [] : [product], metadata: { count: 9, skip: 2, take: 3 } })
  const index = vi.fn(async () => { throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Index engine is outside the admitted profile") })
  const remoteQuery = vi.fn(async () => [{ prices: [{ price_set: { variant: { id: "variant_read" } } }] }])
  const run = vi.fn()
  const evaluate = vi.fn((_principal, policies) => !options.denyRead || !policies.some((p: { operation: string }) => p.operation === "read"))
  const admission = vi.fn()
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: request => request.headers.has("x-verified-admin") ? options.principal ?? user : undefined,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    admitCatalogRefetchFields: () => undefined,
    createRequestScope: () => createContainer().register({ query: asValue({ graph, index }), remoteQuery: asValue(remoteQuery), workflows: asValue({ run }), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, graph, index, remoteQuery, run, evaluate, admission }
}

function request(path = "", query = "", admin = true) {
  return new Request(`https://private.test/admin/products${path}${query ? `?${query}` : ""}`, { headers: { origin: "https://admin.example", ...(admin ? { "x-verified-admin": "yes" } : {}) } })
}

afterEach(() => { FeatureFlag.setFlag("index_engine", false) })

describe("selected pinned Admin Product reads", () => {
  it("retrieves native defaults and remaps linked pricing without creating products", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("/prod_read"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ product: { id: "prod_read", variants: [{ id: "variant_read", prices: [{ amount: 123, rules: { region_id: "region_read" }, variant_id: "variant_read" }] }] } })
    expect(f.graph).toHaveBeenCalledWith({ entity: "product", fields: expect.arrayContaining(["id", "title", "type.*", "variants.*", "variants.price_set.prices.*", "variants.price_set.prices.price_rules.attribute", "sales_channels.*"]), filters: { id: "prod_read" }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.evaluate).toHaveBeenCalledWith(user, readPolicy)
    expect(f.admission).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("returns native detail 404 for empty or null graph results", async () => {
    for (const options of [{ missing: true }, { nullData: true }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request("/missing", "fields=id"))
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ type: "not_found", message: "Product not found" })
    }
  })

  it("preserves native filters, pagination, ordering, withDeleted and list count metadata", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id,title&title[]=Read%20Product&status[]=draft&limit=3&offset=2&order=-handle&with_deleted=true"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ count: 9, offset: 2, limit: 3, products: [{ id: "prod_read" }] })
    expect(f.graph).toHaveBeenCalledWith({ entity: "product", fields: ["id", "title"], filters: { title: ["Read Product"], status: ["draft"] }, pagination: { skip: 2, take: 3, order: { handle: "DESC" } }, withDeleted: true, context: undefined }, undefined)
    expect(f.evaluate).toHaveBeenCalledWith(user, readPolicy)
    expect(f.run).not.toHaveBeenCalled()
    const empty = fixture({ missing: true })
    expect(await (await empty.handler.handle(request())).json()).toEqual({ products: [], count: 9, offset: 2, limit: 3 })
  })

  it("keeps native link and price-list filter middleware on the admitted graph branch", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id&sales_channel_id=sc_read&price_list_id[]=pl_read&tag_id=tag_read&category_id=cat_read"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.graph.mock.calls[0]).toEqual([{ entity: "product_sales_channel", fields: ["product_id"], filters: { sales_channel_id: ["sc_read"] } }])
    expect(f.remoteQuery).toHaveBeenCalledOnce()
    expect(f.graph.mock.calls[1]?.[0]).toMatchObject({ filters: { id: ["prod_read"], tags: { id: "tag_read" }, categories: { id: "cat_read" }, variants: { id: ["variant_read"] } } })
  })

  it("requires verified user/read policy and rejects malformed list input before graph reads", async () => {
    for (const path of ["", "/prod_read"]) {
      const anonymous = fixture()
      expect((await anonymous.handler.handle(request(path, "", false))).status).toBe(401)
      expect(anonymous.graph).not.toHaveBeenCalled()
      const denied = fixture({ denyRead: true })
      expect((await denied.handler.handle(request(path))).status).toBe(403)
      expect(denied.graph).not.toHaveBeenCalled()
      const wrongActor = fixture({ principal: { ...user, actor_type: "customer" } })
      expect((await wrongActor.handler.handle(request(path))).status).toBe(401)
      expect(wrongActor.graph).not.toHaveBeenCalled()
    }
    const f = fixture()
    for (const query of ["limit=nope", "status[]=invalid", "fields=__proto__.x"]) {
      expect((await f.handler.handle(request("", query))).status).toBe(400)
    }
    expect(f.graph).not.toHaveBeenCalled()
  })

  it("retains the native flag dispatch and fails closed at the unsupported index service", async () => {
    FeatureFlag.setFlag("index_engine", true)
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id&sales_channel_id=sc_read"))
    expect(response.status).toBe(400)
    expect(f.index).toHaveBeenCalledWith({ entity: "product", fields: ["id"], filters: { sales_channels: { id: "sc_read" } }, pagination: { skip: 0, take: 50 }, withDeleted: undefined })
    expect(f.graph).not.toHaveBeenCalled()
  })
})
