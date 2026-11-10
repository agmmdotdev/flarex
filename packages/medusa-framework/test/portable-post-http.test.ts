import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { z } from "@medusajs/deps/zod"
import { MedusaError } from "@medusajs/utils/common/errors"
import { describe, expect, it, vi } from "vitest"
import { authenticate } from "../src/http/middlewares/authenticate-middleware"
import { createFetchHttpStaticHandler, type FetchHttpAdapterOptions } from "../src/http/fetch"
import { validateAndTransformBody } from "../src/http/utils/validate-body"
import { validateAndTransformQuery } from "../src/http/utils/validate-query"
import { refetchEntities, refetchEntity } from "../src/http/utils/refetch-entities"
import { buildStaticHttpResources } from "../src/http/utils/static-http-resources"
import type { MedusaRequest, MiddlewareFunction, PolicyAction } from "../src/http/types"

const user = { actor_id: "usr_1", actor_type: "user", auth_identity_id: "auth_1", app_metadata: { roles: ["role_1"] }, user_metadata: {} }
const policies: PolicyAction[] = [{ resource: "product", operation: "create" }]
const logger = { error: vi.fn(), info: vi.fn() }
const scope: MedusaRequest["scope"] = createContainer().register({ logger: asValue(logger) })
const query = validateAndTransformQuery(z.object({ fields: z.string().optional() }), { defaults: ["id", "title"] })
const body = validateAndTransformBody(z.object({ title: z.string().transform(value => value.trim()) }))
const request = (value: string, headers: Record<string, string> = { "content-type": "application/json" }) => new Request("https://private.test/admin/products", { method: "POST", headers, body: value })
function fixture(options: Partial<FetchHttpAdapterOptions> = {}, middlewares: MiddlewareFunction[] = [body, query]) {
  const write = vi.fn((req: MedusaRequest) => ({ body: req.validatedBody, query: req.queryConfig }))
  const handler = createFetchHttpStaticHandler({
    createRequestScope: () => scope, allowedMethods: ["POST"], verifyPolicies: () => undefined,
    prepareRequest(req) { req.auth_context = user }, ...options,
    manifest: { routes: [{ route: "/admin/products", module: { POST: (req: MedusaRequest, res: { json(value: unknown): unknown }) => { res.json(write(req)) } } }],
      middlewares: [{ module: { default: { routes: [
        { matcher: "/admin", middlewares: [authenticate("user", ["bearer", "session"])] },
        { matcher: "/admin/products", method: ["POST"], policies, middlewares },
      ] } } }] },
  })
  return { handler, write }
}

describe("selected pinned JSON POST plumbing", () => {
  it("retains native sizeLimit metadata without disabling JSON parsing or widening the private host cap", async () => {
    const manifest = {
      routes: [{ route: "/admin/products", module: { POST: (req: MedusaRequest, res: { json(value: unknown): unknown }) => res.json(req.body) } }],
      middlewares: [{ module: { default: { routes: [{ matcher: "/admin/products", method: "POST" as const,
        bodyParser: { sizeLimit: "2mb" } }] } } }],
    }
    expect(buildStaticHttpResources(manifest).bodyParserConfigRoutes[0]?.config).toEqual({ sizeLimit: "2mb" })
    const handler = createFetchHttpStaticHandler({ manifest, allowedMethods: ["POST"], createRequestScope: () => scope, jsonBodyLimitBytes: 8 })
    const parsed = await handler.handle(request('{"a":1}'))
    expect(parsed.status).toBe(200)
    expect(await parsed.json()).toEqual({ a: 1 })
    expect((await handler.handle(request('{"long":true}'))).status).toBe(413)
    const disabled = createFetchHttpStaticHandler({ manifest: { ...manifest, middlewares: [{ module: { default: { routes: [
      { matcher: "/admin/products", method: "POST", bodyParser: false },
    ] } } }] }, allowedMethods: ["POST"], createRequestScope: () => scope, jsonBodyLimitBytes: 8 })
    expect(await (await disabled.handle(request('{"long":true}'))).json()).toBeNull()
    const specific = createFetchHttpStaticHandler({ manifest: { ...manifest, middlewares: [{ module: { default: { routes: [
      { matcher: "/admin/*", method: "POST", bodyParser: false },
      { matcher: "/admin/products", method: "POST", bodyParser: { sizeLimit: "2mb" } },
    ] } } }] }, allowedMethods: ["POST"], createRequestScope: () => scope })
    expect(await (await specific.handle(request('{"a":1}'))).json()).toEqual({ a: 1 })
  })
  it("keeps POST admission explicit and bounds host body settings", () => {
    const manifest = { routes: [{ route: "/admin/products", module: { POST() {} } }] }
    expect(() => createFetchHttpStaticHandler({ manifest, createRequestScope: () => scope })).toThrow("unadmitted HTTP method")
    for (const jsonBodyLimitBytes of [0, 1.5, 1048577, Infinity]) {
      expect(() => fixture({ jsonBodyLimitBytes })).toThrow("JSON body limit")
    }
  })
  it("preserves pinned body/prepare/auth/policy/body-validation/query/handler order", async () => {
    const events: string[] = []
    const f = fixture({
      prepareRequest(req) { events.push("prepare"); expect(req.body).toEqual({ title: " Native Product " }); req.auth_context = user },
      verifyPolicies(req, required) { events.push("policies"); expect(req.auth_context).toEqual(user); expect(required).toEqual(policies) },
    }, [(req, _res, next) => { events.push("body"); return body(req, _res, next) }, query])
    const response = await f.handler.handle(request('{"title":" Native Product "}'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ body: { title: "Native Product" }, query: { fields: ["id", "title"], pagination: {} } })
    expect(events).toEqual(["prepare", "policies", "body", "policies"])
    expect(f.write).toHaveBeenCalledOnce()
  })
  it("refuses absent/wrong actors before the policy verifier and handler", async () => {
    for (const actor of [undefined, { ...user, actor_type: "customer" }]) {
      const verifyPolicies = vi.fn()
      const f = fixture({ prepareRequest(req) { if (actor) req.auth_context = actor }, verifyPolicies })
      const response = await f.handler.handle(request('{"title":"Native"}'))
      expect(response.status).toBe(401)
      expect(verifyPolicies).not.toHaveBeenCalled()
      expect(f.write).not.toHaveBeenCalled()
    }
  })
  it("fails closed for missing/denied policy verification and unverified request metadata", async () => {
    expect(() => fixture({ verifyPolicies: undefined })).toThrow("require an injected verifier")
    const denied = fixture({ verifyPolicies() { throw new MedusaError(MedusaError.Types.FORBIDDEN, "Forbidden") } })
    expect((await denied.handler.handle(request('{"title":"Native"}'))).status).toBe(403)
    expect(denied.write).not.toHaveBeenCalled()
    const unverified = fixture({ prepareRequest(req) { req.auth_context = user; req.policies = policies } })
    expect((await unverified.handler.handle(request('{"title":"Native"}'))).status).toBe(400)
    expect(unverified.write).not.toHaveBeenCalled()
  })
  it("validates the body before query parameters and supports native additional-data factories", async () => {
    const f = fixture()
    const response = await f.handler.handle(new Request("https://private.test/admin/products?unknown=yes", { method: "POST", headers: { "content-type": "application/json" }, body: '{"title":42}' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: "Invalid request: Expected type: 'string' for field 'title', got: 'number'" })
    expect(f.write).not.toHaveBeenCalled()
    const factory = fixture({}, [validateAndTransformBody(custom => z.object({ title: z.string(), additional_data: custom ?? z.record(z.unknown()).nullish() })), query])
    expect(await (await factory.handler.handle(request('{"title":"Native","additional_data":{"note":"kept"}}'))).json()).toMatchObject({ body: { title: "Native", additional_data: { note: "kept" } } })
  })
  // Isolated pinned Express json + errorHandler execution also produced this 500.
  it("retains native malformed-JSON 500 while excluding raw JSON from diagnostics", async () => {
    logger.error.mockClear()
    const f = fixture()
    const response = await f.handler.handle(request('{"secret-sensitive-input":'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ code: "unknown_error", type: "unknown_error", message: "An unknown error occurred." })
    expect(String(logger.error.mock.calls[0]?.[0])).not.toContain("secret-sensitive-input")
    expect(f.write).not.toHaveBeenCalled()
  })
  it("refuses declared/streamed oversize bodies before preparation and cancels the reader", async () => {
    const prepareRequest = vi.fn()
    const declared = fixture({ jsonBodyLimitBytes: 8, prepareRequest })
    expect((await declared.handler.handle(request('{"title":"Native"}', { "content-type": "application/json", "content-length": "18" }))).status).toBe(413)
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"title":"')); controller.enqueue(new TextEncoder().encode('NATIVE"}')) }, cancel,
    })
    const init: RequestInit & { duplex: "half" } = { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" }
    const streamed = fixture({ jsonBodyLimitBytes: 12, prepareRequest })
    expect((await streamed.handler.handle(new Request("https://private.test/admin/products", init))).status).toBe(413)
    expect(cancel).toHaveBeenCalledOnce()
    expect(prepareRequest).not.toHaveBeenCalled()
    expect(streamed.write).not.toHaveBeenCalled()
  })
  it("preserves native Product graph refetch filtering/context and failure propagation", async () => {
    const product = { id: "prod_1", title: "Native" }
    const graph = vi.fn(async () => ({ data: [product] }))
    const graphScope: MedusaRequest["scope"] = createContainer().register({ query: asValue({ graph }) })
    expect(await refetchEntity<typeof product>({ entity: "product", idOrFilter: { id: "prod_1", context: { locale: "en" } }, fields: ["id", "title"], scope: graphScope })).toEqual(product)
    expect(graph).toHaveBeenCalledWith({ entity: "product", fields: ["id", "title"], filters: { id: "prod_1" }, pagination: undefined, withDeleted: undefined, context: { locale: "en" } }, undefined)
    const failure = new Error("graph unavailable")
    graph.mockRejectedValueOnce(failure)
    await expect(refetchEntity({ entity: "product", idOrFilter: "prod_1", fields: ["id"], scope: graphScope })).rejects.toBe(failure)
  })

  it("allows native empty detail reads and carries independent list metadata", async () => {
    const graph = vi.fn(async (): Promise<{ data: { id: string }[]; metadata?: { count: number; skip: number; take: number } }> => ({ data: [], metadata: { count: 4, skip: 8, take: 2 } }))
    const graphScope: MedusaRequest["scope"] = createContainer().register({ query: asValue({ graph }) })
    expect(await refetchEntity({ entity: "product", idOrFilter: "missing", fields: ["id"], scope: graphScope })).toBeUndefined()
    expect(await refetchEntities({ entity: "product", idOrFilter: { title: "Absent" }, fields: ["id"], pagination: { skip: 8, take: 2 }, withDeleted: true, scope: graphScope })).toEqual({ data: [], metadata: { count: 4, skip: 8, take: 2 } })
    expect(graph).toHaveBeenLastCalledWith({ entity: "product", fields: ["id"], filters: { title: "Absent" }, pagination: { skip: 8, take: 2 }, withDeleted: true, context: undefined }, undefined)
    graph.mockResolvedValueOnce({ data: [], metadata: undefined })
    expect(await refetchEntities({ entity: "product", scope: graphScope })).toEqual({ data: [], metadata: {} })
  })
})
