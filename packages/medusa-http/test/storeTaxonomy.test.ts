import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createStoreProductHttpHandler } from "../src/store-product"

type GraphInput = { entity: string; fields: string[]; filters?: Record<string, unknown>; pagination?: object }
type Options = { empty?: boolean; noMetadata?: boolean; invalidKey?: boolean; revoked?: boolean; failure?: boolean }
const headers = { "x-publishable-api-key": "pk_store", origin: "https://store.example" }
const families = [
  { path: "product-tags", entity: "product_tag", list: "product_tags", detail: "product_tag", id: "ptag_store", label: "Product tag", selector: "value", defaults: ["id", "value", "created_at", "updated_at", "metadata", "products.*"], filters: {} },
  { path: "product-types", entity: "product_type", list: "product_types", detail: "product_type", id: "ptyp_store", label: "Product type", selector: "value", defaults: ["id", "value", "created_at", "updated_at", "metadata", "products.*"], filters: {} },
  { path: "product-categories", entity: "product_category", list: "product_categories", detail: "product_category", id: "pcat_store", label: "Product category", selector: "name", defaults: ["id", "name", "description", "handle", "rank", "parent_category_id", "created_at", "updated_at", "metadata", "parent_category.*", "category_children.*"], filters: { is_active: true, is_internal: false } },
] as const
type Family = typeof families[number]

function fixture(family: Family, options: Options = {}) {
  const row = { id: family.id, value: "Featured", name: "Featured", products: [{ id: "prod_native" }] }
  const graph = vi.fn(async (input: GraphInput) => {
    if (input.entity === "api_key") return { data: options.invalidKey ? [] : [{ id: "apk_store", token: "pk_store", revoked_at: options.revoked ? "2000-01-01" : null, sales_channels_link: [] }] }
    if (input.entity !== family.entity) throw new Error(`Unexpected graph entity ${input.entity}`)
    if (options.failure) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Taxonomy read refused")
    return { data: options.empty ? [] : [row], ...(options.noMetadata ? {} : { metadata: { count: options.empty ? 0 : 7, skip: 2, take: 3 } }) }
  })
  const handler = createStoreProductHttpHandler({ storeCors: "https://store.example", createRequestScope: () => createContainer().register({ query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) }) })
  const request = (path = "", query = "", extra: HeadersInit = {}) => new Request(`https://private.test/store/${family.path}${path}${query ? `?${query}` : ""}`, { headers: { ...headers, ...extra } })
  return { handler, graph, request, row }
}

afterEach(() => { FeatureFlag.setFlag("translation", false) })

describe.each(families)("selected native Store $path", family => {
  it("retains native default fields, pagination, key lookup and list envelope", async () => {
    const f = fixture(family)
    const response = await f.handler.handle(f.request())
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ [family.list]: [f.row], count: 7, offset: 2, limit: 3 })
    expect(f.graph).toHaveBeenNthCalledWith(1, { entity: "api_key", fields: ["id", "token", "revoked_at", "sales_channels_link.sales_channel_id"], filters: { token: "pk_store", type: "publishable" } }, { cache: { enable: true } })
    expect(f.graph).toHaveBeenLastCalledWith({ entity: family.entity, fields: [...family.defaults], filters: family.filters, pagination: { skip: 0, take: 50 } }, { locale: undefined })
    expect(f.graph).toHaveBeenCalledTimes(2)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
  })

  it("preserves arrays, logical/date filters, field projection and explicit ordering", async () => {
    const f = fixture(family)
    const response = await f.handler.handle(f.request("", `fields=id&limit=3&offset=2&order=-${family.selector}&id[0]=first&id[1]=second&$or[0][${family.selector}]=First&$or[1][${family.selector}]=Second&updated_at[$gte]=2026-01-01`))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.graph.mock.calls.at(-1)?.[0]).toEqual({ entity: family.entity, fields: ["id"], filters: { id: ["first", "second"], $or: [{ [family.selector]: "First" }, { [family.selector]: "Second" }], updated_at: { $gte: "2026-01-01" }, ...family.filters }, pagination: { skip: 2, take: 3, order: { [family.selector]: "DESC" } } })
  })

  it("retains detail ID, native relation forwarding and normalized locale precedence", async () => {
    const f = fixture(family)
    const response = await f.handler.handle(f.request(`/${family.id}`, "fields=id,*products&locale=en-uS", { "x-medusa-locale": "fr-FR" }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ [family.detail]: f.row })
    expect(f.graph).toHaveBeenLastCalledWith({ entity: family.entity, filters: { id: family.id, ...family.filters }, fields: ["id", "products.*"] }, { locale: "en-US" })
  })

  it("keeps the pinned missing-detail outcome and empty-list metadata", async () => {
    const f = fixture(family, { empty: true })
    const response = await f.handler.handle(f.request("/missing", "fields=id"))
    if (family.entity === "product_category") {
      // The pin checks the data array itself, so an empty array returns {}.
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
    } else {
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ message: `${family.label} with id: missing was not found` })
    }
    expect(await (await f.handler.handle(f.request())).json()).toEqual({ [family.list]: [], count: 0, offset: 2, limit: 3 })
    if (family.entity !== "product_category") {
      const absentMetadata = fixture(family, { empty: true, noMetadata: true })
      expect(await (await absentMetadata.handler.handle(absentMetadata.request())).json()).toEqual({ [family.list]: [], count: 0, offset: 0, limit: 0 })
    }
  })

  it("rejects malformed queries and inactive keys before the taxonomy read", async () => {
    const malformed = fixture(family)
    expect((await malformed.handler.handle(malformed.request("", "limit=invalid"))).status).toBe(400)
    expect(malformed.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
    for (const options of [{ invalidKey: true }, { revoked: true }]) {
      const f = fixture(family, options)
      expect((await f.handler.handle(f.request())).status).toBe(400)
      expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
    }
    const missing = fixture(family)
    expect((await missing.handler.handle(new Request(`https://private.test/store/${family.path}`))).status).toBe(400)
    expect(missing.graph).not.toHaveBeenCalled()
  })

  it("propagates native read failure without retry and refuses enabled translations", async () => {
    const f = fixture(family, { failure: true })
    const response = await f.handler.handle(f.request())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: "Taxonomy read refused" })
    expect(f.graph).toHaveBeenCalledTimes(2)
    FeatureFlag.setFlag("translation", true)
    const translation = fixture(family)
    expect((await translation.handler.handle(translation.request())).status).toBe(400)
    expect(translation.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
  })

  it("handles preflight without graph reads and leaves mutation methods unhandled", async () => {
    const f = fixture(family)
    const url = `https://private.test/store/${family.path}`
    const response = await f.handler.handle(new Request(url, { method: "OPTIONS", headers: { origin: "https://store.example", "access-control-request-method": "GET" } }))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
    expect((await f.handler.handle(new Request(url, { method: "POST", headers }))).status).toBe(404)
    expect(f.graph).not.toHaveBeenCalled()
  })
})

it("keeps native Category visibility filters and tree flags on list and detail", async () => {
  const category = families[2]
  for (const path of ["", `/${category.id}`]) {
    const f = fixture(category)
    const response = await f.handler.handle(f.request(path, "fields=id&include_ancestors_tree=true&include_descendants_tree=false"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.graph.mock.calls.at(-1)?.[0].filters).toEqual({ ...(path ? { id: category.id } : {}), is_active: true, is_internal: false, include_ancestors_tree: true, include_descendants_tree: false })
    const visibilityOverride = fixture(category)
    expect((await visibilityOverride.handler.handle(visibilityOverride.request(path, "is_active=false&is_internal=true"))).status).toBe(400)
    expect(visibilityOverride.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
  }
  const invalid = fixture(category)
  expect((await invalid.handler.handle(invalid.request("", "include_ancestors_tree=invalid"))).status).toBe(400)
  expect(invalid.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
})
