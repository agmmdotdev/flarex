import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import type { AuthContext } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { createStoreProductHttpHandler } from "../src/store-product"
import { makeStoreProductEffectHttpHandler } from "../src/storeProductEffectHost.mjs"

const customer: AuthContext = { actor_id: "cus_store", actor_type: "customer", auth_identity_id: "auth_store", app_metadata: {}, user_metadata: {} }
const product = { id: "prod_store", title: "Store Product", type_id: "type_store", categories: [{ id: "cat_public", is_internal: false }, { id: "cat_internal", is_internal: true }], variants: [{ id: "variant_store", manage_inventory: true, calculated_price: { id: "ps_store", calculated_amount: 100, original_amount: 120, currency_code: "usd", is_calculated_price_tax_inclusive: false, is_original_price_tax_inclusive: false } }] }
type GraphInput = { entity: string; fields?: string[]; filters?: Record<string, unknown>; pagination?: object; context?: object }
type Options = { keyValid?: boolean; revoked?: boolean; keyChannels?: string[]; channelCount?: number; principal?: AuthContext; empty?: boolean; noMetadata?: boolean; missingRegion?: boolean; missingTaxRegion?: boolean; noDefaultRegion?: boolean; automaticTaxes?: boolean; cart?: boolean; failEntity?: string; taxError?: boolean; nullVariants?: boolean; taxInclusive?: boolean }

function fixture(options: Options = {}) {
  const graph = vi.fn(async (input: GraphInput) => {
    if (input.entity === options.failEntity) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Refused ${input.entity}`)
    if (input.entity === "api_key") return { data: options.keyValid === false ? [] : [{ id: "apk_store", token: "pk_store", revoked_at: options.revoked ? "2000-01-01" : null, sales_channels_link: (options.keyChannels ?? ["sc_store"]).map(sales_channel_id => ({ sales_channel_id })) }] }
    if (input.entity === "sales_channels") return { data: [{ id: "sc_store" }], ...(options.noMetadata ? {} : { metadata: { count: options.channelCount ?? 2 } }) }
    if (input.entity === "product_sales_channel") return { data: options.empty ? [] : [{ product_id: product.id }] }
    if (input.entity === "cart") return { data: options.cart ? [{ region_id: "region_cart", shipping_address: { country_code: "de", province: "BE" } }] : [] }
    if (input.entity === "store") return { data: [{ id: "store_native", ...(options.noDefaultRegion ? {} : { default_region_id: "region_default" }) }] }
    if (input.entity === "region") return { data: options.missingRegion || options.missingTaxRegion && input.fields?.includes("automatic_taxes") ? [] : [{ id: input.filters?.id, currency_code: "usd", automatic_taxes: options.automaticTaxes ?? true }] }
    if (input.entity === "customer_group") return { data: [{ id: "cg_store" }, { id: "cg_other" }] }
    if (input.entity === "product_variant_inventory_items") return { data: [{ variant_id: "variant_store", required_quantity: 2, variant: { manage_inventory: true }, inventory: { location_levels: [{ location_id: "loc_linked", available_quantity: 7 }, { location_id: "loc_unlinked", available_quantity: 100 }] } }] }
    if (input.entity === "sales_channel_locations") return { data: [{ stock_location_id: "loc_linked" }] }
    if (input.entity === "product") {
      const result = structuredClone(product)
      if (options.taxInclusive) {
        result.variants[0]!.calculated_price.is_calculated_price_tax_inclusive = true
        result.variants[0]!.calculated_price.is_original_price_tax_inclusive = true
      }
      return { data: options.empty || Array.isArray(input.filters?.id) && input.filters.id.length === 0 ? [] : [{ ...result, ...(options.nullVariants ? { variants: null } : {}) }], ...(options.noMetadata ? {} : { metadata: { count: 9, skip: 2, take: 3 } }) }
    }
    throw new Error(`Unexpected native graph entity ${input.entity}`)
  })
  const index = vi.fn(async () => { throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Index engine is outside the admitted profile") })
  const getTaxLines = vi.fn(async () => {
    if (options.taxError) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Tax calculation refused")
    return [{ line_item_id: "variant_store", rate: 20 }]
  })
  const resolveCustomer = vi.fn(async () => options.principal)
  const handler = createStoreProductHttpHandler({ storeCors: "https://store.example", resolveCustomerPrincipal: resolveCustomer,
    createRequestScope: () => createContainer().register({ query: asValue({ graph, index }), tax: asValue({ getTaxLines }), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, graph, index, getTaxLines, resolveCustomer }
}
const headers = { "x-publishable-api-key": "pk_store", origin: "https://store.example" }
const request = (path = "", query = "", extra: HeadersInit = {}) => new Request(`https://private.test/store/products${path}${query ? `?${query}` : ""}`, { headers: { ...headers, ...extra } })
afterEach(() => { FeatureFlag.setFlag("index_engine", false); FeatureFlag.setFlag("translation", false) })

describe("selected native Store Product list and detail", () => {
  it("keeps real key lookup, anonymous defaults, channel link filter, metadata and CORS", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "limit=3&offset=2"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ products: [{ id: product.id }], count: 9, offset: 2, limit: 3 })
    expect(f.graph).toHaveBeenNthCalledWith(1, { entity: "api_key", fields: ["id", "token", "revoked_at", "sales_channels_link.sales_channel_id"], filters: { token: "pk_store", type: "publishable" } }, { cache: { enable: true } })
    expect(f.graph).toHaveBeenCalledWith({ entity: "sales_channels", fields: ["id"], pagination: { skip: 0, take: 1 } })
    expect(f.graph).toHaveBeenCalledWith({ entity: "product_sales_channel", fields: ["product_id"], filters: { sales_channel_id: ["sc_store"] } })
    expect(f.graph).toHaveBeenCalledWith({ entity: "product", fields: expect.arrayContaining(["id", "title", "variants.*", "variants.options.*"]), filters: { id: [product.id], status: "published" }, pagination: { skip: 2, take: 3 }, context: {} }, { cache: { enable: true }, locale: undefined })
    expect(f.getTaxLines).not.toHaveBeenCalled()
    expect(response.headers.get("access-control-allow-origin")).toBe("https://store.example")
  })

  it.each([{ channelCount: 0 }, { channelCount: 1 }, { noMetadata: true }])("preserves native list-only channel-count bypass %o", async options => {
    const f = fixture(options)
    expect((await f.handler.handle(request("", "fields=id"))).status).toBe(200)
    expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key", "sales_channels", "product"])
    expect(f.graph.mock.calls[2]?.[0].filters).toEqual({ status: "published" })
    const detail = fixture(options)
    expect((await detail.handler.handle(request(`/${product.id}`, "fields=id"))).status).toBe(200)
    expect(detail.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key", "product_sales_channel", "product"])
    expect(detail.graph.mock.calls[1]?.[0].filters).toEqual({ sales_channel_id: ["sc_store"], product_id: product.id })
  })

  it("retains default published filters and actual native category normalization order", async () => {
    const f = fixture({ channelCount: 1 })
    const response = await f.handler.handle(request("", "fields=id&category_id=cat_public&tag_id=tag_native"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.graph.mock.calls.at(-1)?.[0].filters).toEqual({ categories: { id: "cat_public" }, tags: { id: "tag_native" }, status: "published" })
  })

  it("retains detail ID intersection, missing errors and internal-category filtering", async () => {
    const f = fixture()
    const response = await f.handler.handle(request(`/${product.id}`, "fields=id,*categories"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ product: { categories: [{ id: "cat_public", is_internal: false }] } })
    expect(f.graph.mock.calls.at(-1)?.[0]).toMatchObject({ entity: "product", fields: ["id", "categories.*", "categories.is_internal"], filters: { id: product.id, status: "published" } })
    const absent = fixture({ empty: true })
    const missing = await absent.handler.handle(request("/missing", "fields=id"))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ message: "Product with id: missing was not found" })
    expect(absent.graph.mock.calls.at(-1)?.[0].filters?.id).toEqual([])
  })

  it("passes native tagged pricing context and normalized locale, clears context selectors", async () => {
    const f = fixture({ principal: customer })
    const response = await f.handler.handle(request("", "fields=id,*variants.calculated_price&region_id=region_store&country_code=us&province=CA&locale=en-uS", { "x-medusa-locale": "fr-FR" }))
    expect(response.status, await response.clone().text()).toBe(200)
    const productCall = f.graph.mock.calls.find(call => call[0].entity === "product")
    expect(productCall).toEqual([{ entity: "product", fields: ["id", "variants.calculated_price.*"], filters: { id: [product.id], status: "published" }, pagination: { skip: 0, take: 50 }, context: { variants: { calculated_price: { region_id: "region_store", currency_code: "usd", customer: { groups: [{ id: "cg_store" }, { id: "cg_other" }] }, __type: "QueryContext" } } } }, { cache: { enable: true }, locale: "en-US" }])
    expect(f.graph).toHaveBeenCalledWith({ entity: "customer_group", fields: ["id"], filters: { customers: { id: customer.actor_id } }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.getTaxLines).toHaveBeenCalledExactlyOnceWith([{ id: "variant_store", product_id: product.id, product_type_id: "type_store", quantity: 1, unit_price: 100, currency_code: "usd" }], { address: { country_code: "us", province_code: "CA" }, locale: "en-US" })
    expect(await response.json()).toMatchObject({ products: [{ variants: [{ calculated_price: { calculated_amount_with_tax: 120, calculated_amount_without_tax: 100, original_amount_with_tax: 144, original_amount_without_tax: 120 } }] }] })
  })

  it("uses cart context ahead of request selectors and store defaults only when needed", async () => {
    const cart = fixture({ cart: true })
    expect((await cart.handler.handle(request("", "fields=id&cart_id=cart_store&region_id=region_ignored&country_code=us"))).status).toBe(200)
    expect(cart.graph.mock.calls.some(call => call[0].entity === "store")).toBe(false)
    expect(cart.graph.mock.calls.find(call => call[0].entity === "product")?.[0]).toMatchObject({ fields: ["id", "variants.calculated_price.*"], context: { variants: { calculated_price: { region_id: "region_cart", currency_code: "usd", __type: "QueryContext" } } } })
    expect(cart.getTaxLines.mock.calls[0]?.[1]).toMatchObject({ address: { country_code: "de", province_code: "BE" } })
    const fallback = fixture()
    expect((await fallback.handler.handle(request("", "fields=id,*variants.calculated_price"))).status).toBe(200)
    expect(fallback.graph.mock.calls.find(call => call[0].entity === "store")?.[0]).toMatchObject({ fields: ["id", "default_region_id"] })
    expect(fallback.graph.mock.calls.find(call => call[0].entity === "product")?.[0]).toMatchObject({ context: { variants: { calculated_price: { region_id: "region_default" } } } })
    const unrequested = fixture({ cart: true })
    expect((await unrequested.handler.handle(request("", "fields=id&cart_id=cart_store"))).status).toBe(200)
    expect(unrequested.graph.mock.calls.some(call => ["cart", "store", "region"].includes(call[0].entity))).toBe(false)
  })

  it("preserves native tax-inclusive amounts without a second tax calculation", async () => {
    const f = fixture({ taxInclusive: true })
    const response = await f.handler.handle(request("", "fields=id,*variants.calculated_price&region_id=region_store&country_code=us"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.products[0].variants[0].calculated_price.calculated_amount_with_tax).toBe(100)
    expect(body.products[0].variants[0].calculated_price.calculated_amount_without_tax).toBeCloseTo(100 / 1.2)
    expect(body.products[0].variants[0].calculated_price.original_amount_without_tax).toBe(100)
    expect(f.getTaxLines).toHaveBeenCalledTimes(1)
  })

  it.each([{ automaticTaxes: false }, {}])("skips tax calls without native automatic/country context %o", async options => {
    const f = fixture(options)
    const query = `fields=id,*variants.calculated_price&region_id=region_store${options.automaticTaxes === false ? "&country_code=us" : ""}`
    expect((await f.handler.handle(request("", query))).status).toBe(200)
    expect(f.getTaxLines).not.toHaveBeenCalled()
  })

  it("uses channel-specific availability and refuses ambiguous requested inventory context", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id,*variants,variants.inventory_quantity"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ products: [{ variants: [{ inventory_quantity: 3 }] }] })
    expect(f.graph.mock.calls.find(call => call[0].entity === "product")?.[0].fields).not.toContain("variants.inventory_quantity")
    expect(f.graph).toHaveBeenCalledWith({ entity: "sales_channel_locations", fields: ["stock_location_id"], filters: { sales_channel_id: "sc_store" } }, { cache: { tags: ["SalesChannel:sc_store", "StockLocation:list:*"] } })
    const ambiguous = fixture({ keyChannels: ["sc_store", "sc_other"] })
    expect((await ambiguous.handler.handle(request("", "fields=id,*variants,variants.inventory_quantity"))).status).toBe(400)
    expect(ambiguous.graph.mock.calls.some(call => call[0].entity === "product_variant_inventory_items")).toBe(false)
    const selected = fixture({ keyChannels: ["sc_store", "sc_other"] })
    expect((await selected.handler.handle(request("", "fields=id,*variants,variants.inventory_quantity&sales_channel_id=sc_other"))).status).toBe(200)
    expect(selected.graph.mock.calls.find(call => call[0].entity === "sales_channel_locations")?.[0].filters).toEqual({ sales_channel_id: "sc_other" })
  })

  it("tolerates empty lists, null Variants and absent metadata using native envelopes", async () => {
    const empty = fixture({ empty: true, noMetadata: true })
    expect(await (await empty.handler.handle(request())).json()).toEqual({ products: [], count: 0, offset: 0, limit: 0 })
    const nullVariants = fixture({ nullVariants: true })
    expect((await nullVariants.handler.handle(request("", "fields=id,variants.inventory_quantity"))).status).toBe(200)
    expect(nullVariants.graph.mock.calls.some(call => call[0].entity === "product_variant_inventory_items")).toBe(false)
  })

  it("requires a real active key and configured channels before Product or context reads", async () => {
    const missing = fixture()
    expect((await missing.handler.handle(new Request("https://private.test/store/products"))).status).toBe(400)
    expect(missing.graph).not.toHaveBeenCalled()
    for (const options of [{ keyValid: false }, { revoked: true }, { keyChannels: [] }]) {
      const f = fixture(options)
      expect((await f.handler.handle(request())).status).toBe(400)
      expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
    }
    const foreign = fixture()
    expect((await foreign.handler.handle(request("", "sales_channel_id=sc_foreign"))).status).toBe(400)
    expect(foreign.graph).toHaveBeenCalledTimes(1)
  })

  it("allows anonymous or invalid bearer identity and never attaches an incompatible verified actor", async () => {
    for (const principal of [undefined, { ...customer, actor_type: "user", actor_id: "user_admin" }, { ...customer, actor_id: "" }]) {
      const f = fixture({ principal })
      expect((await f.handler.handle(request("", "fields=id,*variants.calculated_price&region_id=region_store", { authorization: "Bearer unverified" }))).status).toBe(200)
      expect(f.graph.mock.calls.some(call => call[0].entity === "customer_group")).toBe(false)
      expect(f.resolveCustomer).toHaveBeenCalledTimes(1)
    }
  })

  it("retains index dispatch with an explicitly failing index capability and no product graph fallback", async () => {
    FeatureFlag.setFlag("index_engine", true)
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id"))
    expect(response.status).toBe(400)
    expect(f.index).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id"], filters: { status: "published", sales_channels: { id: ["sc_store"] } }, pagination: { skip: 0, take: 50 }, context: {} }, { cache: { enable: true }, locale: undefined })
    expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
  })

  it("fails closed for enabled translations after mandatory key verification", async () => {
    FeatureFlag.setFlag("translation", true)
    const f = fixture()
    const response = await f.handler.handle(request())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: "Store Product translations are outside the admitted profile" })
    expect(f.graph.mock.calls.map(call => call[0].entity)).toEqual(["api_key"])
  })

  it.each([{ noDefaultRegion: true }, { missingRegion: true }, { missingTaxRegion: true }, { failEntity: "product" }, { failEntity: "customer_group", principal: customer }, { taxError: true }])("preserves context/read/tax failure and never retries %o", async options => {
    const f = fixture(options)
    const query = `fields=id,*variants.calculated_price&country_code=us${options.noDefaultRegion ? "" : "&region_id=region_store"}`
    const response = await f.handler.handle(request("", query))
    expect(response.status).toBe(400)
    expect(f.graph.mock.calls.filter(call => call[0].entity === "product").length).toBeLessThanOrEqual(1)
    expect(f.getTaxLines.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it.each(["api_key", "sales_channels", "product_sales_channel", "cart", "store", "region", "product_variant_inventory_items", "sales_channel_locations"])("propagates %s failures at the native stage without retry", async failEntity => {
    const f = fixture({ failEntity })
    const query = "fields=id,*variants,variants.inventory_quantity,*variants.calculated_price&country_code=us" + (failEntity === "cart" ? "&cart_id=cart_store" : failEntity === "store" ? "" : "&region_id=region_store")
    const response = await f.handler.handle(request("", query))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: `Refused ${failEntity}` })
    expect(f.graph.mock.calls.filter(call => call[0].entity === failEntity)).toHaveLength(1)
  })

  it("serves the same bounded native request through the scoped Effect host", async () => {
    const response = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeStoreProductEffectHttpHandler({ storeCors: "https://store.example", createRequestScope: () => createContainer().register({
        query: asValue({ graph: async (input: GraphInput) => input.entity === "api_key"
          ? { data: [{ id: "key_effect", token: "pk_store", revoked_at: null, sales_channels_link: [{ sales_channel_id: "sc_store" }] }] }
          : input.entity === "sales_channels" ? { data: [], metadata: { count: 1 } } : { data: [], metadata: { count: 0, skip: 0, take: 50 } } }),
        logger: asValue({ error() {}, info() {} }),
      }) })
      return yield* Effect.promise(() => host.handler(request()))
    })))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ products: [], count: 0, offset: 0, limit: 50 })
  })
})
