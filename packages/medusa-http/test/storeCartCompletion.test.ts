import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createStoreCartHttpHandler } from "../src/store-cart"

function fixture(options: { failure?: MedusaError; unfinished?: boolean; missingCapability?: boolean; refuseFields?: boolean } = {}) {
  const order = { id: "order-native", total: 14.85, items: [{ id: "item-native", detail: { id: "detail-native" } }] }
  const cart = { id: "cart-native", total: 14.85 }
  const run = vi.fn(async () => ({ result: { id: order.id }, errors: options.failure ? [{ error: options.failure }] : [],
    transaction: { hasFinished: () => !options.unfinished } }))
  const remoteQuery = vi.fn(async () => [cart])
  const graph = vi.fn(async (query: { entity: string }) => query.entity === "api_key"
    ? { data: [{ id: "apk-native", token: "pk-native", revoked_at: null, sales_channels_link: [{ sales_channel_id: "sc-native" }] }] }
    : { data: [order] })
  const admitOrder = vi.fn(() => {
    if (options.refuseFields) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported Order fields")
  })
  const admitCart = vi.fn()
  const handler = createStoreCartHttpHandler({ storeCors: "https://store.test", admitCartRefetchFields: admitCart,
    ...(options.missingCapability ? {} : { admitOrderRefetchFields: admitOrder }),
    createRequestScope: () => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }),
      remoteQuery: asValue(remoteQuery), logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }) }),
  })
  const request = (fields = "id,total") => handler.handle(new Request("https://private.test/store/carts/cart-native/complete?fields=" + fields, {
    method: "POST", headers: { "x-publishable-api-key": "pk-native", origin: "https://store.test" },
  }))
  return { request, run, graph, remoteQuery, admitOrder, admitCart, order, cart }
}

describe("pinned native Store Cart completion HTTP", () => {
  it("admits both response paths before completing and refetches the settled Order", async () => {
    const f = fixture()
    const response = await f.request()
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ type: "order", order: f.order })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("complete-cart", { input: { id: "cart-native" }, throwOnError: false })
    expect(f.admitOrder).toHaveBeenCalledExactlyOnceWith(["id", "total"])
    expect(f.admitCart).toHaveBeenCalledOnce()
    expect(f.admitOrder.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.admitCart.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.graph).toHaveBeenLastCalledWith({ entity: "order", fields: ["id", "total"], filters: { id: f.order.id } })
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })

  it.each([MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR, MedusaError.Types.PAYMENT_REQUIRES_MORE_ERROR])(
    "returns the native Cart action envelope for %s", async type => {
      const failure = new MedusaError(type, "Payment action required")
      const f = fixture({ failure })
      const response = await f.request()
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toEqual({ type: "cart", cart: f.cart,
        error: { message: failure.message, name: failure.name, type } })
      expect(f.remoteQuery).toHaveBeenCalledOnce()
      expect(f.graph).toHaveBeenCalledOnce()
    },
  )

  it("refetches the Cart and preserves the native validation error status", async () => {
    const f = fixture({ failure: new MedusaError(MedusaError.Types.INVALID_DATA, "Cart is not valid") })
    const response = await f.request()
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: "Cart is not valid" })
    expect(f.remoteQuery).toHaveBeenCalledOnce()
  })

  it("preserves the native unfinished conflict before either response read", async () => {
    const f = fixture({ unfinished: true })
    const response = await f.request()
    expect(response.status).toBe(409)
    expect(f.remoteQuery).not.toHaveBeenCalled()
    expect(f.graph).toHaveBeenCalledOnce()
  })

  it.each([{ missingCapability: true }, { refuseFields: true }])("refuses an unadmitted completion before mutation: %j", async options => {
    const f = fixture(options)
    const response = await f.request("payments.secret")
    expect(response.status).toBe(400)
    expect(f.run).not.toHaveBeenCalled()
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })
})
