import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import type { AuthContext } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { createAdminProductHttpHandler } from "../src/admin-product"
import { AdminCreateCollection, AdminUpdateCollection } from "../src/api/admin/collections/validators"
import { createLinkBody } from "../src/api/utils/validators"

const user: AuthContext = { actor_id: "user_taxonomy", actor_type: "user", auth_identity_id: "auth_taxonomy", app_metadata: {}, user_metadata: {} }
const families = [
  {
    path: "product-categories", entity: "product_category", plural: "product_categories", envelope: "product_category", workflow: "product-categories",
    membership: "batch-link-products-to-category", deleteObject: "product_category", limit: 50,
    defaults: ["id", "name", "description", "handle", "is_active", "is_internal", "rank", "parent_category_id", "created_at", "updated_at", "metadata", "parent_category.*", "category_children.*"],
    record: { id: "pcat_native", name: "Native Category", rank: 0, parent_category_id: "pcat_parent", parent_category: { id: "pcat_parent", name: "Parent" }, category_children: [{ id: "pcat_child", name: "Child" }], metadata: { native: true } },
    create: { name: "Native Category" }, update: { name: "Updated Category" },
  },
  {
    path: "collections", entity: "product_collection", plural: "collections", envelope: "collection", workflow: "collections",
    membership: "batch-link-products-collection", deleteObject: "collection", limit: 10,
    defaults: ["id", "title", "handle", "created_at", "updated_at", "metadata"],
    record: { id: "pcol_native", title: "Native Collection", handle: "native-collection", metadata: { native: true } },
    create: { title: "Native Collection" }, update: { title: "Updated Collection" },
  },
] as const

describe.each(families)("pinned native Admin $path HTTP", family => {
  const category = family.entity === "product_category"
  function fixture(options: { anonymous?: boolean; deny?: string; missing?: boolean; rejectProjection?: boolean; workflowError?: Error; readError?: Error } = {}) {
    const run = vi.fn(async () => {
      if (options.workflowError) throw options.workflowError
      return { result: [{ id: family.record.id }] }
    })
    const rows = () => options.missing ? [] : structuredClone([family.record])
    const graph = vi.fn(async () => {
      if (options.readError) throw options.readError
      return { data: rows(), metadata: { count: 9, skip: 2, take: 3 } }
    })
    const remoteQuery = vi.fn(async (input: { __value: Record<string, { __args: { take?: number } }> }) => {
      if (options.readError) throw options.readError
      return input.__value[family.entity].__args.take === undefined ? rows() : { rows: rows(), metadata: { count: 9, skip: 2, take: 3 } }
    })
    const admission = vi.fn(() => {
      if (options.rejectProjection) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unsupported catalog refetch fields")
    })
    const evaluate = vi.fn((_principal, policies: { resource: string; operation: string }[]) => !policies.some(policy => policy.operation === options.deny))
    const createRequestScope = vi.fn(() => createContainer().register({ workflows: asValue({ run }), query: asValue({ graph }), remoteQuery: asValue(remoteQuery), logger: asValue({ error() {}, info() {} }) }))
    const handler = createAdminProductHttpHandler({
      adminCors: "https://admin.example", resolveAdminPrincipal: () => options.anonymous ? undefined : user,
      evaluateAdminPolicies: evaluate, admitSalesChannelRefetchFields: () => undefined,
    admitPriceListRefetchFields: () => undefined,
    admitVariantRefetchFields: () => undefined,
    admitProductRefetchFields: () => undefined, admitCatalogRefetchFields: admission, createRequestScope,
    })
    return { handler, run, graph, remoteQuery, read: category ? graph : remoteQuery, admission, evaluate, createRequestScope }
  }

  function request(path = "", query = "", body?: unknown, method = body === undefined ? "GET" : "POST") {
    return new Request(`https://private.test/admin/${family.path}${path}${query ? `?${query}` : ""}`, {
      method, headers: { origin: "https://admin.example", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  function expectRead(f: ReturnType<typeof fixture>, fields: readonly string[], filters: object, pagination?: object) {
    if (category) {
      expect(f.graph).toHaveBeenCalledWith({ entity: family.entity, fields, filters, pagination, withDeleted: undefined, context: undefined }, undefined)
      expect(f.remoteQuery).not.toHaveBeenCalled()
    } else {
      expect(f.remoteQuery).toHaveBeenCalledWith({ __value: { [family.entity]: { fields, isServiceAccess: false, __args: { filters, ...pagination } } } })
      expect(f.graph).not.toHaveBeenCalled()
    }
  }

  it("lists native pagination defaults, relation fields and response metadata", async () => {
    const f = fixture()
    const response = await f.handler.handle(request())
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ [family.plural]: [family.record], count: 9, offset: 2, limit: 3 })
    expectRead(f, family.defaults, {}, { skip: 0, take: family.limit, order: undefined })
    expect(f.evaluate.mock.calls).toEqual([[user, [{ resource: family.entity, operation: "read" }]]])
    expect(f.run).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
  })

  it("translates native filters, operators, boolean flags, fields and pagination", async () => {
    const f = fixture()
    const extra = category ? "&parent_category_id[]=parent&is_active=TRUE&is_internal=false&include_ancestors_tree=true&include_descendants_tree=false" : "&title=Native"
    const response = await f.handler.handle(request("", "id[]=one&id[]=two&handle=native&q=search&created_at[$gte]=2026-01-01&updated_at[$lt]=2026-11-01&deleted_at[$eq]=2026-10-01&limit=3suffix&offset=2&order=-handle&fields=id,metadata" + extra))
    expect(response.status, await response.clone().text()).toBe(200)
    expectRead(f, ["id", "metadata"], {
      id: ["one", "two"], handle: "native", q: "search", created_at: { $gte: "2026-01-01" }, updated_at: { $lt: "2026-11-01" }, deleted_at: { $eq: "2026-10-01" },
      ...(category ? { parent_category_id: ["parent"], is_active: true, is_internal: false, include_ancestors_tree: true, include_descendants_tree: false } : { title: "Native" }),
    }, { skip: 2, take: 3, order: { handle: "DESC" } })
    expect(f.run).not.toHaveBeenCalled()
  })

  it("retrieves the native detail and preserves each missing-detail behavior", async () => {
    const f = fixture()
    const response = await f.handler.handle(request("/" + family.record.id, "fields=id,metadata"))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ [family.envelope]: family.record })
    expectRead(f, ["id", "metadata"], { id: family.record.id }, category ? {} : undefined)
    const missing = fixture({ missing: true })
    const absent = await missing.handler.handle(request("/absent"))
    expect(absent.status).toBe(category ? 404 : 200)
    expect(await absent.json()).toEqual(category ? { type: "not_found", message: "Product category with id: absent was not found" } : {})
    expect(missing.run).not.toHaveBeenCalled()
  })

  it("creates through the native workflow and admits fields before mutation", async () => {
    const f = fixture()
    const body = { ...family.create, metadata: { nested: { enabled: true } }, additional_data: { source: "native" }, ...(category ? { rank: 1.5, parent_category_id: null } : {}) }
    const response = await f.handler.handle(request("", "fields=id,metadata", body))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ [family.envelope]: family.record })
    const { additional_data, ...rest } = body
    expect(f.run).toHaveBeenCalledExactlyOnceWith(`create-${family.workflow}`, { input: category ? { product_categories: [body] } : { collections: [rest], additional_data } })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(family.entity, ["id", "metadata"])
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0])
    expectRead(f, ["id", "metadata"], { id: family.record.id }, category ? {} : undefined)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
  })

  it("updates with the native existence-read ordering and additional-data placement", async () => {
    const f = fixture()
    const body = { ...family.update, metadata: null, additional_data: { source: "native" } }
    const response = await f.handler.handle(request("/" + family.record.id, "fields=id,metadata", body))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ [family.envelope]: family.record })
    const { additional_data, ...rest } = body
    expect(f.run).toHaveBeenCalledExactlyOnceWith(`update-${family.workflow}`, { input: { selector: { id: family.record.id }, update: category ? body : rest, ...(category ? {} : { additional_data }) } })
    expect(f.admission).toHaveBeenCalledExactlyOnceWith(family.entity, ["id", "metadata"])
    expect(f.read).toHaveBeenCalledTimes(category ? 1 : 2)
    expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    if (!category) {
      expectRead(f, ["id"], { id: family.record.id })
      expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0])
      expect(f.read.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
    }
    expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[category ? 0 : 1])
  })

  it("preserves missing update behavior without adding a category prefetch", async () => {
    const f = fixture({ missing: true })
    const response = await f.handler.handle(request("/absent", "", {}))
    expect(response.status, await response.clone().text()).toBe(category ? 200 : 404)
    if (category) {
      expect(await response.json()).toEqual({})
      expect(f.run).toHaveBeenCalledExactlyOnceWith("update-product-categories", { input: { selector: { id: "absent" }, update: {} } })
      expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0])
    } else {
      expect(await response.json()).toEqual({ type: "not_found", message: 'Collection with id "absent" not found' })
      expect(f.run).not.toHaveBeenCalled()
      expectRead(f, ["id"], { id: "absent" })
    }
    expect(f.read).toHaveBeenCalledTimes(1)
  })

  it("deletes the URL ID with native input/envelope and no existence read", async () => {
    const f = fixture({ missing: true })
    const response = await f.handler.handle(request("/absent", "", { ids: ["other"] }, "DELETE"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "absent", object: family.deleteObject, deleted: true })
    expect(f.run).toHaveBeenCalledExactlyOnceWith(`delete-${family.workflow}`, { input: category ? ["absent"] : { ids: ["absent"] } })
    expect(f.read).not.toHaveBeenCalled()
    expect(f.admission).not.toHaveBeenCalled()
  })

  it("links products with native omitted/empty arms and result refetch", async () => {
    for (const body of [{}, { add: [] }, { remove: [] }, { add: ["prod_add"], remove: ["prod_remove"] }]) {
      const f = fixture()
      const response = await f.handler.handle(request("/" + family.record.id + "/products", "fields=id,metadata", body))
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toEqual({ [family.envelope]: family.record })
      const expected = category ? { id: family.record.id, ...("add" in body ? { add: body.add } : {}), ...("remove" in body ? { remove: body.remove } : {}) } : { id: family.record.id, add: "add" in body ? body.add : [], remove: "remove" in body ? body.remove : [] }
      expect(f.run).toHaveBeenCalledExactlyOnceWith(family.membership, { input: expected })
      expectRead(f, ["id", "metadata"], { id: family.record.id })
      expect(f.admission).toHaveBeenCalledExactlyOnceWith(family.entity, ["id", "metadata"])
      expect(f.admission.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0])
      expect(f.run.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0])
      const policies = f.evaluate.mock.calls.flatMap(([, actions]) => actions)
      expect(policies).toContainEqual({ resource: family.entity, operation: "read" })
      expect(policies).toContainEqual({ resource: family.entity, operation: "update" })
      expect(policies.every(policy => policy.resource === family.entity)).toBe(true)
    }
  })

  it("requires authentication and native read/write policies for all six methods", async () => {
    for (const [path, method, body] of [["", "GET", undefined], ["/one", "GET", undefined], ["", "POST", family.create], ["/one", "POST", {}], ["/one", "DELETE", undefined], ["/one/products", "POST", {}]] as const) {
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

  it("preserves native HTTP strictness for category and collection bodies", async () => {
    for (const path of ["", "/one"]) {
      const f = fixture()
      const body = { ...(path ? family.update : family.create), unknown: true }
      const response = await f.handler.handle(request(path, "", body))
      expect(response.status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.read).not.toHaveBeenCalled()
    }
  })

  it("rejects invalid required fields, metadata, rank and link arms before execution", async () => {
    const invalidBodies = category ? [{}, { name: 1 }, { name: "New", rank: -1 }, { name: "New", rank: null }, { name: "New", parent_category_id: 1 }, { name: "New", metadata: [] }] : [{}, { title: 1 }, { title: "New", metadata: [] }]
    for (const body of invalidBodies) {
      const f = fixture()
      expect((await f.handler.handle(request("", "", body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.read).not.toHaveBeenCalled()
      expect(f.admission).not.toHaveBeenCalled()
    }
    for (const body of [{ add: "prod" }, { remove: [1] }, { add: null }, { add: [], unknown: true }]) {
      const f = fixture()
      expect((await f.handler.handle(request("/one/products", "", body))).status).toBe(400)
      expect(f.run).not.toHaveBeenCalled()
      expect(f.read).not.toHaveBeenCalled()
    }
  })

  it("rejects unsupported response projections before CRUD/membership mutation or collection prefetch", async () => {
    for (const path of ["", "/one", "/one/products"]) {
      const f = fixture({ rejectProjection: true })
      expect((await f.handler.handle(request(path, "fields=id,*products", path.endsWith("/products") ? {} : family.create))).status).toBe(400)
      expect(f.admission).toHaveBeenCalledExactlyOnceWith(family.entity, ["id", "products.*"])
      expect(f.run).not.toHaveBeenCalled()
      expect(f.read).not.toHaveBeenCalled()
    }
    for (const query of ["limit=invalid", "offset=invalid", "unknown=1", ...(category ? ["is_active=invalid"] : [])]) {
      const f = fixture()
      expect((await f.handler.handle(request("", query))).status).toBe(400)
      expect(f.read).not.toHaveBeenCalled()
    }
  })

  it("preserves native workflow failures and redacts unknown failures without retry or post-write refetch", async () => {
    for (const [workflowError, status, type] of [[new MedusaError(MedusaError.Types.INVALID_DATA, "Native refusal"), 400, "invalid_data"], [new Error("private workflow detail"), 500, "unknown_error"]] as const) {
      for (const path of ["", "/one", "/one/products"]) {
        const f = fixture({ workflowError })
        const response = await f.handler.handle(request(path, "", path.endsWith("/products") ? {} : family.create))
        expect(response.status).toBe(status)
        expect(await response.json()).toMatchObject({ type, message: status === 400 ? "Native refusal" : "An unknown error occurred." })
        expect(f.run).toHaveBeenCalledTimes(1)
        expect(f.read).toHaveBeenCalledTimes(!category && path === "/one" ? 1 : 0)
      }
    }
    const f = fixture({ readError: new Error("private read detail") })
    const response = await f.handler.handle(request("", "", family.create))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ type: "unknown_error", message: "An unknown error occurred." })
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(f.read).toHaveBeenCalledTimes(1)
  })

  it("serves namespace CORS preflight without authentication or scope construction", async () => {
    const f = fixture({ anonymous: true })
    const response = await f.handler.handle(new Request(`https://private.test/admin/${family.path}/one`, { method: "OPTIONS", headers: { origin: "https://admin.example", "access-control-request-method": "DELETE" } }))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.example")
    expect(response.headers.get("access-control-allow-methods")?.split(",")).toContain("DELETE")
    expect(f.createRequestScope).not.toHaveBeenCalled()
    expect(f.evaluate).not.toHaveBeenCalled()
  })
})

it("retains native collection and link schema stripping before the HTTP owner's strict object policy", () => {
  expect(AdminCreateCollection().parse({ title: "Native", unknown: true })).toEqual({ title: "Native" })
  expect(AdminUpdateCollection().parse({ metadata: null, unknown: true })).toEqual({ metadata: null })
  expect(createLinkBody().parse({ add: [], unknown: true })).toEqual({ add: [] })
})
