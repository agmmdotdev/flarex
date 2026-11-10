import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { AuthContext } from "@medusajs/framework/http"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const user: AuthContext = { actor_id: "user_option", actor_type: "user", auth_identity_id: "auth_option", app_metadata: {}, user_metadata: {} }
const option = { id: "opt_native", title: "Size", product_id: "prod_options", values: [{ id: "optval_one", value: "One" }] }
const parent = { id: "prod_options", title: "Parent", options: [option], variants: [{ id: "variant_native", price_set: { prices: [{ id: "price_native", amount: "175", currency_code: "usd", created_at: "2026-01-01", updated_at: "2026-01-01" }] } }] }

function fixture(options: { anonymous?: boolean; deny?: string; missing?: boolean; nullData?: boolean; missingParent?: boolean; nullParent?: boolean; emptyResult?: boolean; workflowError?: Error; graphError?: Error; rejectProjection?: boolean } = {}) {
  const run = vi.fn(async () => {
    if (options.workflowError) throw options.workflowError
    return { result: options.emptyResult ? [] : [{ id: "ignored_workflow_result" }] }
  })
  const graph = vi.fn(async (input: { entity: string }) => {
    if (options.graphError) throw options.graphError
    if (input.entity === "product") return { data: options.nullParent ? null : options.missingParent ? [] : structuredClone([parent]) }
    return { data: options.nullData ? null : options.missing ? [] : structuredClone([option]), metadata: { count: 9, skip: 2, take: 3 } }
  })
  const admission = vi.fn(() => { if (options.rejectProjection) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported Product refetch fields") })
  const evaluate = vi.fn((_principal, policies: { resource: string; operation: string }[]) => !policies.some(policy => `${policy.resource}:${policy.operation}` === options.deny))
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example",
    resolveAdminPrincipal: () => options.anonymous ? undefined : user,
    evaluateAdminPolicies: evaluate,
    admitProductRefetchFields: admission,
    createRequestScope: () => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), logger: asValue({ error() {}, info() {} }) }),
  })
  return { handler, run, graph, admission, evaluate }
}

function request(path = "", query = "", body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`https://private.test/admin/products/${parent.id}/options${path}${query ? `?${query}` : ""}`, {
    method, headers: { origin: "https://admin.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe("selected pinned Admin Product option GET/POST routes", () => {
  it("lists native defaults and filter/pagination metadata with the parent selector", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "id[]=opt_native&title=Size&q=Small&created_at[$gte]=2026-01-01&limit=3&offset=2&order=-title"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ product_options: [option], count: 9, offset: 2, limit: 3 })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product_option", fields: ["id", "title"], filters: {
      id: [option.id], title: "Size", q: "Small", created_at: { $gte: "2026-01-01" }, product_id: parent.id,
    }, pagination: { skip: 2, take: 3, order: { title: "DESC" } }, withDeleted: undefined, context: undefined }, undefined)
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: "product", operation: "read" }]]])
    expect(f.admission).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
  })

  it("uses native collection pagination defaults and preserves empty or null option lists", async () => {
    const defaults = fixture()
    expect((await defaults.handler.handle(request())).status).toBe(200)
    expect(defaults.graph.mock.calls[0]?.[0]).toMatchObject({ fields: ["id", "title"], filters: { product_id: parent.id }, pagination: { skip: 0, take: 50 } })
    for (const options of [{ missing: true }, { nullData: true }]) {
      const f = fixture(options)
      const response = await f.handler.handle(request())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ product_options: "nullData" in options ? null : [], count: 9, offset: 2, limit: 3 })
      expect(f.graph).toHaveBeenCalledTimes(1)
    }
  })

  it("retrieves an option under its Product and keeps native empty/null detail envelopes", async () => {
    const f = fixture()
    const response = await f.handler.handle(request(`/${option.id}`, "fields=id,title,*values"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ product_option: option })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product_option", fields: ["id", "title", "values.*"], filters: { id: option.id, product_id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.evaluate.mock.calls).toEqual([
      [user, [{ resource: "product", operation: "read" }]],
      [user, [{ resource: "product_option", operation: "read" }]],
    ])
    for (const options of [{ missing: true }, { nullData: true }]) {
      const absent = fixture(options)
      const response = await absent.handler.handle(request("/missing"))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual("nullData" in options ? { product_option: null } : {})
      expect(absent.graph).toHaveBeenCalledTimes(1)
    }
  })

  it("creates through exact native workflow input and remaps the parent response", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "fields=id,*options,*variants.prices", { title: "Size", values: ["One"], additional_data: { origin: "native-http" } }))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("create-product-options", { input: { product_options: [{ title: "Size", values: ["One"], product_id: parent.id }], additional_data: { origin: "native-http" } } })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(["id", "options.*", "variants.price_set.prices.*"])
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id", "options.*", "variants.price_set.prices.*"], filters: { id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(await response.json()).toMatchObject({ product: { id: parent.id, options: [option], variants: [{ prices: [{ amount: 175, variant_id: "variant_native" }] }] } })
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: "product", operation: "read" }]]])
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.graph.mock.invocationCallOrder[0])
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("forwards the two-id selector, native body id and additional_data to the workflow boundary without existence reads", async () => {
    const f = fixture()
    const body = { id: option.id, title: "Updated", values: [], additional_data: { origin: "update" } }
    const response = await f.handler.handle(request(`/${option.id}`, "fields=id,*options.values", body))
    expect(response.status).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-options", { input: { selector: { id: option.id, product_id: parent.id }, update: { id: option.id, title: "Updated", values: [] }, additional_data: { origin: "update" } } })
    expect(f.graph).toHaveBeenCalledExactlyOnceWith({ entity: "product", fields: ["id", "options.values.*"], filters: { id: parent.id }, pagination: undefined, withDeleted: undefined, context: undefined }, undefined)
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.graph.mock.invocationCallOrder[0])
    expect(f.evaluate.mock.calls).toEqual([
      [user, [{ resource: "product", operation: "read" }]],
      [user, [{ resource: "product_option", operation: "read" }]],
    ])
  })

  it("keeps empty updates and native Product defaults, and ignores an empty workflow result", async () => {
    const f = fixture({ emptyResult: true })
    const response = await f.handler.handle(request(`/${option.id}`, "", {}))
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveProperty("product.id", parent.id)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-options", { input: { selector: { id: option.id, product_id: parent.id }, update: {}, additional_data: undefined } })
    expect(f.admission).toHaveBeenCalledWith(expect.arrayContaining(["id", "title", "options.*", "options.values.*", "variants.price_set.prices.*"]))
    expect(f.graph).toHaveBeenCalledTimes(1)
  })

  it("rejects native malformed/strict bodies, query filters and selectors before reads or workflows", async () => {
    for (const [path, bodies] of [["", [{ values: [] }, { title: "Size" }, { title: "Size", values: [1] }, { title: "Size", values: [], product_id: "other" }]],
      [`/${option.id}`, [{ title: null }, { values: null }, { values: [1] }, { unknown: true }]]] as const) {
      const f = fixture()
      for (const body of bodies) expect((await f.handler.handle(request(path, "", body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
    for (const path of ["", `/${option.id}`]) {
      const f = fixture()
      expect((await f.handler.handle(request(path, "product_id=other"))).status).toBe(400)
      expect((await f.handler.handle(request(path, "fields=__proto__.x"))).status).toBe(400)
      expect((await f.handler.handle(request(path, "title=Other", path ? {} : { title: "Size", values: [] }))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("checks inherited policy and authentication before option reads and mutations", async () => {
    for (const [path, options, status] of [["", { anonymous: true }, 401], ["", { deny: "product:read" }, 403],
      [`/${option.id}`, { deny: "product_option:read" }, 403]] as const) {
      for (const body of [undefined, path ? {} : { title: "Size", values: [] }]) {
        const f = fixture(options)
        expect((await f.handler.handle(request(path, "", body))).status).toBe(status)
        expect(f.run).not.toHaveBeenCalled()
        expect(f.graph).not.toHaveBeenCalled()
      }
    }
  })

  it("admits the actual parent refetch projection before either option mutation", async () => {
    for (const path of ["", `/${option.id}`]) {
      const f = fixture({ rejectProjection: true })
      expect((await f.handler.handle(request(path, "fields=id,*variants.prices", path ? {} : { title: "Size", values: [] }))).status).toBe(400)
      expect(f.admission).toHaveBeenCalledExactlyOnceWith(["id", "variants.price_set.prices.*"])
      expect(f.run).not.toHaveBeenCalled()
      expect(f.graph).not.toHaveBeenCalled()
    }
  })

  it("preserves native workflow refusals and redacts unknown errors without retry or refetch", async () => {
    for (const path of ["", `/${option.id}`]) {
      for (const [workflowError, status, type, message] of [
        [new MedusaError(MedusaError.Types.NOT_FOUND, "Native option missing"), 404, "not_found", "Native option missing"],
        [new MedusaError(MedusaError.Types.INVALID_DATA, "Native option refused"), 400, "invalid_data", "Native option refused"],
        [new Error("private workflow detail"), 500, "unknown_error", "An unknown error occurred."],
      ] as const) {
        const f = fixture({ workflowError })
        const response = await f.handler.handle(request(path, "", path ? {} : { title: "Size", values: [] }))
        expect(response.status).toBe(status)
        expect(await response.json()).toMatchObject({ type, message })
        expect(f.run).toHaveBeenCalledTimes(1)
        expect(f.graph).not.toHaveBeenCalled()
      }
    }
  })

  it("redacts absent or failed parent refetches without replaying a completed write", async () => {
    for (const path of ["", `/${option.id}`]) {
      for (const options of [{ missingParent: true }, { nullParent: true }, { graphError: new Error("private parent detail") }]) {
        const f = fixture(options)
        const response = await f.handler.handle(request(path, "", path ? {} : { title: "Size", values: [] }))
        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
        expect(f.run).toHaveBeenCalledTimes(1)
        expect(f.graph).toHaveBeenCalledTimes(1)
      }
    }
  })

  it("keeps option DELETE and PATCH unselected", async () => {
    const f = fixture()
    for (const path of ["", `/${option.id}`]) {
      for (const method of ["DELETE", "PATCH"]) expect((await f.handler.handle(request(path, "", undefined, method))).status).toBe(404)
    }
    expect(f.run).not.toHaveBeenCalled()
    expect(f.graph).not.toHaveBeenCalled()
  })
})
