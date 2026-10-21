import { Cause, Effect, Result } from "effect";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Latch newly originated validation failures before exposing a foreign
 * rejection. Participant calls bypass this boundary and retain their full Cause. */
export const checkedCommerceValue = Effect.fn("Commerce.checkedValue")(<Value>(ctx: Pick<AtomicCommerceContext, "refuse" | "recordFailure">,
  decode: () => Result.Result<Value, CommerceTransactionError>) => Effect.suspend(() => Effect.fromResult(decode()))
  .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)),
    Effect.catchCause(cause => Result.match(ctx.recordFailure(cause), {
      onSuccess: owned => Effect.failCause(owned),
      onFailure: error => Effect.failCause(Cause.combine(cause, Cause.fail(error))),
    })),
  ));
