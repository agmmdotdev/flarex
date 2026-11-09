import { describe, expect, it } from "vitest"
import { z } from "@medusajs/deps/zod"
import { MedusaError } from "@medusajs/utils/common/errors"
import { createFetchHttpStaticHandler } from "../src/http/fetch"
import { authenticate } from "../src/http/middlewares/authenticate-middleware"
import { validateAndTransformQuery } from "../src/http/utils/validate-query"
import type { MedusaRequest, MiddlewareFunction, RouteHandler } from "../src/http/types"
import { asValue, createContainer } from "@medusajs/deps/awilix-portable"
import { FieldParser } from "../src/http/utils/field-parser"

const scope: MedusaRequest["scope"] = createContainer().register({ logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }) })
function handler(middlewares: MiddlewareFunction[] = [], GET: RouteHandler = (req, res) => { res.json({ params: req.params, query: req.query }) }) {
  return createFetchHttpStaticHandler({
    createRequestScope: () => scope,
    manifest: {
      routes: [{ route: "/store/currencies/:code", module: { GET } }, { route: "/store/currencies", module: { GET } }],
      middlewares: [{ module: { default: { routes: [{ matcher: "/store", middlewares }] } } }],
    },
  })
}
describe("selected pinned Fetch HTTP profile", () => {
  // Checked against pinned http/utils/field-filtering/field-parser.ts at SOURCE.json.
  it("retains pinned field-parser default, replacement, modifier and relation vectors", () => {
    const vectors: [string | undefined, string[], string[]][] = [
      [undefined, ["code", "name", "region.name"], []], ["", ["id"], []],
      ["code,name", ["code", "name", "id"], []], ["-name", ["code", "region.name", "id"], []],
      ["+symbol", ["code", "name", "region.name", "symbol", "id"], []],
      [" symbol", ["code", "name", "region.name", "symbol", "id"], []],
      ["*region", ["code", "name", "region.name", "id"], ["region"]],
      ["region.*", ["code", "name", "region.name", "id"], ["region"]],
      ["-region", ["code", "name", "id"], []], ["code,*region", ["code", "id"], ["region"]],
      ["-id,+name", ["code", "name", "region.name", "id"], []],
    ]
    for (const [fields, expected, stars] of vectors) {
      expect(FieldParser.parse(fields, ["code", "name", "region.name"])).toEqual({ fields: new Set(expected), starFields: new Set(stars) })
    }
  })
  it("matches pinned existing-context/session precedence and wrong-actor behavior", async () => {
    const customer = { actor_id: "cus_1", actor_type: "customer", auth_identity_id: "auth_1", app_metadata: {}, user_metadata: {} }
    const otherCustomer = { ...customer, actor_id: "cus_2" }
    const user = { ...customer, actor_id: "user_1", actor_type: "user" }
    // Checked against pinned http/middlewares/authenticate-middleware.ts.
    for (const [existing, session, expected] of [[customer, otherCustomer, customer], [user, customer, customer], [undefined, customer, customer], [user, user, undefined], [undefined, undefined, undefined]]) {
      const middleware = authenticate("customer", ["bearer", "session"])
      const http = createFetchHttpStaticHandler({ createRequestScope: () => scope,
        createSession: () => session ? { auth_context: session } : undefined,
        prepareRequest(req) { req.auth_context = existing },
        manifest: { routes: [{ route: "/store/currencies", module: { GET: (req: MedusaRequest, res: Parameters<RouteHandler>[1]) => { res.json({ auth: req.auth_context }) } } }],
          middlewares: [{ module: { default: { routes: [{ matcher: "/store", middlewares: [middleware] }] } } }] },
      })
      const response = await http.handle(new Request("https://medusa.test/store/currencies"))
      expect(response.status).toBe(expected ? 200 : 401)
      expect(await response.json()).toEqual(expected ? { auth: expected } : { message: "Unauthorized" })
    }
  })
  it("preserves namespace, exact route middleware, and handler ordering", async () => {
    const events: string[] = []
    const http = createFetchHttpStaticHandler({ createRequestScope: () => scope, manifest: {
      routes: [{ route: "/store/currencies/:code", module: { GET: (_req, res) => { events.push("handler"); res.json({ ok: true }) } } }],
      middlewares: [{ module: { default: { routes: [
        { matcher: "/store/currencies/:code", method: ["GET"], middlewares: [(_req, _res, next) => { events.push("exact"); next() }] },
        { matcher: "/store", middlewares: [(_req, _res, next) => { events.push("namespace"); next() }] },
      ] } } }],
    } })
    expect((await http.handle(new Request("https://medusa.test/store/currencies/usd"))).status).toBe(200)
    expect(events).toEqual(["namespace", "exact", "handler"])
  })
  it("decodes route parameters and preserves bracket/repeated query forms", async () => {
    const response = await handler().handle(new Request("https://medusa.test/store/currencies/%75sd?code[]=usd&code[]=eur&$and[0][code]=usd"))
    expect(await response.json()).toEqual({ params: { code: "usd" }, query: { code: ["usd", "eur"], $and: [{ code: "usd" }] } })
  })
  it.each(["__proto__[polluted]", "constructor[prototype][polluted]", "code[999999999]", "a[b][c][d][e][f][g][h][i]"])("rejects hostile or unbounded query key %s before middleware", async (key) => {
    let called = false
    const response = await handler([(_req, _res, next) => { called = true; next() }]).handle(new Request(`https://medusa.test/store/currencies?${key}=yes`))
    expect(response.status).toBe(400)
    expect(called).toBe(false)
    expect(Object.getPrototypeOf({})).not.toHaveProperty("polluted")
  })
  it("bounds query bytes and parameter count", async () => {
    for (const query of ["q=" + "x".repeat(16384), Array.from({ length: 129 }, (_, index) => `q=${index}`).join("&")]) {
      expect((await handler().handle(new Request(`https://medusa.test/store/currencies?${query}`))).status).toBe(400)
    }
  })
  it.each(["fields=__proto__.polluted", "fields=*constructor.prototype.polluted", "order=-__proto__.polluted", "order=constructor.prototype.polluted"])("rejects hostile selector %s without prototype mutation", async (query) => {
    const validate = validateAndTransformQuery(z.object({ fields: z.string().optional(), order: z.string().optional() }), { isList: true, defaults: ["code"] })
    const response = await handler([validate]).handle(new Request(`https://medusa.test/store/currencies?${query}`))
    expect(response.status).toBe(400)
    expect({}).not.toHaveProperty("polluted")
  })
  it("preserves native dot-query nesting and nested-order conversion", async () => {
    const validate = validateAndTransformQuery(z.object({ order: z.string().optional(), filter: z.object({ code: z.string() }).optional() }), { isList: true, defaults: ["code", "region.name"] })
    const response = await handler([validate], (req, res) => { res.json({ filters: req.filterableFields, list: req.listConfig, config: req.queryConfig }) }).handle(new Request("https://medusa.test/store/currencies?filter.code=usd&order=-region.name"))
    expect(await response.json()).toEqual({ filters: { filter: { code: "usd" } }, list: { select: ["code", "region.name"], relations: ["region"], skip: 0, take: 50, order: { region: { name: "DESC" } } }, config: { fields: ["code", "region.name"], pagination: { skip: 0, take: 50, order: { region: { name: "DESC" } } } } })
  })
  it("does not dispatch unsupported methods, paths or malformed URI parameters", async () => {
    const http = handler()
    expect((await http.handle(new Request("https://medusa.test/store/currencies", { method: "POST", body: "ignored" }))).status).toBe(404)
    expect((await http.handle(new Request("https://medusa.test/store/currencies/%ZZ"))).status).toBe(404)
    expect(await http.tryHandle(new Request("https://medusa.test/admin/currencies"))).toBeUndefined()
  })
  it("stops at handled middleware and maps native versus unknown errors", async () => {
    let called = false
    const response = await handler([(_req, res) => { res.status(401).json({ message: "Unauthorized" }) }], () => { called = true }).handle(new Request("https://medusa.test/store/currencies"))
    expect(response.status).toBe(401)
    expect(called).toBe(false)
    for (const [error, status, payload] of [
      [new MedusaError(MedusaError.Types.NOT_FOUND, "Currency absent"), 404, { type: "not_found", message: "Currency absent" }],
      [new Error("secret diagnostics"), 500, { code: "unknown_error", type: "unknown_error", message: "An unknown error occurred." }],
    ] as const) {
      const result = await handler([], () => { throw error }).handle(new Request("https://medusa.test/store/currencies"))
      expect(result.status).toBe(status)
      expect(await result.json()).toEqual(payload)
    }
  })
  it("uses strict native Zod errors and scalar query defaults/field modifiers", async () => {
    const validate = validateAndTransformQuery(z.object({ fields: z.string().optional(), offset: z.coerce.number().default(0), limit: z.coerce.number().default(50), code: z.union([z.string(), z.array(z.string())]).optional() }), { isList: true, defaults: ["code", "name"] })
    const http = handler([validate], (req, res) => { res.json({ filters: req.filterableFields, config: req.queryConfig }) })
    const response = await http.handle(new Request("https://medusa.test/store/currencies?fields=-name&code[]=usd,eur&limit=2"))
    expect(await response.json()).toEqual({ filters: { code: ["usd", "eur"] }, config: { fields: ["code", "id"], pagination: { skip: 0, take: 2 } } })
    const invalid = await http.handle(new Request("https://medusa.test/store/currencies?unexpected=true"))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ type: "invalid_data", message: "Invalid request: Unrecognized fields: 'unexpected'" })
  })
  it("does not authenticate a decoder-only bearer token; trusts verified prepared context and sessions", async () => {
    const auth = authenticate("customer", ["bearer", "session"])
    const http = handler([auth])
    expect((await http.handle(new Request("https://medusa.test/store/currencies", { headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.invalid.signature" } }))).status).toBe(401)
    const prepared = createFetchHttpStaticHandler({ createRequestScope: () => scope,
      prepareRequest(req) { req.auth_context = { actor_id: "cus_1", actor_type: "customer", auth_identity_id: "auth_1", app_metadata: {}, user_metadata: {} } },
      manifest: { routes: [{ route: "/store/currencies", module: { GET: (_req, res) => { res.json({ ok: true }) } } }], middlewares: [{ module: { default: { routes: [{ matcher: "/store", middlewares: [auth] }] } } }] },
    })
    expect((await prepared.handle(new Request("https://medusa.test/store/currencies"))).status).toBe(200)
  })
})
