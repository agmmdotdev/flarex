import { Effect, Option } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { capturePrivateJsonData, commerceError, CommerceTransactionError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "./commerce-promise-owner";

/** One command owns all foreign framework continuations and DAL runners. */
export const withCommerceService = Effect.fn("MedusaAdapter.withService")(function* <Service>(
  ctx: CommerceCommandContext, compose: (owner: CommercePromiseOwner) => Service,
  work: (service: Service) => Promise<unknown>,
) {
  const owner = makeCommercePromiseOwner();
  return yield* Effect.gen(function* () {
    const value = yield* Effect.tryPromise({
      try: signal => owner.callback(() => work(compose(owner)), signal),
      catch: cause => cause instanceof CommerceTransactionError ? cause : commerceError("adapterFailure", cause),
    });
    const refusal = owner.refusal();
    if (Option.isSome(refusal)) return yield* ctx.refuse(refusal.value);
    if (owner.hasPending()) return yield* ctx.refuse(commerceError("overlappingOperation"));
    return (yield* Effect.fromResult(capturePrivateJsonData(value, commerceLimits.commandBytes, commerceError))).value;
  }).pipe(
    Effect.tapCause(cause => Effect.exit(ctx.refuse(commerceError("adapterFailure", cause))).pipe(Effect.asVoid)),
    Effect.ensuring(owner.close),
  );
});
