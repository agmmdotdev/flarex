import { Effect, type Scope } from "effect"
import { HttpEffect, HttpRouter } from "effect/unstable/http"
import { createStoreProductHttpHandler, type StoreProductHttpOptions } from "./store-product.js"

export interface StoreProductEffectHttpHandler {
  readonly handler: (request: Request) => Promise<Response>
}

/** Host scope owns the existing Effect router; native middleware owns requests. */
export const makeStoreProductEffectHttpHandler = Effect.fn("MedusaHttp.makeStoreProductHost")(function* (
  options: StoreProductHttpOptions,
): Effect.fn.Return<StoreProductEffectHttpHandler, never, Scope.Scope> {
  const native = createStoreProductHttpHandler(options)
  const namespace = HttpRouter.add("*", "/store/*", HttpEffect.fromWebHandler(native.handle))
  const host = yield* Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(namespace, { disableLogger: true })),
    host => Effect.promise(host.dispose),
  )
  return Object.freeze({ handler: host.handler })
})
