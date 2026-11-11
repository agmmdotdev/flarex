import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import type { AuthContext } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const principal: AuthContext = { actor_id: "user_inventory", actor_type: "user", auth_identity_id: "auth_inventory", app_metadata: {}, user_metadata: {} }
const variant = { id: "variant_inventory", product_id: "prod_inventory", manage_inventory: true, price_set: { prices: [{ id: "price_inventory", amount: "120", currency_code: "usd", created_at: "2026-01-01", updated_at: "2026-01-01" }] } }
const link = { product: { variant_id: variant.id }, inventory: { inventory_item_id: "inv_inventory" } }

function fixture(options: { anonymous?: boolean; deny?: string; admissionError?: boolean; workflowError?: boolean; missing?: boolean } = {}) {
  const graph = vi.fn(async (input: { entity: string }) => input.entity === "product_variant_inventory_items"
    ? { data: [{ variant_id: variant.id, required_quantity: 2, variant, inventory: { location_levels: [{ available_quantity: 7 }] } }] }
    : { data: structuredClone([variant]), metadata: { count: 19, skip: 2, take: 3 } })
  const remoteQuery = vi.fn(async () => options.missing ? [] : structuredClone([variant]))
  const run = vi.fn(async (id: string) => {
    if (options.workflowError) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Variant does not belong to Product")
    return { result: id.startsWith("batch-") ? { created: [link], updated: [], deleted: [link] } : [link] }
  })
  const admission = vi.fn(() => { if (options.admissionError) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported Variant response field") })
  const evaluate = vi.fn((_user, policies: { resource: string; operation: string | string[] }[]) => !policies.some(policy => policy.resource === options.deny))
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example", resolveAdminPrincipal: () => options.anonymous ? undefined : principal,
    evaluateAdminPolicies: evaluate, admitProductRefetchFields: () => undefined, admitCatalogRefetchFields: () => undefined,
    admitSalesChannelRefetchFields: () => undefined,
    admitPriceListRefetchFields: () => undefined,
    admitVariantRefetchFields: admission,
    createRequestScope: () => createContainer().register({ query: asValue({ graph }), remoteQuery: asValue(remoteQuery), workflows: asValue({ run }), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, graph, remoteQuery, run, admission, evaluate }
}

function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", query = "fields=id,*prices") {
  return new Request(`https://private.test/admin/${path}?${query}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const base = `products/${variant.product_id}/variants/${variant.id}/inventory-items`

describe("native Admin Variant inventory HTTP contracts", () => {
  it("lists global variants with native Product defaults, remapping and exact metadata", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("product-variants", undefined, "GET", "limit=3&offset=2&manage_inventory=true&order=-created_at"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ variants: [{ id: variant.id, prices: [{ amount: 120 }] }], count: 19, offset: 2, limit: 3 })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "variant", fields: expect.arrayContaining(["product.*", "price_set.prices.*"]), filters: { manage_inventory: true }, pagination: { skip: 2, take: 3, order: { created_at: "DESC" } }, withDeleted: undefined, context: undefined }, undefined)
    expect(f.evaluate).toHaveBeenCalledWith(principal, [{ resource: "product_variant", operation: "read" }])
    expect(f.run).not.toHaveBeenCalled()
  })

  it("computes global inventory_quantity only on explicit selection", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("product-variants", undefined, "GET", "fields=id,manage_inventory,inventory_quantity"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ variants: [{ inventory_quantity: 3 }] })
    expect(f.graph).toHaveBeenCalledTimes(2)
    expect(f.graph.mock.calls[0]?.[0]).toMatchObject({ fields: ["id", "manage_inventory"] })
  })

  it.each([
    ["create", base, { inventory_item_id: "inv_inventory", required_quantity: 2 }, "POST"],
    ["update", `${base}/inv_inventory`, { required_quantity: 3 }, "POST"],
    ["dismiss", `${base}/inv_inventory`, undefined, "DELETE"],
  ] as const)("passes URL ownership into %s and refetches native Variant afterward", async (operation, path, body, method) => {
    const f = fixture()
    const response = await f.handler.handle(request(path, body, method))
    expect(response.status, await response.clone().text()).toBe(200)
    const expected = operation === "dismiss" ? link : { ...link, data: { required_quantity: operation === "create" ? 2 : 3 } }
    expect(f.run).toHaveBeenCalledExactlyOnceWith(`${operation}-product-variant-inventory-links`, { input: { product_id: variant.product_id, links: [expected] } })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(["id", "price_set.prices.*"])
    expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { product_variant: { fields: ["id"], isServiceAccess: false, __args: { filters: { id: variant.id } }, price_set: { prices: { fields: ["*"] } } } } })
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.remoteQuery.mock.invocationCallOrder[0]!)
    expect(f.evaluate).toHaveBeenNthCalledWith(1, principal, [{ resource: "product", operation: "read" }])
    expect(f.evaluate).toHaveBeenNthCalledWith(2, principal, [{ resource: "product_variant", operation: "read" }])
    expect(f.evaluate).toHaveBeenNthCalledWith(3, principal, [{ resource: "inventory_item", operation: operation === "create" ? "create" : "read" }])
    expect(await response.json()).toMatchObject(operation === "dismiss" ? { id: link, object: "variant-inventory-item-link", deleted: true, parent: { id: variant.id } } : { variant: { id: variant.id, prices: [{ amount: 120 }] } })
  })

  it("batches native Link definitions, default arrays and raw result arrays without refetch", async () => {
    const f = fixture()
    const response = await f.handler.handle(request(`products/${variant.product_id}/variants/inventory-items/batch`, { create: [{ variant_id: variant.id, inventory_item_id: "inv_inventory", required_quantity: 2 }], delete: [{ variant_id: variant.id, inventory_item_id: "inv_inventory" }] }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("batch-product-variant-inventory-links", { input: { product_id: variant.product_id, create: [{ ...link, data: { required_quantity: 2 } }], update: [], delete: [link] } })
    expect(await response.json()).toEqual({ created: [link], updated: [], deleted: [link] })
    expect(f.remoteQuery).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
    expect(f.evaluate).toHaveBeenCalledWith(principal, [{ resource: "inventory_item", operation: ["create", "update", "delete"] }])
    const empty = fixture()
    expect((await empty.handler.handle(request(`products/${variant.product_id}/variants/inventory-items/batch`, {}))).status).toBe(200)
    expect(empty.run).toHaveBeenCalledWith("batch-product-variant-inventory-links", { input: { product_id: variant.product_id, create: [], update: [], delete: [] } })
  })

  it("refuses authentication, policies, malformed native inputs and projections before mutation", async () => {
    for (const options of [{ anonymous: true }, { deny: "product" }, { deny: "product_variant" }, { deny: "inventory_item" }, { admissionError: true }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request(base, { inventory_item_id: "inv_inventory", required_quantity: 2 }))
      expect(response.status).toBe(options.anonymous ? 401 : options.admissionError ? 400 : 403)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.remoteQuery).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
    for (const body of [{ inventory_item_id: "inv_inventory" }, { inventory_item_id: "inv_inventory", required_quantity: "2" }]) {
      const f = fixture()
      expect((await f.handler.handle(request(base, body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.admission).not.toHaveBeenCalled()
    }
    for (const body of [{ create: [{ variant_id: variant.id, inventory_item_id: "inv_inventory", required_quantity: 2, product_id: "foreign" }] }, { delete: ["inv_inventory"] }]) {
      const f = fixture()
      expect((await f.handler.handle(request(`products/${variant.product_id}/variants/inventory-items/batch`, body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
    }
  })

  it("retains native missing refetch shape and never retries ownership failures", async () => {
    const missing = fixture({ missing: true })
    expect(await (await missing.handler.handle(request(base, { inventory_item_id: "inv_inventory", required_quantity: 2 }))).json()).toEqual({})
    const failed = fixture({ workflowError: true })
    expect((await failed.handler.handle(request(base, { inventory_item_id: "inv_inventory", required_quantity: 2 }))).status).toBe(404)
    expect(failed.run).toHaveBeenCalledTimes(1)
    expect(failed.remoteQuery).not.toHaveBeenCalled()
  })

  it.each([[base, { inventory_item_id: "inv_inventory", required_quantity: 2 }, "POST"], [`${base}/inv_inventory`, { required_quantity: 2 }, "POST"], [`${base}/inv_inventory`, undefined, "DELETE"]] as const)("preclaims response fields before every single inventory mutation %s", async (path, body, method) => {
    const f = fixture({ admissionError: true })
    expect((await f.handler.handle(request(path, body, method))).status).toBe(400)
    expect(f.admission).toHaveBeenCalledTimes(1)
    expect(f.run).not.toHaveBeenCalled()
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })
})
