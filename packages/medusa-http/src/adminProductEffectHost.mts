import { Effect, type Scope } from "effect"
import { HttpEffect, HttpRouter } from "effect/unstable/http"
import { createAdminProductHttpHandler, type AdminProductHttpOptions } from "./admin-product.js"

export interface AdminProductEffectHttpHandler {
  readonly handler: (request: Request) => Promise<Response>
}

/** The host owns the scope; the native pipeline owns the complete admin route. */
export const makeAdminProductEffectHttpHandler = Effect.fn("MedusaHttp.makeAdminProductHost")(function* (
  options: AdminProductHttpOptions,
): Effect.fn.Return<AdminProductEffectHttpHandler, never, Scope.Scope> {
  const native = createAdminProductHttpHandler(options)
  const namespace = HttpRouter.add("*", "/admin/*", HttpEffect.fromWebHandler(native.handle))
  const host = yield* Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(namespace, { disableLogger: true })),
    host => Effect.promise(host.dispose),
  )
  return Object.freeze({ handler: host.handler })
})
