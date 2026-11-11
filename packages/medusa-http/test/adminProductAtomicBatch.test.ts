import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import type { AuthContext } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const principal: AuthContext = { actor_id: "user_batch", actor_type: "user", auth_identity_id: "auth_batch", app_metadata: {}, user_metadata: {} }
const timestamp = "2026-11-10T00:00:00.000Z"
const variant = { id: "variant_created", product_id: "prod_parent", title: "Variant", price_set: { prices: [{ id: "price_base", amount: "100", currency_code: "usd", created_at: timestamp, updated_at: timestamp }] } }
type RemoteInput = { __value: Record<string, { fields: string[]; __args?: { filters?: { id?: string | string[] } } }> }

function fixture(options: { anonymous?: boolean; deny?: string; allowedProductOperations?: readonly string[]; admissionError?: string; runError?: boolean; refetchError?: boolean; empty?: boolean; missingPriceList?: boolean } = {}) {
  const events: string[] = []
  const remoteQuery = vi.fn(async (query: RemoteInput) => {
    const entry = Object.keys(query.__value)[0]!
    events.push(`read:${entry}`)
    if (options.refetchError) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Refetch failed")
    if (entry === "sales_channel") return [{ id: "sc_native", name: "Channel", products: [{ id: "prod_added" }] }]
    if (entry === "variants") return [{ price_set: { id: "ps_target" } }, {}, { price_set: { id: "ps_other" } }]
    if (entry === "prices") return [{ id: "price_removed" }, { id: "price_removed_other" }]
    if (entry === "price_lists") return options.missingPriceList ? [] : [{ id: "pl_native", title: "Sale", price_list_rules: [{ attribute: "region_id", value: ["region_native"] }], prices: [{ id: "price_list_remaining", amount: "75", price_rules: [{ attribute: "customer_group_id", value: "cg_native" }], price_set: { id: "ps_remaining", variant: { id: "variant_remaining" } } }] }]
    const ids = query.__value[entry]?.__args?.filters?.id
    return (Array.isArray(ids) ? ids : [ids]).map(id => entry === "variant" ? { ...structuredClone(variant), id } : { id, title: "Product", variants: [structuredClone(variant)] })
  })
  const run = vi.fn(async (id: string) => {
    events.push(`run:${id}`)
    if (options.runError) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Native atomic root refused")
    if (id === "batch-products" || id === "batch-product-variants") {
      const entity = id === "batch-products" ? "prod" : "variant"
      return { result: options.empty ? { created: [], updated: [], deleted: [] } : { created: [{ id: `${entity}_created` }], updated: [{ id: `${entity}_updated` }], deleted: [`${entity}_deleted`] } }
    }
    return { result: undefined }
  })
  const admissions = Object.fromEntries(["product", "variant", "sales_channel", "price_list"].map(entity => [entity, vi.fn((_fields: readonly string[]) => {
    events.push(`admit:${entity}`)
    if (options.admissionError === entity) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported response projection")
  })]))
  const evaluate = vi.fn((_user, policies: { resource: string; operation: string | readonly string[] }[]) => !policies.some(policy => {
    if (policy.resource === options.deny) return true
    const operations = typeof policy.operation === "string" ? [policy.operation] : policy.operation
    const allowed = options.allowedProductOperations
    return policy.resource === "product" && allowed !== undefined && operations.some(operation => !allowed.includes(operation))
  }))
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example", resolveAdminPrincipal: () => options.anonymous ? undefined : principal,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admissions.product!, admitVariantRefetchFields: admissions.variant!,
    admitSalesChannelRefetchFields: admissions.sales_channel!, admitPriceListRefetchFields: admissions.price_list!,
    admitCatalogRefetchFields: () => undefined,
    createRequestScope: () => createContainer().register({ workflows: asValue({ run }), remoteQuery: asValue(remoteQuery), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, run, remoteQuery, admissions, evaluate, events }
}

function request(path: string, body: unknown, query = "") {
  return new Request(`https://private.test/admin/${path}${query ? `?${query}` : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

describe("native Admin atomic Product batches and associations", () => {
  it("runs one mixed Product root, then independently refetches native branches and deletion envelope", async () => {
    const f = fixture()
    const body = { create: [{ title: "Created" }], update: [{ id: "prod_updated", title: "Updated" }], delete: ["prod_deleted"] }
    const response = await f.handler.handle(request("products/batch", body, "fields=id,*variants.prices"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("batch-products", { input: { ...body, create: [{ title: "Created", is_giftcard: false, discountable: true, status: "draft" }] } })
    expect(await response.json()).toMatchObject({ created: [{ id: "prod_created", variants: [{ prices: [{ amount: 100 }] }] }], updated: [{ id: "prod_updated" }], deleted: { ids: ["prod_deleted"], object: "product", deleted: true } })
    expect(f.remoteQuery).toHaveBeenCalledTimes(2)
    expect(f.remoteQuery.mock.calls[0]?.[0]).toMatchObject({ __value: { product: { __args: { filters: { id: ["prod_created"] } }, fields: ["id"], variants: { price_set: { prices: { fields: ["*"] } } } } } })
    expect(f.admissions.product).toHaveBeenCalledExactlyOnceWith(["id", "variants.price_set.prices.*"])
    expect(f.events[0]).toBe("admit:product")
    expect(f.events[1]).toBe("run:batch-products")
    expect(f.evaluate.mock.calls.map(call => call[1])).toEqual([[{ resource: "product", operation: "read" }], [{ resource: "product", operation: ["create", "update", "delete"] }], [{ resource: "product", operation: ["create", "update", "delete"] }]])
  })

  it.each([{ delete: ["prod_deleted"] }, { create: [{ title: "Created" }] }, { update: [{ id: "prod_updated", title: "Updated" }] }, {}])("requires Product delete permission before batch validation or access for %o", async body => {
    const f = fixture({ allowedProductOperations: ["read", "create", "update"] })
    const response = await f.handler.handle(request("products/batch", body))
    expect(response.status, await response.clone().text()).toBe(403)
    expect(f.evaluate).toHaveBeenNthCalledWith(1, principal, [{ resource: "product", operation: "read" }])
    expect(f.evaluate).toHaveBeenNthCalledWith(2, principal, [{ resource: "product", operation: ["create", "update", "delete"] }])
    expect(f.run).not.toHaveBeenCalled()
    expect(f.remoteQuery).not.toHaveBeenCalled()
    expect(f.admissions.product).not.toHaveBeenCalled()
    expect(f.events).toEqual([])
  })

  it("keeps native Variant normalization and adds the URL parent to the atomic root", async () => {
    const f = fixture()
    const body = { create: [{ title: "Created", prices: [] }], update: [{ id: "variant_updated", title: "Updated" }], delete: ["variant_deleted"] }
    const response = await f.handler.handle(request("products/prod_parent/variants/batch", body, "fields=id,*prices"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("batch-product-variants", { input: { product_id: "prod_parent", create: [{ title: "Created", prices: [], allow_backorder: false, manage_inventory: true, product_id: "prod_parent" }], update: [{ id: "variant_updated", title: "Updated", product_id: "prod_parent" }], delete: ["variant_deleted"] } })
    expect(await response.json()).toMatchObject({ created: [{ id: "variant_created", prices: [{ amount: 100 }] }], updated: [{ id: "variant_updated" }], deleted: { ids: ["variant_deleted"], object: "variant", deleted: true } })
    expect(f.admissions.variant).toHaveBeenCalledExactlyOnceWith(["id", "price_set.prices.*"])
    expect(f.events.slice(0, 2)).toEqual(["admit:variant", "run:batch-product-variants"])
    expect(f.evaluate.mock.calls.map(call => call[1])).toEqual([[{ resource: "product", operation: "read" }], [{ resource: "product_variant", operation: "read" }], [{ resource: "product_variant", operation: ["create", "update", "delete"] }], [{ resource: "product_variant", operation: ["create", "update", "delete"] }]])
  })

  it.each(["products/batch", "products/prod_parent/variants/batch"])("retains native empty optional arms and skips both empty refetches for %s", async path => {
    const f = fixture({ empty: true })
    const response = await f.handler.handle(request(path, {}))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ created: [], updated: [], deleted: { ids: [], object: path === "products/batch" ? "product" : "variant", deleted: true } })
    expect(f.remoteQuery).not.toHaveBeenCalled()
    expect(f.run).toHaveBeenCalledExactlyOnceWith(path === "products/batch" ? "batch-products" : "batch-product-variants", { input: path === "products/batch" ? {} : { product_id: "prod_parent", create: undefined, update: undefined, delete: undefined } })
    expect(f.admissions[path === "products/batch" ? "product" : "variant"]).toHaveBeenCalledTimes(1)
  })

  it("passes exact Sales membership input and returns native default refetch", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("sales-channels/sc_native/products", { add: ["prod_added"], remove: ["prod_removed"] }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ sales_channel: { id: "sc_native", name: "Channel", products: [{ id: "prod_added" }] } })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("link-products-to-sales-channel", { input: { id: "sc_native", add: ["prod_added"], remove: ["prod_removed"] } })
    expect(f.admissions.sales_channel).toHaveBeenCalledExactlyOnceWith(["id", "name", "description", "is_disabled", "created_at", "updated_at", "deleted_at", "metadata"])
    expect(f.evaluate.mock.calls.map(call => call[1])).toEqual([[{ resource: "sales_channel", operation: "read" }], [{ resource: "sales_channel", operation: "update" }], [{ resource: "sales_channel", operation: "update" }]])
    expect(f.events).toEqual(["admit:sales_channel", "run:link-products-to-sales-channel", "read:sales_channel"])
  })

  it("selects Product price sets and only URL PriceList prices before one native price batch", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("price-lists/pl_native/products", { remove: ["prod_target", "prod_other"] }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.remoteQuery.mock.calls[0]?.[0]).toEqual({ __value: { variants: { fields: [], isServiceAccess: false, __args: { filters: { product_id: ["prod_target", "prod_other"] } }, price_set: { fields: ["id"] } } } })
    expect(f.remoteQuery.mock.calls[1]?.[0]).toEqual({ __value: { prices: { fields: ["id"], isServiceAccess: false, __args: { filters: { price_set_id: ["ps_target", "ps_other"], price_list_id: "pl_native" } } } } })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("batch-price-list-prices", { input: { data: { id: "pl_native", create: [], update: [], delete: ["price_removed", "price_removed_other"] } } })
    expect(await response.json()).toEqual({ price_list: { id: "pl_native", title: "Sale", rules: { region_id: ["region_native"] }, prices: [{ id: "price_list_remaining", amount: "75", variant_id: "variant_remaining", rules: { customer_group_id: "cg_native" } }] } })
    expect(f.admissions.price_list).toHaveBeenCalledExactlyOnceWith(["id", "type", "description", "title", "status", "starts_at", "ends_at", "created_at", "updated_at", "deleted_at", "price_list_rules.value", "price_list_rules.attribute"])
    expect(f.evaluate.mock.calls.map(call => call[1])).toEqual([[{ resource: "price_list", operation: "read" }], [{ resource: "price_list", operation: "update" }], [{ resource: "price_list", operation: "update" }]])
    expect(f.events).toEqual(["admit:price_list", "read:variants", "read:prices", "run:batch-price-list-prices", "read:price_lists"])
  })

  it("retains PriceList empty-remove refusal and missing final list errors", async () => {
    for (const body of [{}, { remove: [] }]) {
      const f = fixture()
      const response = await f.handler.handle(request("price-lists/pl_native/products", body))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ message: "No product ids passed to remove from price list" })
      expect(f.run).not.toHaveBeenCalled()
      expect(f.remoteQuery).not.toHaveBeenCalled()
    }
    const missing = fixture({ missingPriceList: true })
    const response = await missing.handler.handle(request("price-lists/pl_native/products", { remove: ["prod_target"] }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ message: "Price list with id: pl_native was not found" })
    expect(missing.run).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["products/batch", {}, "product"], ["products/prod_parent/variants/batch", {}, "variant"],
    ["sales-channels/sc_native/products", { add: ["prod_added"] }, "sales_channel"], ["price-lists/pl_native/products", { remove: ["prod_target"] }, "price_list"],
  ] as const)("refuses authentication, policies and projection before any native access for %s", async (path, body, entity) => {
    for (const options of [{ anonymous: true }, { deny: entity === "variant" ? "product_variant" : entity }, { admissionError: entity }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request(path, body))
      expect(response.status).toBe(options.anonymous ? 401 : options.admissionError ? 400 : 403)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.remoteQuery).not.toHaveBeenCalled()
    }
  })

  it.each([
    ["products/batch", { update: [{ title: "Missing id" }] }], ["products/prod_parent/variants/batch", { create: [{ title: "Missing prices" }] }],
    ["sales-channels/sc_native/products", { add: [2] }], ["price-lists/pl_native/products", { remove: "prod_target" }],
  ])("retains native malformed-body refusal for %s", async (path, body) => {
    const f = fixture()
    expect((await f.handler.handle(request(path as string, body))).status).toBe(400)
    expect(f.run).not.toHaveBeenCalled()
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })

  it("retains the Fetch 1MiB hard ceiling despite native 2mb batch metadata", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("products/batch", { create: [{ title: "x".repeat(1_048_576) }] }))
    expect(response.status).toBe(413)
    expect(f.run).not.toHaveBeenCalled()
  })

  it("never retries a batch root or later refetch failure", async () => {
    for (const options of [{ runError: true }, { refetchError: true }]) {
      const f = fixture(options)
      expect((await f.handler.handle(request("products/batch", { delete: ["prod_deleted"] }))).status).toBe(options.runError ? 400 : 404)
      expect(f.run).toHaveBeenCalledTimes(1)
    }
  })
})
