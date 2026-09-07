import { Context, Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import {
  capturePrivateCanonicalValue,
  type PrivateCanonicalValueErrorPolicy,
  type PrivateCanonicalValueSnapshot,
} from "../frameworkSchema/privateCanonicalValue";

interface PlanVerificationEntry {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly frame: JsonObject;
}
interface PlanVerificationState {
  active: boolean;
  entry: PlanVerificationEntry | undefined;
  assignments: Map<string, PlanVerificationEntry>;
  assignmentBytes: number;
  ledger: Map<string, PlanVerificationEntry>;
  ledgerBytes: number;
  ownedFrames: WeakSet<object>;
  captures: WeakMap<object, PrivateCanonicalValueSnapshot<JsonObject>>;
  captureBytes: number;
  captureCount: number;
  readonly releases: Set<() => void>;
}
export const currentPlanVerification = Context.Reference<
  PlanVerificationState | undefined
>("flarex/FrameworkMigrationPlanVerification", {
  defaultValue: () => undefined,
});

/** Pure byte verification only: one plan (at most 8 MiB encoded) per operation.
 * This state never contains database rows, restored references or authority.
 * Nested restorations may inherit it; settlement releases its owned bytes and
 * frame even when a child fiber retained the Context after interruption. */
export const withFrameworkMigrationPlanVerification = Effect.fn(
  "FrameworkMigrationValue.withPlanVerification",
)(function* <Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
): Effect.fn.Return<Value, Failure> {
  const inherited = yield* currentPlanVerification;
  if (inherited?.active) return yield* effect;
  const state: PlanVerificationState = {
    active: true,
    entry: undefined,
    assignments: new Map(),
    assignmentBytes: 0,
    ledger: new Map(),
    ledgerBytes: 0,
    ownedFrames: new WeakSet(),
    captures: new WeakMap(),
    captureBytes: 0,
    captureCount: 0,
    releases: new Set(),
  };
  return yield* effect.pipe(
    Effect.provideService(currentPlanVerification, state),
    Effect.ensuring(
      Effect.sync(() => {
        state.active = false;
        state.entry = undefined;
        state.assignments.clear();
        state.ledger.clear();
        for (const release of state.releases) release();
        state.releases.clear();
        state.captures = new WeakMap();
        state.ownedFrames = new WeakSet();
      }),
    ),
  );
});

/** Called only for deeply frozen JSON produced by the stored-value verifier.
 * Recheck freezing recursively so a shallow-frozen caller cannot opt a mutable
 * descendant into identity-based canonical capture reuse. */
export const retainOwnedMigrationFrame = Effect.fn(
  "FrameworkMigrationValue.retainOwnedFrame",
)(function* (frame: JsonObject) {
  const state = yield* currentPlanVerification;
  if (!state?.active) return;
  const pending: object[] = [frame];
  const owned: object[] = [];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === undefined || seen.has(value) || state.ownedFrames.has(value))
      continue;
    if (
      !Object.isFrozen(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== Array.prototype)
    )
      return;
    const descriptors = Object.values(Object.getOwnPropertyDescriptors(value));
    if (descriptors.some((descriptor) => !("value" in descriptor))) return;
    seen.add(value);
    owned.push(value);
    for (const descriptor of descriptors) {
      const child: unknown = descriptor.value;
      if (child !== null && typeof child === "object") pending.push(child);
    }
  }
  for (const value of owned) state.ownedFrames.add(value);
});

/** Reuses canonical bytes, never an occupant or a restored capability. The
 * Per-operation limits of 4 MiB encoded and 4096 entries bound retention. */
// Per-frame memo lookup is a measured hot path. Domain capture/restoration
// operations retain named tracing; this transparent helper needs no extra span.
export const captureMigrationCanonicalValue = Effect.fnUntraced(function* <
  Frame extends JsonObject,
  Failure,
>(
  frame: Frame,
  maximumBytes: number,
  errors: PrivateCanonicalValueErrorPolicy<Failure>,
): Effect.fn.Return<PrivateCanonicalValueSnapshot<Frame>, Failure> {
  const state = yield* currentPlanVerification;
  const eligible =
    state?.active === true &&
    state.ownedFrames.has(frame) &&
    Number.isSafeInteger(maximumBytes) &&
    maximumBytes >= 0;
  const prior = eligible ? state.captures.get(frame) : undefined;
  if (prior !== undefined) {
    if (prior.canonicalByteLength > maximumBytes)
      return yield* Effect.fail(errors.invalidInput());
    return Object.freeze({ ...prior, frame });
  }
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    maximumBytes,
    errors,
  );
  if (
    eligible &&
    state.active &&
    state.captureCount < 4096 &&
    state.captureBytes + captured.canonicalByteLength <= 4_194_304
  ) {
    state.captures.set(frame, captured);
    state.captureBytes += captured.canonicalByteLength;
    state.captureCount += 1;
  }
  return captured;
});

/** Carry only pure verification state through a foreign driver runtime bridge. */
export const bindFrameworkMigrationPlanVerification = Effect.fn(
  "FrameworkMigrationValue.bindVerification",
)(function* () {
  const state = yield* currentPlanVerification;
  return <Value, Failure>(
    effect: Effect.Effect<Value, Failure>,
  ): Effect.Effect<Value, Failure> =>
    Effect.provideService(effect, currentPlanVerification, state);
});
