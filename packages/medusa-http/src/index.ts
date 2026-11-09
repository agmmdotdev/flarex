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
import { withMedusaNamespaceCors } from "./cors"
import { storeCurrencyHttpManifest } from "./static-manifest.generated"

export type StoreCurrencyHttpOptions = FetchHttpAdapterOptions & {
  storeCors: string
}

/** Private Store read composition; the caller supplies a fresh, bounded scope. */
export function createStoreCurrencyHttpHandler(options: StoreCurrencyHttpOptions): FetchHttpStaticHandler {
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
  return withMedusaNamespaceCors(core, options.storeCors, ["GET"])
}

export { storeCurrencyHttpManifest } from "./static-manifest.generated"
