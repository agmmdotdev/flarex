import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createStoreProductHttpHandler } from "../src/store-product"

const region = { id: "reg_store", name: "North America", currency_code: "usd", metadata: { market: "primary" }, countries: [{ iso_2: "us", display_name: "United States" }] }
const headers = { "x-publishable-api-key": "pk_store", origin: "https://store.example" }
const request = (path = "", query = "", extra: HeadersInit = {}) => new Request(`https://private.test/store/regions${path}${query ? `?${query}` : ""}`, { headers: { ...headers, ...extra } })
type Options = { retrieve?: boolean; empty?: boolean; invalidKey?: boolean; revoked?: boolean; noChannels?: boolean; failure?: boolean }

function fixture(options: Options = {}) {
  const graph = vi.fn(async () => ({ data: options.invalidKey ? [] : [{ id: "apk_store", token: "pk_store", revoked_at: options.revoked ? "2000-01-01" : null, sales_channels_link: options.noChannels ? [] : [{ sales_channel_id: "sc_store" }] }] }))
  const remoteQuery = vi.fn(async (_query: unknown) => {
    if (options.failure) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Region read refused")
    const rows = options.empty ? [] : [region]
    return options.retrieve ? rows : { rows, metadata: { count: options.empty ? 0 : 7, skip: 2, take: 3 } }
  })
  const handler = createStoreProductHttpHandler({ storeCors: "https://store.example", createRequestScope: () => createContainer().register({ query: asValue({ graph }), remoteQuery: asValue(remoteQuery), logger: asValue({ error() {}, info() {} }) }) })
  return { handler, graph, remoteQuery }
}

afterEach(() => { FeatureFlag.setFlag("translation", false) })

describe("selected native Store Region list and detail", () => {
  it("uses the schema default 50 before query-config default 20 and preserves country selection and metadata", async () => {
    const f = fixture()
    const response = await f.handler.handle(request())
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ regions: [region], count: 7, offset: 2, limit: 3 })
    expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { region: {
      fields: ["id", "name", "currency_code", "created_at", "updated_at", "deleted_at", "metadata"],
      countries: { fields: ["*"] }, isServiceAccess: false,
      __args: { filters: {}, skip: 0, take: 50, order: undefined },
    } } })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "api_key", fields: ["id", "token", "revoked_at", "sales_channels_link.sales_channel_id"], filters: { token: "pk_store", type: "publishable" } }, { cache: { enable: true } })
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
  })

  it("preserves native scalar, array, logical filters, explicit pagination and selected fields", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id,name&limit=3&offset=2&order=-name&id[0]=reg_a&id[1]=reg_b&currency_code=usd&$or[0][name]=First&$or[1][name]=Second&q=market"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.remoteQuery).toHaveBeenCalledWith({ __value: { region: {
      fields: ["id", "name"], isServiceAccess: false,
      __args: { filters: { id: ["reg_a", "reg_b"], currency_code: "usd", $or: [{ name: "First" }, { name: "Second" }], q: "market" }, skip: 2, take: 3, order: { name: "DESC" } },
    } } })
  })

  it("retrieves through callable Remote Query with native ID filtering, requested countries and 404", async () => {
    const f = fixture({ retrieve: true })
    const response = await f.handler.handle(request(`/${region.id}`, "fields=id,*countries"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ region })
    expect(f.remoteQuery).toHaveBeenCalledExactlyOnceWith({ __value: { region: { fields: ["id"], countries: { fields: ["*"] }, isServiceAccess: false, __args: { filters: { id: region.id } } } } })
    const absent = await fixture({ retrieve: true, empty: true }).handler.handle(request("/missing"))
    expect(absent.status).toBe(404)
    expect(await absent.json()).toMatchObject({ type: "not_found", message: "Region with id: missing was not found" })
    expect(absent.headers.get("access-control-allow-origin")).toBe("https://store.example")
    expect(await (await fixture({ empty: true }).handler.handle(request())).json()).toEqual({ regions: [], count: 0, offset: 2, limit: 3 })
  })

  it("requires a valid key before validation and permits a key without Product sales-channel restrictions", async () => {
    const missing = fixture()
    expect((await missing.handler.handle(new Request("https://private.test/store/regions?limit=invalid"))).status).toBe(400)
    expect(missing.graph).not.toHaveBeenCalled()
    expect(missing.remoteQuery).not.toHaveBeenCalled()
    for (const options of [{ invalidKey: true }, { revoked: true }]) {
      for (const path of ["", `/${region.id}`]) {
        const f = fixture(options)
        expect((await f.handler.handle(request(path))).status).toBe(400)
        expect(f.remoteQuery).not.toHaveBeenCalled()
      }
    }
    for (const retrieve of [false, true]) {
      const f = fixture({ noChannels: true, retrieve })
      expect((await f.handler.handle(request(retrieve ? `/${region.id}` : ""))).status).toBe(200)
    }
  })

  it.each(["limit=invalid", "currency_code[nested]=invalid", "fields=constructor.name"])("rejects malformed native query %s before data access", async query => {
    const f = fixture()
    expect((await f.handler.handle(request("", query))).status).toBe(400)
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })

  it("propagates native failure without retry and retains the existing translation gate", async () => {
    const f = fixture({ failure: true })
    const response = await f.handler.handle(request())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ type: "not_allowed", message: "Region read refused" })
    expect(f.remoteQuery).toHaveBeenCalledTimes(1)
    FeatureFlag.setFlag("translation", true)
    const translation = fixture()
    expect((await translation.handler.handle(request())).status).toBe(400)
    expect(translation.remoteQuery).not.toHaveBeenCalled()
  })

  it("handles CORS preflight without scopes and leaves writes outside admitted methods", async () => {
    const f = fixture()
    const preflight = await f.handler.handle(new Request("https://private.test/store/regions", { method: "OPTIONS", headers: { origin: "https://store.example", "access-control-request-method": "GET", "access-control-request-headers": "x-publishable-api-key" } }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://store.example")
    expect(f.graph).not.toHaveBeenCalled()
    expect((await f.handler.handle(new Request("https://private.test/store/regions", { method: "POST", headers }))).status).toBe(404)
    expect(f.graph).not.toHaveBeenCalled()
    expect(f.remoteQuery).not.toHaveBeenCalled()
  })
})
