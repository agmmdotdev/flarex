import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_variant", actor_type: "user", auth_identity_id: "auth_variant", app_metadata: {}, user_metadata: {} }
const managed = { id: "variant_managed", product_id: "prod_variants", title: "Managed", manage_inventory: true, price_set: { prices: [{ id: "price_variant", amount: "120", currency_code: "usd", created_at: "2026-01-01", updated_at: "2026-01-01", price_rules: [{ attribute: "region_id", value: "region_variant" }] }] } }
const unmanaged = { id: "variant_unmanaged", product_id: "prod_variants", title: "Unmanaged", manage_inventory: false }
const parent = { id: "prod_variants", variants: [managed] }

function fixture(options: { missing?: boolean; nullData?: boolean; deny?: string; anonymous?: boolean; workflowError?: boolean; admissionError?: boolean; missingParent?: boolean } = {}) {
  const graph = vi.fn(async (input: { entity: string }) => {
    if (input.entity === "product_variant_inventory_items") return { data: [
      { variant_id: managed.id, required_quantity: 2, variant: managed, inventory: { location_levels: [{ location_id: "loc_one", available_quantity: 7 }, { location_id: "loc_two", available_quantity: 4 }] } },
      { variant_id: managed.id, required_quantity: 3, variant: managed, inventory: { location_levels: [{ location_id: "loc_one", available_quantity: 10 }] } },
    ] }
    if (input.entity === "product") return { data: options.missingParent ? [] : [parent] }
    return { data: options.nullData ? null : options.missing ? [] : structuredClone([managed, unmanaged]), metadata: { count: 11, skip: 2, take: 3 } }
  })
  const run = vi.fn(async () => {
    if (options.workflowError) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Variant workflow failed")
    return { result: [{ id: managed.id }] }
  })
  const admission = vi.fn(() => { if (options.admissionError) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported product refetch field") })
  const evaluate = vi.fn((_principal, policies: { resource: string; operation: string }[]) => !policies.some(policy => `${policy.resource}:${policy.operation}` === options.deny))
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: () => options.anonymous ? undefined : user,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    createRequestScope: () => createContainer().register({ query: asValue({ graph }), workflows: asValue({ run }), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, graph, run, admission, evaluate }
}

function request(path = "", query = "", body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`https://private.test/admin/products/prod_variants/variants${path}${query ? `?${query}` : ""}`, { method, headers: { origin: "https://admin.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

describe("selected pinned Admin Product variant routes", () => {
  it("lists native defaults, prices and metadata with the parent ownership selector", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "id[]=variant_managed&manage_inventory=true&limit=3&offset=2&order=-created_at"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ variants: [{ id: managed.id, prices: [{ amount: 120, variant_id: managed.id, rules: { region_id: "region_variant" } }] }, { id: unmanaged.id }], count: 11, offset: 2, limit: 3 })
    expect(f.graph).toHaveBeenCalledWith({ entity: "variant", fields: expect.arrayContaining(["id", "title", "product_id", "options.*", "price_set.prices.*", "price_set.prices.price_rules.attribute"]), filters: { id: [managed.id], manage_inventory: true, product_id: parent.id }, pagination: { skip: 2, take: 3, order: { created_at: "DESC" } }, withDeleted: undefined, context: undefined }, undefined)
    expect(f.graph.mock.calls[0]?.[0]).not.toHaveProperty("fields", expect.arrayContaining(["product.*"]))
    expect(f.run).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
  })

  it("retrieves a variant under its product and preserves native missing detail response", async () => {
    const f = fixture()
    const response = await f.handler.handle(request(`/${managed.id}`, "fields=id,*prices"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ variant: { id: managed.id, prices: [{ amount: 120 }] } })
    expect(f.graph).toHaveBeenCalledWith({ entity: "variant", fields: ["id", "price_set.prices.*"], filters: { id: managed.id, product_id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.evaluate).toHaveBeenNthCalledWith(1, user, [{ resource: "product", operation: "read" }])
    expect(f.evaluate).toHaveBeenNthCalledWith(2, user, [{ resource: "product_variant", operation: "read" }])
    for (const options of [{ missing: true }, { nullData: true }]) {
      const absent = fixture(options)
      const response = await absent.handler.handle(request("/missing", "fields=id"))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual("nullData" in options ? { variant: null } : {})
    }
  })

  it("runs native total availability only on request, sums locations, divides and takes the minimum", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id,manage_inventory,inventory_quantity"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ variants: [{ id: managed.id, inventory_quantity: 3 }, { id: unmanaged.id }] })
    expect(f.graph.mock.calls[0]?.[0]).toMatchObject({ fields: ["id", "manage_inventory"] })
    expect(f.graph.mock.calls[1]).toEqual([{ entity: "product_variant_inventory_items", fields: ["variant_id", "required_quantity", "variant.manage_inventory", "variant.allow_backorder", "inventory.*", "inventory.location_levels.*"], filters: { variant_id: [managed.id, unmanaged.id] } }, { cache: { enable: true } }])
    const unrequested = fixture()
    await unrequested.handler.handle(request("", "fields=id"))
    expect(unrequested.graph).toHaveBeenCalledTimes(1)
    const empty = fixture({ missing: true })
    expect(await (await empty.handler.handle(request("", "fields=id,inventory_quantity"))).json()).toEqual({ variants: [], count: 11, offset: 2, limit: 3 })
    expect(empty.graph).toHaveBeenCalledTimes(1)
  })

  it("creates through exact native workflow arguments and refetches the parent Product", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id,*variants.prices", { title: "Created", prices: [{ currency_code: "usd", amount: 500 }], additional_data: { source: "test" } }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("create-product-variants", { input: { product_variants: [{ title: "Created", prices: [{ currency_code: "usd", amount: 500 }], allow_backorder: false, manage_inventory: true, product_id: parent.id }], additional_data: { source: "test" } } })
    expect(f.admission).toHaveBeenCalledWith(["id", "variants.price_set.prices.*"])
    expect(f.graph).toHaveBeenCalledWith({ entity: "product", fields: ["id", "variants.price_set.prices.*"], filters: { id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(await response.json()).toMatchObject({ product: { id: parent.id, variants: [{ prices: [{ amount: 120 }] }] } })
    expect(f.evaluate).toHaveBeenNthCalledWith(1, user, [{ resource: "product", operation: "read" }])
    expect(f.evaluate).toHaveBeenNthCalledWith(2, user, [{ resource: "product_variant", operation: "create" }])
  })

  it("admits native parent defaults and refuses fields, invalid input and policies before mutation", async () => {
    const defaults = fixture()
    expect((await defaults.handler.handle(request("", "", { title: "Created", prices: [] }))).status).toBe(200)
    expect(defaults.admission).toHaveBeenCalledWith(expect.arrayContaining(["id", "title", "variants.*", "variants.price_set.prices.*"]))
    for (const body of [{ title: "Missing prices" }, { title: "Invalid", prices: [], product_id: "other" }, { title: "Invalid", prices: [{ currency_code: "usd", amount: "500" }] }]) {
      const f = fixture()
      expect((await f.handler.handle(request("", "", body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
    }
    for (const options of [{ anonymous: true }, { deny: "product:read" }, { deny: "product_variant:create" }, { admissionError: true }]) {
      const f = fixture(options)
      expect((await f.handler.handle(request("", "", { title: "Created", prices: [] }))).status).toBe(options.anonymous ? 401 : options.admissionError ? 400 : 403)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
    const denied = fixture({ deny: "product_variant:read" })
    expect((await denied.handler.handle(request("/variant_managed"))).status).toBe(403)
    expect(denied.graph).not.toHaveBeenCalled()
  })

  it("does not replay variant creation failures or missing-parent errors", async () => {
    for (const options of [{ workflowError: true }, { missingParent: true }]) {
      const f = fixture(options)
      expect((await f.handler.handle(request("", "", { title: "Created", prices: [] }))).status).toBe(options.workflowError ? 400 : 500)
      expect(f.run).toHaveBeenCalledTimes(1)
      expect(f.graph).toHaveBeenCalledTimes(options.workflowError ? 0 : 1)
    }
  })
})
