import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createStoreCartHttpHandler } from "../src/store-cart"

function fixture(options: { customer?: boolean; missingCapability?: boolean; refuseFields?: boolean; missingOrder?: boolean } = {}) {
  const order = { id: "order-native", payment_status: "authorized", fulfillment_status: "not_fulfilled" }
  const run = vi.fn(async (name: string) => {
    if (options.missingOrder) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Order not found")
    return { result: name === "get-order-detail" ? order : { rows: [order], metadata: { count: 7, skip: 1, take: 2 } } }
  })
  const graph = vi.fn(async () => ({ data: [{ id: "apk-native", token: "pk-native", revoked_at: null,
    sales_channels_link: [{ sales_channel_id: "sc-native" }] }] }))
  const admit = vi.fn(() => { if (options.refuseFields) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported Order projection") })
  const handler = createStoreCartHttpHandler({ storeCors: "https://store.test", admitCartRefetchFields() {},
    ...(options.missingCapability ? {} : { admitOrderReadFields: admit }),
    resolveCustomerPrincipal: () => options.customer ? { actor_id: "cus-verified", actor_type: "customer", auth_identity_id: "auth-native",
      app_metadata: {}, user_metadata: {} } : undefined,
    createRequestScope: () => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }),
      logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }) }),
  })
  const request = (path: string) => handler.handle(new Request("https://private.test" + path, {
    headers: { "x-publishable-api-key": "pk-native", "x-customer-id": "cus-forged", origin: "https://store.test" },
  }))
  return { request, run, graph, admit, order }
}

describe("native Store Order HTTP reads", () => {
  it("preserves native public detail and draft exclusion without trusting a Customer header", async () => {
    const f = fixture()
    const response = await f.request("/store/orders/order-native?fields=id")
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ order: f.order })
    expect(f.admit).toHaveBeenCalledWith(["id"], "detail")
    expect(f.admit.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.run).toHaveBeenCalledWith("get-order-detail", { input: { fields: ["id"], order_id: "order-native", filters: { is_draft_order: false } } })
  })
  it("requires a verified Customer for order history", async () => {
    const f = fixture()
    const response = await f.request("/store/orders")
    expect(response.status).toBe(401)
    expect(f.run).not.toHaveBeenCalled()
  })
  it("forwards native Customer filters, pagination and ordering, returning the actual total", async () => {
    const f = fixture({ customer: true })
    const response = await f.request("/store/orders?fields=id&limit=2&offset=1&order=-id&id=order-native&status=pending")
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ orders: [f.order], count: 7, offset: 1, limit: 2 })
    expect(f.run).toHaveBeenCalledWith("get-orders-list", { input: { fields: ["id"], variables: {
      filters: { id: "order-native", status: "pending", customer_id: "cus-verified", is_draft_order: false },
      skip: 1, take: 2, order: { id: "DESC" },
    } } })
  })
  it("retains the native default page of fifty", async () => {
    const f = fixture({ customer: true })
    expect((await f.request("/store/orders")).status).toBe(200)
    expect(f.run).toHaveBeenCalledWith("get-orders-list", { input: expect.objectContaining({ variables: {
      filters: { customer_id: "cus-verified", is_draft_order: false }, skip: 0, take: 50,
    } }) })
  })
  it("preserves native missing-detail status", async () => {
    const f = fixture({ missingOrder: true })
    expect((await f.request("/store/orders/missing")).status).toBe(404)
  })
  it.each([{ missingCapability: true }, { refuseFields: true }])("refuses an unsupported detail before workflow execution: %j", async options => {
    const f = fixture(options)
    expect((await f.request("/store/orders/order-native?fields=secret")).status).toBe(400)
    expect(f.run).not.toHaveBeenCalled()
  })
})
