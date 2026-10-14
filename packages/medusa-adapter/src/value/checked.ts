import { Effect, Result } from "effect";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Latch newly originated validation failures before exposing a foreign
 * rejection. Participant calls bypass this boundary and retain their full Cause. */
export const checkedCommerceValue = Effect.fn("Commerce.checkedValue")(<Value>(ctx: Pick<AtomicCommerceContext, "refuse">,
  decode: () => Result.Result<Value, CommerceTransactionError>) => Effect.suspend(() => Effect.fromResult(decode()))
  .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)),
    Effect.tapDefect(defect => Effect.exit(ctx.refuse(commerceError("adapterFailure", defect))).pipe(Effect.asVoid)),
  ));
