import {
  applyLocale,
  authenticate,
  ensurePublishableApiKeyMiddleware,
} from "@medusajs/framework/http"
import {
  createFetchHttpStaticHandler,
  type FetchHttpAdapterOptions,
  type FetchHttpStaticHandler,
} from "@medusajs/framework/http/fetch"
import { parseCorsOrigins } from "@medusajs/utils/common/parse-cors-origins"
import { storeCurrencyHttpManifest } from "./static-manifest.generated"

export type StoreCurrencyHttpOptions = FetchHttpAdapterOptions & {
  storeCors: string
}

/** Private Store read composition; the caller supplies a fresh, bounded scope. */
export function createStoreCurrencyHttpHandler(options: StoreCurrencyHttpOptions): FetchHttpStaticHandler {
  const origins = parseCorsOrigins(options.storeCors)
  const core = createFetchHttpStaticHandler({
    ...options,
    manifest: {
      routes: storeCurrencyHttpManifest.routes,
      middlewares: [
        { module: { default: { routes: [{
          matcher: "/store",
          middlewares: [
            ensurePublishableApiKeyMiddleware,
            applyLocale,
            authenticate("customer", ["bearer", "session"], { allowUnauthenticated: true }),
          ],
        }] } } },
        ...storeCurrencyHttpManifest.middlewares,
      ],
    },
  })
  const handle = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname
    const preflight = request.method === "OPTIONS" &&
      request.headers.get("access-control-request-method") === "GET"
    const corsApplies = core.isPathHandled(path) && (request.method === "GET" || preflight)
    const response = preflight && corsApplies
      ? new Response(null, { status: 204 })
      : await core.handle(request)
    if (!corsApplies) return response
    const headers = new Headers(response.headers)
    const origin = request.headers.get("origin")
    const allowed = origin && origins.some((entry) => typeof entry === "string"
      ? entry === origin
      : new RegExp(entry.source, entry.flags).test(origin))
    if (allowed) headers.set("access-control-allow-origin", origin)
    headers.set("access-control-allow-credentials", "true")
    headers.append("vary", "Origin")
    if (preflight) {
      headers.set("access-control-allow-methods", "GET,HEAD,PUT,PATCH,POST,DELETE")
      const requestedHeaders = request.headers.get("access-control-request-headers")
      if (requestedHeaders) headers.set("access-control-allow-headers", requestedHeaders)
      headers.append("vary", "Access-Control-Request-Headers")
      headers.set("content-length", "0")
    }
    return new Response(response.body, { status: response.status, headers })
  }
  return {
    handle,
    isPathHandled: core.isPathHandled,
    async tryHandle(request) {
      return core.isPathHandled(new URL(request.url).pathname) ? handle(request) : undefined
    },
  }
}

export { storeCurrencyHttpManifest } from "./static-manifest.generated"
