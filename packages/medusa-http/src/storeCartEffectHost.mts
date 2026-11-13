import { Effect, type Scope } from "effect"
import { HttpEffect, HttpRouter } from "effect/http"
import { createStoreCartHttpHandler, type StoreCartHttpOptions } from "./store-cart.js"

export interface StoreCartEffectHttpHandler {
  readonly handler: (request: Request) => Promise<Response>
}

/** The host owns the Effect router; native middleware owns each request. */
export const makeStoreCartEffectHttpHandler = Effect.fn("MedusaHttp.makeStoreCartHost")(function* (
  options: StoreCartHttpOptions,
): Effect.fn.Return<StoreCartEffectHttpHandler, never, Scope.Scope> {
  const native = createStoreCartHttpHandler(options)
  const namespace = HttpRouter.add("*", "/store/*", HttpEffect.fromWebHandler(native.handle))
  const host = yield* Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(namespace, { disableLogger: true })),
    host => Effect.promise(host.dispose),
  )
  return Object.freeze({ handler: host.handler })
})
