import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { useCapturedPrivateJsonData, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "./promise-owner";

/** One command owns all foreign framework continuations and DAL runners. */
export const withCommerceService = Effect.fn("MedusaAdapter.withService")(function* <Service>(
  ctx: CommerceCommandContext, compose: (owner: CommercePromiseOwner) => Service,
  work: (service: Service) => Promise<unknown>,
) {
  const owner = yield* makeCommercePromiseOwner(ctx.recordFailure);
  return yield* owner.withClose(Effect.gen(function* () {
    const value = yield* owner.invoke(() => work(compose(owner)));
    if (owner.hasPending()) return yield* ctx.refuse(commerceError("overlappingOperation"));
    return (yield* Effect.fromResult(useCapturedPrivateJsonData(value, ctx.resources.commandBytes, commerceError))).value;
  }));
});
