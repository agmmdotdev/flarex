import { MedusaError } from "@medusajs/utils/common/errors"
import { errorHandler } from "./middlewares/error-handler"
import { matchStaticHttpPath } from "./utils/static-http-path-matcher"
import { parseFetchQuery } from "./utils/fetch-query"
import { buildStaticHttpResources, sortHttpResources, type StaticHttpResourceManifest } from "./utils/static-http-resources"
import type { MedusaRequest, MedusaResponse, MiddlewareDescriptor } from "./types"

export type FetchHttpAdapterOptions = {
  createRequestScope(request: Request): MedusaRequest["scope"]
  createSession?(request: Request): MedusaRequest["session"]
  prepareRequest?(request: MedusaRequest, fetchRequest: Request): Promise<void> | void
}
export type FetchHttpStaticHandler = {
  handle(request: Request): Promise<Response>
  tryHandle(request: Request): Promise<Response | undefined>
  isPathHandled(pathname: string): boolean
}
export function createFetchHttpStaticHandler(options: FetchHttpAdapterOptions & { manifest: StaticHttpResourceManifest }): FetchHttpStaticHandler {
  const resources = buildStaticHttpResources(options.manifest)
  // This profile deliberately admits bodyless Store reads only.
  if (resources.routes.some((route) => route.method !== "GET")) throw new Error("The private static HTTP profile supports GET routes only")
  const sorted = sortHttpResources(resources)
  const onError = resources.errorHandler || errorHandler()
  const isPathHandled = (pathname: string) => resources.routes.some((route) => matchStaticHttpPath(route.matcher, pathname) !== undefined)
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const routeIndex = sorted.findIndex((resource) => "isRoute" in resource && resource.method === request.method.toUpperCase() && matchStaticHttpPath(resource.matcher, url.pathname) !== undefined)
    const route = sorted[routeIndex]
    if (!route || !("isRoute" in route)) return new Response("Not Found", { status: 404 })
    let status = 200
    let body: string | undefined
    const headers = new Headers()
    const res: MedusaResponse = {
      status(code) { status = code; return res },
      json(value) { headers.set("content-type", "application/json; charset=utf-8"); body = JSON.stringify(value ?? null); return res },
      setHeader(name, value) { headers.set(name, value) },
      getHeader(name) { return headers.get(name) },
    }
    const req: MedusaRequest = {
      method: request.method, url: `${url.pathname}${url.search}`, originalUrl: `${url.pathname}${url.search}`,
      path: url.pathname, protocol: url.protocol.replace(/:$/, ""), params: {}, query: {},
      headers: Object.fromEntries(request.headers.entries()), get: (name) => request.headers.get(name) ?? undefined,
      scope: options.createRequestScope(request), session: options.createSession?.(request),
      validatedQuery: {}, filterableFields: {}, allowedProperties: [], errors: [], listConfig: {}, retrieveConfig: {},
      queryConfig: { fields: [], pagination: { skip: 0 } }, remoteQueryConfig: { fields: [], pagination: { skip: 0 } }, context: {},
    }
    req.remoteQueryConfig = req.queryConfig
    try {
      req.params = matchStaticHttpPath(route.matcher, url.pathname) ?? {}
      if (new TextEncoder().encode(url.search).byteLength > 16384) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Query string exceeds the private HTTP limit")
      req.query = parseFetchQuery(url.searchParams)
      await options.prepareRequest?.(req, request)
      let proceed = true
      for (const middleware of sorted.slice(0, routeIndex)) {
        if ("isRoute" in middleware || !matchesMiddleware(middleware, request.method, url.pathname)) continue
        let nextCalled = false
        let nextError: unknown
        await middleware.handler(req, res, (error) => { nextCalled = true; nextError = error })
        if (nextError) throw nextError
        if (!nextCalled) { proceed = false; break }
      }
      if (proceed) await route.handler(req, res)
    } catch (error) {
      await onError(error, req, res, (nextError) => { if (nextError) throw nextError })
    }
    return new Response(body, { status, headers })
  }
  return { handle, isPathHandled, async tryHandle(request) {
    return isPathHandled(new URL(request.url).pathname) ? handle(request) : undefined
  } }
}
function matchesMiddleware(middleware: MiddlewareDescriptor, method: string, pathname: string): boolean {
  const methods = middleware.methods === undefined ? undefined : Array.isArray(middleware.methods) ? middleware.methods : [middleware.methods]
  return (!methods || methods.some((item) => item === "ALL" || item === "USE" || item === method.toUpperCase())) &&
    matchStaticHttpPath(middleware.matcher, pathname, { partial: middleware.pathMatching === "prefix" }) !== undefined
}
