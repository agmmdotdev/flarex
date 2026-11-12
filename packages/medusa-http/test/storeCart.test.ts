import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createStoreCartHttpHandler } from "../src/store-cart"

const customer = { actor_id: "cus_verified", actor_type: "customer", auth_identity_id: "auth_verified", app_metadata: {}, user_metadata: {} }
const cart = { id: "cart_native", currency_code: "usd", total: 12, items: [{ id: "item_native", quantity: 1 }] }
const headers = { "x-publishable-api-key": "pk_cart", origin: "https://store.example" }
function request(path = "", body?: unknown, extra: Record<string, string> = {}, method = body === undefined ? "GET" : "POST") {
  return new Request(`https://private.test/store/carts${path}`, { method,
    headers: { ...headers, ...extra, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
function fixture(options: { channels?: string[]; invalid?: boolean; revoked?: boolean; absent?: boolean; verified?: boolean; refuseFields?: boolean } = {}) {
  const channels = options.channels ?? ["sc_cart"]
  const graph = vi.fn(async () => ({ data: options.invalid ? [] : [{ id: "apk_cart", token: "pk_cart", revoked_at: options.revoked ? "2000-01-01" : null,
    sales_channels_link: channels.map(sales_channel_id => ({ sales_channel_id })) }] }))
  const remoteQuery = vi.fn(async (value: { __value?: { api_key?: unknown } }) => value.__value?.api_key !== undefined
    ? [{ sales_channels: channels.map(id => ({ id })) }] : options.absent ? [] : [cart])
  const run = vi.fn(async () => ({ result: { id: cart.id } }))
  const admit = vi.fn((_fields: readonly string[]) => { if (options.refuseFields) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported Cart projection") })
  const handler = createStoreCartHttpHandler({ storeCors: "https://store.example", admitCartRefetchFields: admit,
    resolveCustomerPrincipal: () => options.verified ? customer : undefined,
    createRequestScope: () => createContainer().register({ query: asValue({ graph }), remoteQuery: asValue(remoteQuery),
      workflows: asValue({ run }), logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }) }),
  })
  return { handler, graph, remoteQuery, run, admit }
}
afterEach(() => { FeatureFlag.setFlag("translation", false) })

describe("selected native Store Cart HTTP", () => {
  it("creates with the native key-selected channel, genuine workflow ABI and post-settlement callable refetch", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("?fields=id,total,items.quantity", { items: [{ variant_id: "variant_native", quantity: 1 }], additional_data: { trace: "create" } }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ cart })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("create-cart", { input: { items: [{ variant_id: "variant_native", quantity: 1 }],
      additional_data: { trace: "create" }, sales_channel_id: "sc_cart", customer_id: undefined } })
    expect(f.remoteQuery).toHaveBeenNthCalledWith(1, { __value: { api_key: { fields: [], sales_channels: { fields: ["id"] }, isServiceAccess: false,
      __args: { filters: { token: "pk_cart" } } } } })
    expect(f.remoteQuery).toHaveBeenNthCalledWith(2, { __value: { cart: { fields: ["id", "total"], items: { fields: ["quantity"] },
      isServiceAccess: false, __args: { filters: { id: cart.id } } } } })
    expect(f.admit).toHaveBeenCalledExactlyOnceWith(["id", "total", "items.quantity"])
    expect(f.admit.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
  })

  it("retains the complete native default fields and guest/verified customer distinction", async () => {
    for (const verified of [false, true]) {
      const f = fixture({ verified })
      const response = await f.handler.handle(request("", {}, { "x-customer-id": "cus_untrusted" }))
      expect(response.status, await response.clone().text()).toBe(200)
      expect(f.run).toHaveBeenCalledExactlyOnceWith("create-cart", { input: { sales_channel_id: "sc_cart", customer_id: verified ? customer.actor_id : undefined } })
      const fields = f.admit.mock.calls[0]?.[0]
      expect(fields).toEqual(expect.arrayContaining(["total", "items.product.categories.id", "customer.groups.id", "region.countries.*", "payment_collection.payment_sessions.*", "credit_lines.*"]))
      expect((fields?.length ?? 0)).toBeGreaterThan(100)
    }
  })

  it("returns the native request-error envelope without writes for mismatched and ambiguous channels", async () => {
    for (const [channels, body, error] of [
      [["sc_cart"], { sales_channel_id: "sc_foreign" }, "Sales channel ID in payload sc_foreign is not associated with the Publishable API Key in the header."],
      [["sc_cart", "sc_other"], {}, "Cannot assign sales channel to cart. The Publishable API Key in the header has multiple associated sales channels. Please provide a sales channel ID in the request body."],
    ] as const) {
      const f = fixture({ channels: [...channels] })
      const response = await f.handler.handle(request("", body))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ errors: [error], message: "Provided request body contains errors. Please check the data and retry the request" })
      expect(f.run).not.toHaveBeenCalled()
      expect(f.admit).not.toHaveBeenCalled()
      expect(f.remoteQuery).toHaveBeenCalledTimes(1)
    }
    for (const channels of [["sc_cart", "sc_other"], []]) {
      const f = fixture({ channels })
      expect((await f.handler.handle(request("", { sales_channel_id: "sc_other" }))).status).toBe(200)
      expect(f.run).toHaveBeenCalledExactlyOnceWith("create-cart", { input: { sales_channel_id: "sc_other", customer_id: undefined } })
    }
  })

  it("retrieves with callable Remote Query and only the native Store key gate, preserving missing Cart 404", async () => {
    const f = fixture({ channels: [] })
    const response = await f.handler.handle(request(`/${cart.id}?fields=id,total`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ cart })
    expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { cart: { fields: ["id", "total"], isServiceAccess: false, __args: { filters: { id: cart.id } } } } })
    expect(f.run).not.toHaveBeenCalled()
    const absent = await fixture({ absent: true }).handler.handle(request("/missing"))
    expect(absent.status).toBe(404)
    expect(await absent.json()).toMatchObject({ type: "not_found", message: "Cart with id 'missing' not found" })
  })

  it("rejects invalid/revoked/missing keys and malformed bodies before native creation", async () => {
    for (const options of [{ invalid: true }, { revoked: true }]) {
      const f = fixture(options)
      expect((await f.handler.handle(request("", {}))).status).toBe(400)
      expect(f.remoteQuery).not.toHaveBeenCalled()
      expect(f.run).not.toHaveBeenCalled()
    }
    const missing = fixture()
    expect((await missing.handler.handle(new Request("https://private.test/store/carts", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(400)
    expect(missing.graph).not.toHaveBeenCalled()
    for (const body of [{ customer_id: "cus_untrusted" }, { items: [{ variant_id: "v", quantity: 0 }] }, { email: "invalid" }, { shipping_address: { unknown: true } }]) {
      const f = fixture()
      expect((await f.handler.handle(request("", body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
    }
  })

  it("refuses unsupported response fields and enabled translation before creation", async () => {
    const f = fixture({ refuseFields: true })
    expect((await f.handler.handle(request("?fields=id,unsupported.path", {}))).status).toBe(400)
    expect(f.run).not.toHaveBeenCalled()
    FeatureFlag.setFlag("translation", true)
    const translated = fixture()
    expect((await translated.handler.handle(request("", {}))).status).toBe(400)
    expect(translated.run).not.toHaveBeenCalled()
  })

  it("updates the Cart through the exact native workflow ABI without adding creation-only channel or customer policy", async () => {
    const f = fixture({ verified: true, channels: ["sc_cart"] })
    const input = { email: "native@example.com", sales_channel_id: "sc_other", metadata: null,
      billing_address: { id: "addr_native", first_name: "Native" }, additional_data: { trace: "update" } }
    // The native AddressPayload.merge uses the right-hand object's strip policy.
    const response = await f.handler.handle(request(`/${cart.id}?fields=id,total`,
      { ...input, billing_address: { ...input.billing_address, unselected: true } }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ cart })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-cart", { input: { ...input, id: cart.id } })
    expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { cart: { fields: ["id", "total"], isServiceAccess: false,
      __args: { filters: { id: cart.id } } } } })
    expect(f.admit).toHaveBeenCalledExactlyOnceWith(["id", "total"])
    expect(f.admit.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.remoteQuery.mock.invocationCallOrder[0]!)
  })

  it("adds and updates line items with native metadata and quantity-zero semantics", async () => {
    const added = fixture()
    const addResponse = await added.handler.handle(request(`/${cart.id}/line-items?fields=id`,
      { variant_id: "variant_native", quantity: 1, metadata: null }))
    expect(addResponse.status, await addResponse.clone().text()).toBe(200)
    expect(await addResponse.json()).toEqual({ cart })
    expect(added.run).toHaveBeenCalledExactlyOnceWith("add-to-cart", { input: { cart_id: cart.id,
      items: [{ variant_id: "variant_native", quantity: 1, metadata: null }], additional_data: undefined } })
    const updated = fixture()
    const updateResponse = await updated.handler.handle(request(`/${cart.id}/line-items/item_native?fields=id`,
      { quantity: 0, metadata: null }))
    expect(updateResponse.status, await updateResponse.clone().text()).toBe(200)
    expect(updated.run).toHaveBeenCalledExactlyOnceWith("update-line-item-in-cart", { input: { cart_id: cart.id,
      item_id: "item_native", update: { quantity: 0, metadata: null }, additional_data: undefined } })
    for (const current of [added, updated]) {
      expect(current.admit).toHaveBeenCalledExactlyOnceWith(["id"])
      expect(current.admit.mock.invocationCallOrder[0]).toBeLessThan(current.run.mock.invocationCallOrder[0]!)
      expect(current.remoteQuery).toHaveBeenCalledTimes(1)
    }
  })

  it("deletes through the native ID-only workflow and preserves its parent response envelope", async () => {
    const f = fixture()
    const response = await f.handler.handle(request(`/${cart.id}/line-items/item_from_another_cart?fields=id`, undefined, {}, "DELETE"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ id: "item_from_another_cart", object: "line-item", deleted: true, parent: cart })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-line-items", { input: { cart_id: cart.id, ids: ["item_from_another_cart"] } })
    expect(f.admit).toHaveBeenCalledExactlyOnceWith(["id"])
    expect(f.admit.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
  })

  it("adds and removes promotion codes through the native workflow and independently refetches the Cart", async () => {
    for (const [method, promo_codes, action] of [
      ["POST", ["PROMO10", "PROMO10"], "add"],
      ["POST", [], "replace"],
      ["DELETE", ["PROMO10"], "remove"],
      ["DELETE", [], "remove"],
    ] as const) {
      const f = fixture({ verified: true })
      const response = await f.handler.handle(request(`/${cart.id}/promotions?fields=id,total`, { promo_codes }, {}, method))
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toEqual({ cart })
      expect(f.run).toHaveBeenCalledExactlyOnceWith("update-cart-promotions", { input: {
        cart_id: cart.id, promo_codes, action, force_refresh_payment_collection: true,
      } })
      expect(f.admit).toHaveBeenCalledExactlyOnceWith(["id", "total"])
      expect(f.admit.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
      expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.remoteQuery.mock.invocationCallOrder[0]!)
      expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { cart: { fields: ["id", "total"], isServiceAccess: false,
        __args: { filters: { id: cart.id } } } } })
      expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
    }
  })

  it("retains strict native promotion validation before response admission or execution", async () => {
    for (const method of ["POST", "DELETE"]) {
      for (const body of [{}, { promo_codes: null }, { promo_codes: "PROMO10" }, { promo_codes: [1] },
        { promo_codes: [], action: "replace" }, { promo_codes: [], additional_data: {} }]) {
        const f = fixture()
        expect((await f.handler.handle(request(`/${cart.id}/promotions`, body, {}, method))).status).toBe(400)
        expect(f.run).not.toHaveBeenCalled()
        expect(f.admit).not.toHaveBeenCalled()
        expect(f.remoteQuery).not.toHaveBeenCalled()
      }
    }
  })

  it("retains native promotion failure without performing the post-workflow refetch", async () => {
    const f = fixture()
    f.run.mockRejectedValueOnce(new MedusaError(MedusaError.Types.INVALID_DATA, "The promotion code UNKNOWN is invalid"))
    const response = await f.handler.handle(request(`/${cart.id}/promotions`, { promo_codes: ["UNKNOWN"] }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ type: "invalid_data", message: "The promotion code UNKNOWN is invalid" })
    expect(f.admit).toHaveBeenCalledTimes(1)
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })

  it("refuses unsupported projections before every newly selected native mutation", async () => {
    for (const [path, body, method] of [[`/${cart.id}`, {}, "POST"],
      [`/${cart.id}/line-items`, { variant_id: "variant_native", quantity: 1 }, "POST"],
      [`/${cart.id}/line-items/item_native`, { quantity: 0 }, "POST"],
      [`/${cart.id}/line-items/item_native`, undefined, "DELETE"],
      [`/${cart.id}/promotions`, { promo_codes: [] }, "POST"],
      [`/${cart.id}/promotions`, { promo_codes: ["PROMO10"] }, "DELETE"]] as const) {
      const f = fixture({ refuseFields: true })
      const response = await f.handler.handle(request(path + "?fields=id,unsupported.path", body, {}, method))
      expect(response.status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.remoteQuery).not.toHaveBeenCalled()
      expect(f.admit).toHaveBeenCalledExactlyOnceWith(["id", "unsupported.path"])
    }
  })

  it("retains native mutation validation and the publishable-key gate", async () => {
    for (const [path, body] of [[`/${cart.id}`, { customer_id: "cus_untrusted" }],
      [`/${cart.id}`, { currency_code: "eur" }],
      [`/${cart.id}/line-items`, { variant_id: "v", quantity: 0 }],
      [`/${cart.id}/line-items`, { variant_id: "v", quantity: 1, additional_data: { unselected: true } }],
      [`/${cart.id}/line-items/item_native`, { quantity: -1 }], [`/${cart.id}/line-items/item_native`, {}]] as const) {
      const f = fixture()
      expect((await f.handler.handle(request(path, body))).status, `${path} ${JSON.stringify(body)}`).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.admit).not.toHaveBeenCalled()
    }
    for (const [path, body, method] of [[`/${cart.id}`, {}, "POST"],
      [`/${cart.id}/line-items`, { variant_id: "v", quantity: 1 }, "POST"],
      [`/${cart.id}/line-items/item_native`, { quantity: 0 }, "POST"],
      [`/${cart.id}/line-items/item_native`, undefined, "DELETE"],
      [`/${cart.id}/promotions`, { promo_codes: [] }, "POST"],
      [`/${cart.id}/promotions`, { promo_codes: ["PROMO10"] }, "DELETE"]] as const) {
      const f = fixture({ revoked: true })
      expect((await f.handler.handle(request(path, body, {}, method))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.admit).not.toHaveBeenCalled()
    }
  })

  it("handles native Store preflight and leaves other Cart methods unselected", async () => {
    const f = fixture()
    const preflight = await f.handler.handle(new Request("https://private.test/store/carts", { method: "OPTIONS", headers: { origin: "https://store.example", "access-control-request-method": "POST" } }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST")
    const deletePreflight = await f.handler.handle(new Request(`https://private.test/store/carts/${cart.id}/line-items/item_native`,
      { method: "OPTIONS", headers: { origin: "https://store.example", "access-control-request-method": "DELETE" } }))
    expect(deletePreflight.status).toBe(204)
    expect(deletePreflight.headers.get("access-control-allow-methods")).toContain("DELETE")
    expect((await f.handler.handle(request())).status).toBe(404)
    expect((await f.handler.handle(request("/cart_native", {}, {}, "PATCH"))).status).toBe(404)
    expect((await f.handler.handle(request("/cart_native/taxes", {}))).status).toBe(404)
    expect((await f.handler.handle(request("/cart_native/customer", {}))).status).toBe(404)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
  })
})
