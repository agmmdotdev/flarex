import { Cause, Effect, Result } from "effect";
import type { AtomicCommerceContext } from "./commands";
import type { CommerceCommandContext } from "../commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import type { BoundedRequestContext, BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";

type ScopeProof = Effect.Effect<void, CommerceTransactionError>;
const scopeExclusions = new WeakMap<AtomicCommerceContext | CommerceCommandContext, ScopeProof>();

/** Only the issuing adapter registers an exact context and its live manager proof. */
export function registerAtomicCommerceScopeExclusion(
  context: AtomicCommerceContext | CommerceCommandContext,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  manager: BoundedRequestContext,
  proof: ScopeProof,
  schedule?: (checked: ScopeProof) => ScopeProof,
): void {
  const checked = lifetime.checkpoint(manager).pipe(Effect.andThen(proof.pipe(
    Effect.catchCause(cause => Result.match(lifetime.recordFailure(manager, cause), {
      onSuccess: owned => Effect.failCause(owned),
      onFailure: error => Effect.failCause(Cause.combine(cause, Cause.fail(error))),
    })),
  )));
  scopeExclusions.set(context, schedule === undefined ? checked : schedule(checked));
}

/** Authenticate live outer exclusion without lending a clock or transaction. */
export const requireAtomicCommerceScopeExclusion = Effect.fn("AtomicCommerce.requireScopeExclusion")(
  (context: AtomicCommerceContext | CommerceCommandContext): Effect.Effect<void, CommerceTransactionError> =>
    Effect.suspend(() => scopeExclusions.get(context) ?? Effect.fail(commerceError("invalidAuthority"))));
