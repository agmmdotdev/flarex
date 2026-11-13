import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import type { AuthContext } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createStoreCartHttpHandler } from "../src/store-cart"

const collection = { id: "paycol_native", currency_code: "usd", amount: 14.85,
  payment_sessions: [{ id: "payses_native", provider_id: "pp_system_default", data: { native: true } }] }
const defaults = ["id", "currency_code", "amount", "payment_sessions.*"]
function fixture(input: { existing?: boolean; missingAfterCreate?: boolean; missingRefetch?: boolean; missingCapability?: boolean;
  refuseFields?: boolean; revoked?: boolean; principal?: AuthContext; engineError?: Error; refetchError?: Error } = {}) {
  let created = false
  const run = vi.fn(async (_id: string, _options: { input: unknown }) => {
    if (input.engineError) throw input.engineError
    created = true
    return { result: { id: collection.id } }
  })
  const remoteQuery = vi.fn(async (_query: unknown) => input.existing || created && !input.missingAfterCreate
    ? [{ payment_collection: collection }] : [])
  const graph = vi.fn(async (query: { entity: string }, _options?: unknown) => {
    if (query.entity === "api_key") return { data: [{ id: "apk_payment", token: "pk_payment", revoked_at: input.revoked ? "2020-01-01" : null,
      sales_channels_link: [{ sales_channel_id: "sc_payment" }] }] }
    if (input.refetchError) throw input.refetchError
    return { data: input.missingRefetch ? [] : [collection] }
  })
  const admit = vi.fn((_fields: readonly string[]) => {
    if (input.refuseFields) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported Payment Collection fields")
  })
  const handler = createStoreCartHttpHandler({ storeCors: "https://store.test", admitCartRefetchFields() {},
    ...(input.missingCapability ? {} : { admitPaymentCollectionFields: admit }),
    resolveCustomerPrincipal: () => input.principal,
    createRequestScope: () => createContainer().register({ query: asValue({ graph }), workflows: asValue({ run }), remoteQuery: asValue(remoteQuery),
      logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }) }),
  })
  const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => handler.handle(new Request(`https://private.test/store${path}`, {
    method, headers: { "x-publishable-api-key": "pk_payment", origin: "https://store.test", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return { run, remoteQuery, graph, admit, request }
}

describe("native Store Payment Collection HTTP", () => {
  it("returns an existing collection through the native Link query without executing a workflow", async () => {
    const f = fixture({ existing: true })
    const response = await f.request("/payment-collections", { cart_id: "cart_completed" })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ payment_collection: collection })
    expect(f.run).not.toHaveBeenCalled()
    expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { cart_payment_collection: { fields: [], isServiceAccess: false,
      __args: { filters: { cart_id: "cart_completed" } }, payment_collection: { fields: ["id", "currency_code", "amount"],
        payment_sessions: { fields: ["*"] } } } } })
    expect(f.admit).toHaveBeenCalledExactlyOnceWith(defaults)
    expect(f.admit.mock.invocationCallOrder[0]).toBeLessThan(f.remoteQuery.mock.invocationCallOrder[0]!)
    expect(f.graph).toHaveBeenCalledTimes(1)
  })

  it("creates only after an empty native prequery and refetches the same selected Link projection after settlement", async () => {
    const f = fixture()
    const response = await f.request("/payment-collections?fields=id,amount", { cart_id: "cart_new" })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ payment_collection: collection })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("create-payment-collection-for-cart", { input: { cart_id: "cart_new" } })
    expect(f.remoteQuery).toHaveBeenCalledTimes(2)
    expect(f.remoteQuery.mock.calls[0]).toEqual(f.remoteQuery.mock.calls[1])
    expect(f.remoteQuery).toHaveBeenCalledWith({ __value: { cart_payment_collection: { fields: [], isServiceAccess: false,
      __args: { filters: { cart_id: "cart_new" } }, payment_collection: { fields: ["id", "amount"] } } } })
    expect(f.admit).toHaveBeenCalledExactlyOnceWith(["id", "amount"])
    expect(f.remoteQuery.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.remoteQuery.mock.invocationCallOrder[1]!)
  })

  it("preserves native empty refetch serialization instead of adding a missing-collection response", async () => {
    const f = fixture({ missingAfterCreate: true })
    const response = await f.request("/payment-collections", { cart_id: "cart_new" })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({})
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.remoteQuery).toHaveBeenCalledTimes(2)
    const session = fixture({ missingRefetch: true })
    const refetched = await session.request("/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default" })
    expect(refetched.status, await refetched.clone().text()).toBe(200)
    expect(await refetched.json()).toEqual({})
  })

  it("executes the genuine Session workflow ID then independently refetches the native Payment fields", async () => {
    const f = fixture()
    const data = { native: true, nullable: null, customer_id: "provider-data-only" }
    const response = await f.request("/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default", data })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ payment_collection: collection })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("create-payment-sessions", { input: {
      payment_collection_id: "paycol_native", provider_id: "pp_system_default", customer_id: undefined, data,
    } })
    expect(f.admit).toHaveBeenCalledExactlyOnceWith(defaults)
    expect(f.admit.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!)
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.graph.mock.invocationCallOrder[1]!)
    expect(f.graph).toHaveBeenLastCalledWith({ entity: "payment_collection", fields: defaults, filters: { id: "paycol_native" },
      pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })

  it("binds only a verified Customer actor and preserves omitted native provider data", async () => {
    const f = fixture({ principal: { actor_id: "cus_verified", actor_type: "customer", auth_identity_id: "auth_verified", app_metadata: {}, user_metadata: {} } })
    const response = await f.request("/payment-collections/paycol_native/payment-sessions?fields=id", { provider_id: "pp_system_default" })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("create-payment-sessions", { input: {
      payment_collection_id: "paycol_native", provider_id: "pp_system_default", customer_id: "cus_verified", data: undefined,
    } })
    expect(f.graph).toHaveBeenLastCalledWith({ entity: "payment_collection", fields: ["id"], filters: { id: "paycol_native" },
      pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    const other = fixture({ principal: { actor_id: "user_verified", actor_type: "user", auth_identity_id: "auth_user", app_metadata: {}, user_metadata: {} } })
    expect((await other.request("/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default" })).status).toBe(200)
    expect(other.run).toHaveBeenCalledWith("create-payment-sessions", { input: {
      payment_collection_id: "paycol_native", provider_id: "pp_system_default", customer_id: undefined, data: undefined,
    } })
  })

  it("refuses strict native bodies, revoked keys and unsupported or unavailable fields before Payment reads or mutation", async () => {
    for (const [path, body] of [["/payment-collections", {}], ["/payment-collections", { cart_id: 1 }],
      ["/payment-collections", { cart_id: "cart_new", metadata: {} }],
      ["/payment-collections/paycol_native/payment-sessions", {}],
      ["/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default", data: null }],
      ["/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default", customer_id: "cus_body" }],
      ["/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default", context: {} }],
      ["/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default", additional_data: {} }]] as const) {
      const f = fixture()
      expect((await f.request(path, body)).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.remoteQuery).not.toHaveBeenCalled()
      expect(f.graph).toHaveBeenCalledTimes(1)
    }
    for (const input of [{ missingCapability: true }, { refuseFields: true }, { revoked: true }]) {
      for (const [path, body] of [["/payment-collections?fields=unknown", { cart_id: "cart_completed" }],
        ["/payment-collections/paycol_native/payment-sessions?fields=unknown", { provider_id: "pp_system_default" }]] as const) {
        const f = fixture({ ...input, existing: true })
        expect((await f.request(path, body)).status).toBe(400)
        expect(f.run).not.toHaveBeenCalled()
        expect(f.remoteQuery).not.toHaveBeenCalled()
        expect(f.graph).toHaveBeenCalledTimes(1)
      }
    }
  })

  it("propagates native workflow and post-workflow refetch failures without a new retry or rollback path", async () => {
    const missing = fixture({ engineError: new TypeError("Native missing Payment Collection") })
    expect((await missing.request("/payment-collections/missing/payment-sessions", { provider_id: "pp_system_default" })).status).toBe(500)
    expect(missing.run).toHaveBeenCalledTimes(1)
    expect(missing.graph).toHaveBeenCalledTimes(1)
    const refetch = fixture({ refetchError: new MedusaError(MedusaError.Types.INVALID_DATA, "Private response cohort exceeded") })
    expect((await refetch.request("/payment-collections/paycol_native/payment-sessions", { provider_id: "pp_system_default" })).status).toBe(400)
    expect(refetch.run).toHaveBeenCalledTimes(1)
    expect(refetch.graph).toHaveBeenCalledTimes(2)
    expect(refetch.run.mock.invocationCallOrder[0]).toBeLessThan(refetch.graph.mock.invocationCallOrder[1]!)
  })

  it("keeps unselected Payment methods and routes outside the manifest", async () => {
    const f = fixture()
    for (const [path, method] of [["/payment-collections", "GET"], ["/payment-collections/paycol_native", "GET"],
      ["/payment-collections/paycol_native/payment-sessions", "GET"], ["/payment-collections/paycol_native/payment-sessions", "DELETE"],
      ["/payment-collections/paycol_native/complete", "POST"]]) {
      expect((await f.request(path, undefined, method)).status).toBe(404)
    }
    expect(f.run).not.toHaveBeenCalled()
    expect(f.graph).not.toHaveBeenCalled()
  })
})
