import { Cause, Effect, Result } from "effect";
import type { AtomicCommerceContext } from "./commands";
import type { CommerceCommandContext } from "../commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";

const scopeExclusions = new WeakMap<AtomicCommerceContext | CommerceCommandContext, Effect.Effect<void, CommerceTransactionError>>();

/** Only the issuing adapter registers an exact context and its live manager proof. */
export function registerAtomicCommerceScopeExclusion(
  context: AtomicCommerceContext | CommerceCommandContext,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  manager: BoundedRequestContext,
  proof: Effect.Effect<void, CommerceTransactionError>,
): void {
  scopeExclusions.set(context, lifetime.checkpoint(manager).pipe(Effect.andThen(proof.pipe(
    Effect.catchCause(cause => Result.match(lifetime.recordFailure(manager, cause), {
      onSuccess: owned => Effect.failCause(owned),
      onFailure: error => Effect.failCause(Cause.combine(cause, Cause.fail(error))),
    })),
  ))));
}

/** Authenticate live outer exclusion without lending a clock or transaction. */
export const requireAtomicCommerceScopeExclusion = Effect.fn("AtomicCommerce.requireScopeExclusion")(
  (context: AtomicCommerceContext | CommerceCommandContext): Effect.Effect<void, CommerceTransactionError> =>
    Effect.suspend(() => scopeExclusions.get(context) ?? Effect.fail(commerceError("invalidAuthority"))));
