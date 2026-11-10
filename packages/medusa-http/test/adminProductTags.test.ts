import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import type { AuthContext } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"

const entity = "product_tag"
const user: AuthContext = { actor_id: "user_catalog", actor_type: "user", auth_identity_id: "auth_catalog", app_metadata: {}, user_metadata: {} }
const record = { id: "product_tag_native", value: "Native Tag", metadata: { nested: { enabled: true }, source: "native" }, created_at: "2026-01-01", updated_at: "2026-02-01" }
const defaults = ["id", "value", "created_at", "updated_at", "metadata"]

function fixture(options: { anonymous?: boolean; deny?: string; missing?: boolean; rejectProjection?: boolean; workflowError?: Error; readError?: Error } = {}) {
  const run = vi.fn(async () => {
    if (options.workflowError) throw options.workflowError
    return { result: [{ id: record.id }] }
  })
  const rows = () => options.missing ? [] : structuredClone([record])
  const graph = vi.fn(async () => {
    if (options.readError) throw options.readError
    return { data: rows(), metadata: { count: 9, skip: 2, take: 3 } }
  })
  const remoteQuery = vi.fn(async (input: { __value: Record<string, { __args: { take?: number } }> }) => {
    if (options.readError) throw options.readError
    return input.__value[entity].__args.take === undefined ? rows() : { rows: rows(), metadata: { count: 9, skip: 2, take: 3 } }
  })
  const admission = vi.fn(() => { if (options.rejectProjection) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported catalog refetch fields") })
  const evaluate = vi.fn((_principal, policies: { resource: string; operation: string }[]) => !policies.some(policy => policy.operation === options.deny))
  const createRequestScope = vi.fn(() => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), remoteQuery: asValue(remoteQuery), logger: asValue({ error() {}, info() {} }) }))
  const handler = createAdminProductHttpHandler({
    adminCors: "https://admin.example", resolveAdminPrincipal: () => options.anonymous ? undefined : user,
    evaluateAdminPolicies: evaluate, admitVariantRefetchFields: () => undefined,
    admitProductRefetchFields: () => undefined, admitCatalogRefetchFields: admission, createRequestScope,
  })
  return { handler, run, graph, remoteQuery, read: graph, admission, evaluate, createRequestScope }
}

function request(path = "", query = "", body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`https://private.test/admin/product-tags${path}${query ? `?${query}` : ""}`, {
    method, headers: { origin: "https://admin.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function expectRead(f: ReturnType<typeof fixture>, fields: string[], filters: object, pagination?: object) {
  expect(f.graph).toHaveBeenCalledWith({ entity, fields, filters, pagination, withDeleted: undefined, context: undefined }, undefined)
  expect(f.remoteQuery).not.toHaveBeenCalled()
}

describe("pinned native Admin Product Tags HTTP", () => {
  it("lists native pagination defaults and response metadata", async () => {
    const f = fixture()
    const response = await f.handler.handle(request())
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ product_tags: [record], count: 9, offset: 2, limit: 3 })
    expectRead(f, defaults, {}, { skip: 0, take: 20, order: undefined })
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: entity, operation: "read" }]]])
    expect(f.admission).not.toHaveBeenCalled()
    expect(f.run).not.toHaveBeenCalled()
  })

  it("translates native list filters, operators, fields and pagination without mutation", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("", "id[]=one&id[]=two&value=Native&q=search&created_at[$gte]=2026-01-01&updated_at[$lt]=2026-11-01&deleted_at[$eq]=2026-10-01&limit=3&offset=2&order=-value&fields=id,value,metadata"))
    expect(response.status, await response.clone().text()).toBe(200)
    expectRead(f, ["id", "value", "metadata"], { id: ["one", "two"], value: "Native", q: "search", created_at: { $gte: "2026-01-01" }, updated_at: { $lt: "2026-11-01" }, deleted_at: { $eq: "2026-10-01" } }, { skip: 2, take: 3, order: { value: "DESC" } })
    expect(f.run).not.toHaveBeenCalled()
  })

  it("preserves native parseInt pagination decoding without adding an HTTP lower bound", async () => {
    const f = fixture()
    expect((await f.handler.handle(request("", "limit=3suffix&offset=-1"))).status).toBe(200)
    expectRead(f, defaults, {}, { skip: -1, take: 3, order: undefined })
  })

  it("retrieves the native detail projection and preserves absent detail as an empty 200 envelope", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("/" + record.id, "fields=id,value,metadata"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ product_tag: record })
    expectRead(f, ["id", "value", "metadata"], { id: record.id })
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: entity, operation: "read" }]]])
    const missing = fixture({ missing: true })
    const absent = await missing.handler.handle(request("/absent"))
    expect(absent.status).toBe(200)
    expect(await absent.json()).toEqual({})
    expect(missing.run).not.toHaveBeenCalled()
  })

  it("creates through the native workflow after admitting response fields, retaining metadata and the native 200 envelope", async () => {
    const f = fixture()
    const body = { value: record.value, metadata: record.metadata }
    const response = await f.handler.handle(request("", "fields=id,value,metadata", body))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ product_tag: record })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("create-product-tags", { input: { product_tags: [body] } })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(entity, ["id", "value", "metadata"])
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0])
    expectRead(f, ["id", "value", "metadata"], { id: record.id })
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: entity, operation: "create" }]], [user, [{ resource: entity, operation: "create" }]]])
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("admits update fields before the native existence read and dispatches the native selector/update input", async () => {
    const f = fixture()
    const update = { value: "Renamed", metadata: null }
    const response = await f.handler.handle(request("/" + record.id, "fields=id,metadata", update))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ product_tag: record })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-tags", { input: { selector: { id: record.id }, update } })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(entity, ["id", "metadata"])
    expect(f.read).toHaveBeenCalledTimes(2)
    expectRead(f, ["id"], { id: record.id })
    expectRead(f, ["id", "metadata"], { id: record.id })
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0])
    expect(f.read.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[1])
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: entity, operation: "read" }]], [user, [{ resource: entity, operation: "update" }]], [user, [{ resource: entity, operation: "update" }]]])
  })

  it("preserves native missing-update refusal before workflow execution", async () => {
    const f = fixture({ missing: true })
    const response = await f.handler.handle(request("/absent", "", {}))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ type: "not_found", message: 'Product tag with id "absent" not found' })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(entity, defaults)
    expectRead(f, ["id"], { id: "absent" })
    expect(f.read).toHaveBeenCalledTimes(1)
    expect(f.run).not.toHaveBeenCalled()
  })

  it("deletes a missing ID with the native success envelope and no existence read", async () => {
    const f = fixture({ missing: true })
    const response = await f.handler.handle(request("/absent", "", { ids: ["other"] }, "DELETE"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "absent", object: entity, deleted: true })
    expect(f.run).toHaveBeenCalledExactlyOnceWith("delete-product-tags", { input: { ids: ["absent"] } })
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: entity, operation: "read" }]], [user, [{ resource: entity, operation: "delete" }]]])
    expect(f.read).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
  })

  it("requires authentication for all five methods and all native read/write policies before execution", async () => {
    for (const [path, method, body] of [["", "GET", undefined], ["/one", "GET", undefined], ["", "POST", { value: "New" }], ["/one", "POST", {}], ["/one", "DELETE", undefined]] as const) {
      const anonymous = fixture({ anonymous: true })
      expect((await anonymous.handler.handle(request(path, "", body, method))).status).toBe(401)
      expect(anonymous.run).not.toHaveBeenCalled()
      expect(anonymous.read).not.toHaveBeenCalled()
      for (const deny of method === "GET" ? ["read"] : path ? ["read", method === "POST" ? "update" : "delete"] : ["create"]) {
        const f = fixture({ deny })
        expect((await f.handler.handle(request(path, "", body, method))).status).toBe(403)
        expect(f.run).not.toHaveBeenCalled()
        expect(f.read).not.toHaveBeenCalled()
        expect(f.admission).not.toHaveBeenCalled()
      }
    }
  })

  it("preserves strict native create/update bodies before workflow or prefetch", async () => {
    for (const [path, body] of [["", {}], ["", { value: 1 }], ["", { value: "New", unknown: true }], ["", { value: "New", metadata: [] }], ["/one", { value: null }], ["/one", { id: "other" }], ["/one", { additional_data: {} }], ["/one", { metadata: 1 }]] as const) {
      const f = fixture()
      expect((await f.handler.handle(request(path, "", body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.read).not.toHaveBeenCalled()
      expect(f.admission).not.toHaveBeenCalled()
    }
  })

  it("allows omitted, empty and null native metadata and empty partial updates", async () => {
    for (const metadata of [undefined, {}, null]) {
      const f = fixture()
      const body = { value: "Allowed", ...(metadata === undefined ? {} : { metadata }) }
      expect((await f.handler.handle(request("", "", body))).status).toBe(200)
      expect(f.run).toHaveBeenCalledExactlyOnceWith("create-product-tags", { input: { product_tags: [body] } })
      expect(f.admission).toHaveBeenCalledExactlyOnceWith(entity, defaults)
    }
    const f = fixture()
    expect((await f.handler.handle(request("/one", "", {}))).status).toBe(200)
    expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-tags", { input: { selector: { id: "one" }, update: {} } })
  })

  it("rejects malformed queries and unsupported response projections before any write or update existence read", async () => {
    for (const path of ["", "/one"]) {
      const f = fixture({ rejectProjection: true })
      expect((await f.handler.handle(request(path, "fields=id,*products", { value: "New" }))).status).toBe(400)
      expect(f.admission).toHaveBeenCalledExactlyOnceWith(entity, ["id", "products.*"])
      expect(f.run).not.toHaveBeenCalled()
      expect(f.read).not.toHaveBeenCalled()
      for (const query of ["fields=__proto__.x", "fields=id&value=Disallowed", "fields=id&unknown=1"]) {
        const invalid = fixture()
        expect((await invalid.handler.handle(request(path, query, { value: "New" }))).status).toBe(400)
        expect(invalid.run).not.toHaveBeenCalled()
        expect(invalid.read).not.toHaveBeenCalled()
      }
    }
    for (const query of ["limit=invalid", "offset=invalid", "unknown=1"]) {
      const f = fixture()
      expect((await f.handler.handle(request("", query))).status).toBe(400)
      expect(f.read).not.toHaveBeenCalled()
    }
  })

  it("preserves native workflow errors and redacts unknown failures without replay or post-write refetch", async () => {
    for (const [workflowError, status, type] of [[new MedusaError(MedusaError.Types.INVALID_DATA, "Native refusal"), 400, "invalid_data"], [new Error("private workflow detail"), 500, "unknown_error"]] as const) {
      for (const path of ["", "/one"]) {
        const f = fixture({ workflowError })
        const response = await f.handler.handle(request(path, "", { value: "New" }))
        expect(response.status).toBe(status)
        expect(await response.json()).toMatchObject({ type, message: status === 400 ? "Native refusal" : "An unknown error occurred." })
        expect(f.run).toHaveBeenCalledTimes(1)
        expect(f.read).toHaveBeenCalledTimes(path ? 1 : 0)
      }
    }
    const f = fixture({ readError: new Error("private read detail") })
    const response = await f.handler.handle(request("", "", { value: "New" }))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.read).toHaveBeenCalledTimes(1)
  })

  it("serves native namespace CORS preflight without authentication or request scope", async () => {
    const f = fixture({ anonymous: true })
    const response = await f.handler.handle(new Request("https://private.test/admin/product-tags/one", { method: "OPTIONS", headers: { origin: "https://admin.example", "access-control-request-method": "DELETE" } }))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
    expect(response.headers.get("access-control-allow-methods")?.split(",")).toContain("DELETE")
    expect(f.createRequestScope).not.toHaveBeenCalled()
    expect(f.evaluate).not.toHaveBeenCalled()
  })
})
