import { Effect, type Scope } from "effect"
import { HttpEffect, HttpRouter } from "effect/unstable/http"
import { createStoreCurrencyHttpHandler, type StoreCurrencyHttpOptions } from "./index.js"

export interface StoreCurrencyEffectHttpHandler {
  readonly handler: (request: Request) => Promise<Response>
}

/** The host owns this scope; native Medusa owns all routing below /store. */
export const makeStoreCurrencyEffectHttpHandler = Effect.fn("MedusaHttp.makeStoreCurrencyHost")(function* (
  options: StoreCurrencyHttpOptions,
): Effect.fn.Return<StoreCurrencyEffectHttpHandler, never, Scope.Scope> {
  const native = createStoreCurrencyHttpHandler(options)
  const namespace = HttpRouter.add("*", "/store/*", HttpEffect.fromWebHandler(native.handle))
  const host = yield* Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(namespace, { disableLogger: true })),
    host => Effect.promise(host.dispose),
  )
  return Object.freeze({ handler: host.handler })
})
