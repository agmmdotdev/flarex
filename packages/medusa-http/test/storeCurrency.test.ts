import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { getMedusaRequestPublishableKeyContext, type MedusaRequest } from "@medusajs/framework/http"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import { describe, expect, it, vi } from "vitest"
import { createStoreCurrencyHttpHandler } from "../src/index"

const currency = { code: "usd", name: "US Dollar", symbol: "$", symbol_native: "$", decimal_digits: 2, rounding: 0 }
const key = { id: "key_1", token: "pk_test", revoked_at: null as string | null,
  sales_channels_link: [{ sales_channel_id: "sc_test" }] }
const customer = { actor_id: "cus_test", actor_type: "customer", auth_identity_id: "auth_test", app_metadata: {}, user_metadata: {} }

function fixture(options: { key?: typeof key; retrieve?: boolean; empty?: boolean; fail?: boolean; session?: MedusaRequest["session"]; storeCors?: string } = {}) {
  const remoteQuery = vi.fn(async () => {
    if (options.fail) throw new Error("database unavailable")
    if (options.retrieve) return options.empty ? [] : [currency]
    return { rows: [currency], metadata: { count: 1, skip: 2, take: 3 } }
  })
  const graph = vi.fn(async () => ({ data: [options.key ?? key] }))
  const scopes: MedusaRequest["scope"][] = []
  const requests: MedusaRequest[] = []
  const handler = createStoreCurrencyHttpHandler({
    storeCors: options.storeCors ?? "https://store.example,/^https:\\/\\/preview\\.example$/",
    createRequestScope() {
      const scope = createContainer().register({ remoteQuery: asValue(remoteQuery), query: asValue({ graph }), logger: asValue({ error: () => undefined, info: () => undefined }) })
      scopes.push(scope)
      return scope
    },
    createSession: () => options.session,
    prepareRequest: (request) => { requests.push(request) },
  })
  return { handler, graph, remoteQuery, scopes, requests }
}

const headers = { "x-publishable-api-key": "pk_test", origin: "https://store.example" }
const request = (path = "/store/currencies", extraHeaders: HeadersInit = headers) => new Request(`https://private.test${path}`, { headers: extraHeaders })

describe("private native Store Currency HTTP composition", () => {
  it("builds nested remote selections without traversing object prototypes", () => {
    const result = remoteQueryObjectFromString({ entryPoint: "currency",
      fields: ["__proto__.code", "constructor.name"], variables: {} })
    expect(Object.getOwnPropertyDescriptor(result.__value.currency, "__proto__")?.value)
      .toEqual({ fields: ["code"] })
    expect(Object.getOwnPropertyDescriptor(result.__value.currency, "constructor")?.value)
      .toEqual({ fields: ["name"] })
    expect(Object.prototype).not.toHaveProperty("fields")
  })

  it("retains native list filters, defaults, response metadata and key/channel context", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("/store/currencies?code[]=usd&code[]=eur&offset=2&limit=3&fields=code,name"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ currencies: [currency], count: 1, offset: 2, limit: 3 })
    expect(f.remoteQuery).toHaveBeenCalledWith({ __value: { currency: {
      fields: ["code", "name", "id"], isServiceAccess: false,
      __args: { filters: { code: ["usd", "eur"] }, skip: 2, take: 3, order: undefined },
    } } })
    expect(f.graph).toHaveBeenCalledWith({ entity: "api_key", fields: ["id", "token", "revoked_at", "sales_channels_link.sales_channel_id"],
      filters: { token: "pk_test", type: "publishable" } }, { cache: { enable: true } })
    expect(getMedusaRequestPublishableKeyContext(f.requests[0])).toEqual({ key: "pk_test", sales_channel_ids: ["sc_test"] })
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
    expect(response.headers.get("access-control-allow-credentials")).toBe("true")
  })

  it("retains native retrieve filtering and not-found errors", async () => {
    const f = fixture({ retrieve: true })
    expect(await (await f.handler.handle(request("/store/currencies/usd?fields=code,name"))).json()).toEqual({ currency })
    expect(f.remoteQuery).toHaveBeenCalledWith({ __value: { currency: { fields: ["code", "name", "id"], isServiceAccess: false, __args: { filters: { code: "usd" } } } } })
    const absent = await fixture({ retrieve: true, empty: true }).handler.handle(request("/store/currencies/missing"))
    expect(absent.status).toBe(404)
    expect(await absent.json()).toMatchObject({ type: "not_found", message: "Currency with code: missing was not found" })
  })

  it("checks key before route validation and refuses missing or revoked keys", async () => {
    const f = fixture()
    const missing = await f.handler.handle(request("/store/currencies?limit=invalid", {}))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({ type: "not_allowed" })
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.remoteQuery).not.toHaveBeenCalled()
    const revoked = fixture({ key: { ...key, revoked_at: "2000-01-01" } })
    expect((await revoked.handler.handle(request())).status).toBe(400)
    expect(revoked.remoteQuery).not.toHaveBeenCalled()
    const future = fixture({ key: { ...key, revoked_at: "2100-01-01" } })
    expect((await future.handler.handle(request())).status).toBe(200)
  })

  it("normalizes locale before validation, allows anonymous and invalid bearer requests, and accepts a verified session", async () => {
    const f = fixture({ session: { auth_context: customer } })
    await f.handler.handle(request("/store/currencies?locale=en-uS", { ...headers, "x-medusa-locale": "fr-FR" }))
    expect(f.requests[0].locale).toBe("en-US")
    expect(f.requests[0].query).not.toHaveProperty("locale")
    expect(f.requests[0].auth_context).toEqual(customer)
    const anonymous = fixture()
    expect((await anonymous.handler.handle(request("/store/currencies", { ...headers, authorization: "Bearer malformed" }))).status).toBe(200)
    expect(anonymous.requests[0].auth_context).toBeUndefined()
    await anonymous.handler.handle(request())
    expect(anonymous.scopes[0]).not.toBe(anonymous.scopes[1])
  })

  it("rejects malformed queries before data access and projects backend failure", async () => {
    const f = fixture()
    expect((await f.handler.handle(request("/store/currencies?limit=invalid"))).status).toBe(400)
    expect(f.remoteQuery).not.toHaveBeenCalled()
    const response = await fixture({ fail: true }).handler.handle(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
  })

  it("handles native CORS preflight before key, preserves denied origins, and leaves unrelated paths unhandled", async () => {
    const f = fixture()
    const response = await f.handler.handle(new Request("https://private.test/store/currencies", { method: "OPTIONS", headers: {
      origin: "https://preview.example", "access-control-request-method": "GET", "access-control-request-headers": "x-publishable-api-key",
    } }))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://preview.example")
    expect(response.headers.get("access-control-allow-headers")).toBe("x-publishable-api-key")
    expect(f.scopes).toHaveLength(0)
    const denied = await f.handler.handle(request("/store/currencies", { ...headers, origin: "https://denied.example" }))
    expect(denied.status).toBe(200)
    expect(denied.headers.get("access-control-allow-origin")).toBeNull()
    expect(await f.handler.tryHandle(request("/admin/currencies"))).toBeUndefined()
    expect((await f.handler.handle(new Request("https://private.test/store/currencies", { method: "POST" }))).status).toBe(404)
  })

  it("keeps configured global and sticky origin expressions independent across requests", async () => {
    for (const flag of ["g", "y"]) {
      const f = fixture({ storeCors: `/^https:\\/\\/store\\.example$/${flag}` })
      const first = await f.handler.handle(request())
      const second = await f.handler.handle(request())
      expect(first.headers.get("access-control-allow-origin")).toBe("https://store.example")
      expect(second.headers.get("access-control-allow-origin")).toBe("https://store.example")
    }
  })
})
