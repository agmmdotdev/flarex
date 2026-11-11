import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createStoreProductHttpHandler } from "../src/store-product"

type GraphInput = { entity: string; fields: string[]; filters?: Record<string, unknown>; pagination?: object }
type Options = { missing?: boolean; empty?: boolean; invalidKey?: boolean; revoked?: boolean; noChannels?: boolean; failure?: boolean }
const collection = { id: "pcol_store", title: "Store Collection", handle: "store-collection", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z" }
const headers = { "x-publishable-api-key": "pk_store", origin: "https://store.example" }
const request = (path = "", query = "", extra: HeadersInit = {}) => new Request(`https://private.test/store/collections${path}${query ? `?${query}` : ""}`, { headers: { ...headers, ...extra } })

function fixture(options: Options = {}) {
  const graph = vi.fn(async (input: GraphInput) => {
    if (input.entity === "api_key") return { data: options.invalidKey ? [] : [{ id: "apk_store", token: "pk_store", revoked_at: options.revoked ? "2000-01-01" : null, sales_channels_link: options.noChannels ? [] : [{ sales_channel_id: "sc_store" }] }] }
    if (input.entity !== "product_collection") throw new Error(`Unexpected graph entity ${input.entity}`)
    if (options.failure) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Collection read refused")
    return { data: options.missing || options.empty ? [] : [collection], metadata: { count: options.empty ? 0 : 7, skip: 2, take: 3 } }
  })
  const handler = createStoreProductHttpHandler({ storeCors: "https://store.example", createRequestScope: () => createContainer().register({ query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) }) })
  return { handler, graph }
}

afterEach(() => { FeatureFlag.setFlag("translation", false) })

describe("selected native Store Collection list and detail", () => {
  it("preserves native list defaults, query graph dispatch, metadata and CORS", async () => {
    const f = fixture()
    const response = await f.handler.handle(request())
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ collections: [collection], count: 7, offset: 2, limit: 3 })
    expect(f.graph).toHaveBeenNthCalledWith(1, { entity: "api_key", fields: ["id", "token", "revoked_at", "sales_channels_link.sales_channel_id"], filters: { token: "pk_store", type: "publishable" } }, { cache: { enable: true } })
    expect(f.graph).toHaveBeenNthCalledWith(2, { entity: "product_collection", filters: {}, pagination: { skip: 0, take: 10, order: { created_at: "DESC" } }, fields: ["id", "title", "handle", "created_at", "updated_at"] }, { locale: undefined })
    expect(f.graph).toHaveBeenCalledTimes(2)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
  })

  it("retains scalar, array, nested logical and date filters with native pagination", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id,title&limit=3&offset=2&order=title&id[0]=pcol_a&id[1]=pcol_b&handle=store-collection&$or[0][title]=First&$or[1][title]=Second&created_at[$gte]=2026-01-01"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.graph.mock.calls.at(-1)?.[0]).toEqual({ entity: "product_collection", fields: ["id", "title"], filters: { id: ["pcol_a", "pcol_b"], handle: "store-collection", $or: [{ title: "First" }, { title: "Second" }], created_at: { $gte: "2026-01-01" } }, pagination: { skip: 2, take: 3, order: { title: "ASC" } } })
  })

  it("passes normalized query locale before the header and preserves requested relations", async () => {
    const f = fixture()
    const response = await f.handler.handle(request(`/${collection.id}`, "fields=id,*products&locale=en-uS", { "x-medusa-locale": "fr-FR" }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ collection })
    expect(f.graph).toHaveBeenLastCalledWith({ entity: "product_collection", filters: { id: collection.id }, fields: ["id", "products.*"] }, { locale: "en-US" })
    const headerLocale = fixture()
    expect((await headerLocale.handler.handle(request(`/${collection.id}`, "fields=id", { "x-medusa-locale": "fr-fr" }))).status).toBe(200)
    expect(headerLocale.graph).toHaveBeenLastCalledWith({ entity: "product_collection", filters: { id: collection.id }, fields: ["id"] }, { locale: "fr-FR" })
  })

  it("preserves the native collection 404 and empty list envelope", async () => {
    const f = fixture({ missing: true })
    const response = await f.handler.handle(request("/missing"))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ message: "Collection with id: missing was not found" })
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
    const empty = fixture({ empty: true })
    expect(await (await empty.handler.handle(request())).json()).toEqual({ collections: [], count: 0, offset: 2, limit: 3 })
  })

  it.each(["limit=invalid", "created_at[$gte][nested]=invalid"])("rejects malformed native query %s before collection reads", async query => {
    const f = fixture()
    expect((await f.handler.handle(request("", query))).status).toBe(400)
    expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
  })

  it("requires an active publishable key before either route without adding Product channel restrictions", async () => {
    const missing = fixture()
    expect((await missing.handler.handle(new Request("https://private.test/store/collections"))).status).toBe(400)
    expect(missing.graph).not.toHaveBeenCalled()
    for (const options of [{ invalidKey: true }, { revoked: true }]) {
      for (const path of ["", `/${collection.id}`]) {
        const f = fixture(options)
        expect((await f.handler.handle(request(path))).status).toBe(400)
        expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
      }
    }
    for (const path of ["", `/${collection.id}`]) {
      const f = fixture({ noChannels: true })
      expect((await f.handler.handle(request(path))).status).toBe(200)
      expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key", "product_collection"])
    }
  })

  it("propagates native failures without retry and keeps translations outside the profile", async () => {
    const f = fixture({ failure: true })
    const response = await f.handler.handle(request())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: "Collection read refused" })
    expect(f.graph).toHaveBeenCalledTimes(2)
    FeatureFlag.setFlag("translation", true)
    const translation = fixture()
    expect((await translation.handler.handle(request())).status).toBe(400)
    expect(translation.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
  })

  it("handles Collection CORS preflight without request scopes and keeps mutations outside the admitted methods", async () => {
    const f = fixture()
    const preflight = await f.handler.handle(new Request("https://private.test/store/collections", { method: "OPTIONS", headers: { origin: "https://store.example", "access-control-request-method": "GET", "access-control-request-headers": "x-publishable-api-key" } }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://store.example")
    expect(preflight.headers.get("access-control-allow-headers")).toBe("x-publishable-api-key")
    expect(f.graph).not.toHaveBeenCalled()
    expect((await f.handler.handle(new Request("https://private.test/store/collections", { method: "POST", headers }))).status).toBe(404)
    expect(f.graph).not.toHaveBeenCalled()
  })
})
