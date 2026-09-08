import { Effect } from "effect";
import { requireCommerceAdmission, type CommerceAdmission } from "../commerceTransaction/admission";
import { commerceError } from "../commerceTransaction/model";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../frameworkSchema/binding/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";

declare const bindingBrand: unique symbol;
export interface CompositeBinding { readonly [bindingBrand]: true }
const bindings = new WeakMap<object, CommerceAdmission>();

/** Private composition proof; an existing commerce admission must remain live. */
export const withCompositeBinding = Effect.fn("CompositeBinding.withAdmission")(function* <A, E, R>(
  commerce: CommerceAdmission, work: (binding: CompositeBinding) => Effect.Effect<A, E, R>,
) {
  const state = yield* requireCommerceAdmission(commerce);
  if (state.bootstrap || state.head === null) return yield* Effect.fail(commerceError("invalidAuthority"));
  // SAFETY: only this live registry issues the opaque binding proof.
  const token = Object.freeze({}) as CompositeBinding;
  bindings.set(token, commerce);
  return yield* Effect.suspend(() => work(token)).pipe(Effect.ensuring(Effect.sync(() => bindings.delete(token))));
});

export const requireCompositeBinding = Effect.fn("CompositeBinding.require")(function* (
  token: CompositeBinding, tx: FlarexMetadataTransaction, clock: ScopeClockRecord,
  frame: DataBindingSetFrame, head: DataBindingHeadToken,
) {
  const commerce = bindings.get(token);
  if (commerce === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const state = yield* requireCommerceAdmission(commerce);
  if (state.tx !== tx || state.clock !== clock || state.head === null || frame.commerce === null || frame.payloadLifecycle !== null ||
    !sameBindingValue(state.head, head)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const { profiles: _profiles, ...reference } = frame.commerce;
  if (!sameBindingValue(reference, state.reference)) return yield* Effect.fail(commerceError("invalidAuthority"));
});
