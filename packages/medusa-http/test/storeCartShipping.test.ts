import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createStoreCartHttpHandler } from "../src/store-cart"

const cart = { id: "cart_shipping", total: 15, shipping_methods: [{ id: "sm_native", shipping_option_id: "so_standard", amount: 5 }] }
const options = [{ id: "so_standard", name: "Standard", amount: 5, calculated_price: { calculated_amount: 5 } },
  { id: "so_express", name: "Express", amount: 8, calculated_price: { calculated_amount: 8 } }]
function fixture(input: { revoked?: boolean; missingShippingCapability?: boolean; refuseShippingFields?: boolean; refuseCartFields?: boolean } = {}) {
  const graph = vi.fn(async () => ({ data: [{ id: "apk", token: "pk_shipping", revoked_at: input.revoked ? "2020-01-01" : null,
    sales_channels_link: [{ sales_channel_id: "sc_shipping" }] }] }))
  const run = vi.fn(async () => ({ result: options }))
  const remoteQuery = vi.fn(async () => [cart])
  const admitCart = vi.fn((_fields: readonly string[]) => { if (input.refuseCartFields) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported Cart fields") })
  const admitShipping = vi.fn((_fields: readonly string[]) => { if (input.refuseShippingFields) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported Shipping fields") })
  const handler = createStoreCartHttpHandler({ storeCors: "https://store.test", admitCartRefetchFields: admitCart,
    ...(input.missingShippingCapability ? {} : { admitShippingOptionFields: admitShipping }),
    createRequestScope: () => createContainer().register({ query: asValue({ graph }), workflows: asValue({ run }), remoteQuery: asValue(remoteQuery),
      logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }) }),
  })
  const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => handler.handle(new Request(`https://private.test/store${path}`, {
    method, headers: { "x-publishable-api-key": "pk_shipping", origin: "https://store.test", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return { graph, run, remoteQuery, admitCart, admitShipping, request }
}

describe("native Store Cart Shipping HTTP", () => {
  it("uses unpriced native listing and preserves mandatory results despite selected fields and pagination", async () => {
    const f = fixture()
    const response = await f.request("/shipping-options?cart_id=cart_shipping&is_return=TrUe&fields=id&limit=1&offset=9&order=name")
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ shipping_options: options })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("list-shipping-options-for-cart", { input: { cart_id: "cart_shipping", is_return: true, fields: ["id"] } })
    expect(f.admitShipping).toHaveBeenCalledExactlyOnceWith(["id"])
    expect(f.admitShipping.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.admitCart).not.toHaveBeenCalled()
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })

  it("retains empty native list defaults and ignores native logical filter arguments in handler dispatch", async () => {
    const f = fixture()
    const response = await f.request("/shipping-options?cart_id=cart_shipping&$or[0][cart_id]=other&limit=0")
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ shipping_options: options })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("list-shipping-options-for-cart", { input: { cart_id: "cart_shipping", is_return: false, fields: [] } })
  })

  it("adds the native method and refetches only after workflow settlement", async () => {
    const f = fixture()
    const response = await f.request("/carts/cart_shipping/shipping-methods?fields=id,total", { option_id: "so_standard", data: { delivery: "door" } })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ cart })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("add-shipping-method-to-cart", { input: { options: [{ id: "so_standard", data: { delivery: "door" } }],
      cart_id: "cart_shipping", additional_data: undefined } })
    expect(f.admitCart).toHaveBeenCalledExactlyOnceWith(["id", "total"])
    expect(f.admitCart.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.remoteQuery.mock.invocationCallOrder[0]!)
    expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { cart: { fields: ["id", "total"], isServiceAccess: false,
      __args: { filters: { id: "cart_shipping" } } } } })
    expect(f.admitShipping).not.toHaveBeenCalled()
  })

  it("preserves the native strict Shipping body and optional data value", async () => {
    const f = fixture()
    expect((await f.request("/carts/cart_shipping/shipping-methods?fields=id", { option_id: "so_standard" })).status).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("add-shipping-method-to-cart", { input: { options: [{ id: "so_standard", data: undefined }], cart_id: "cart_shipping", additional_data: undefined } })
    for (const body of [{}, { option_id: "so_standard", data: null }, { option_id: "so_standard", unknown: true },
      { option_id: "so_standard", additional_data: { trace: "native-validator-rejects" } }]) {
      const rejected = fixture()
      expect((await rejected.request("/carts/cart_shipping/shipping-methods", body)).status).toBe(400)
      expect(rejected.run).not.toHaveBeenCalled()
      expect(rejected.remoteQuery).not.toHaveBeenCalled()
    }
  })

  it("refuses malformed queries, revoked keys and missing or unsupported projections before workflow dispatch", async () => {
    for (const path of ["/shipping-options", "/shipping-options?cart_id=c&is_return=invalid", "/shipping-options?cart_id=c&unknown=true"]) {
      const f = fixture()
      expect((await f.request(path)).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
    }
    for (const input of [{ revoked: true }, { missingShippingCapability: true }, { refuseShippingFields: true }]) {
      const f = fixture(input)
      expect((await f.request("/shipping-options?cart_id=cart_shipping")).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
    }
    const f = fixture({ refuseCartFields: true })
    expect((await f.request("/carts/cart_shipping/shipping-methods?fields=id", { option_id: "so_standard" })).status).toBe(400)
    expect(f.run).not.toHaveBeenCalled()
  })

  it("keeps provider calculation and other Shipping methods unselected", async () => {
    const f = fixture()
    expect((await f.request("/shipping-options/so_standard/calculate", { cart_id: "cart_shipping" })).status).toBe(404)
    expect((await f.request("/carts/cart_shipping/shipping-methods")).status).toBe(404)
    expect((await f.request("/carts/cart_shipping/shipping-methods", undefined, "DELETE")).status).toBe(404)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
  })
})
