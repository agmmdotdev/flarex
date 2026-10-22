import { Effect, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { capturePrivateIntermediateJsonData, commerceError, defaultCommerceResources, type CommerceTransactionError, type Json, type PrivateIntermediateJsonPath } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";

/** Native intermediate values may own undefined object members and dense array
 * slots. This is a transport value contract, never a persisted JSON widening. */
export type WorkflowIntermediateValue = string | number | boolean | null | undefined
  | readonly WorkflowIntermediateValue[] | { readonly [key: string]: WorkflowIntermediateValue };
export type WorkflowInputPresence = "preserveOwnUndefined";

const captureIntermediate = (input: unknown) => capturePrivateIntermediateJsonData({ value: input },
  { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 }, commerceError);

/** Method/Query inputs retain dense positional undefined values until their
 * native argument decoder normalizes them. Object undefined stays omitted by
 * default; a trusted method profile may preserve all issued object paths.
 * The shared capture owner bounds descriptors and the complete sidecar first. */
export function captureWorkflowInput(input: unknown, inputPresence?: WorkflowInputPresence) {
  return Result.gen(function* () {
    if (inputPresence !== undefined && inputPresence !== "preserveOwnUndefined")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const snapshot = yield* captureIntermediate(input);
    const envelope = yield* captureCommerceInput({ payload: snapshot.value, undefinedPaths: snapshot.undefinedPaths });
    if (!isNonArrayRecord(envelope)) return yield* Result.fail(commerceError("storedCorruption"));
    return yield* restoreWorkflowValue(envelope.payload, inputPresence === "preserveOwnUndefined"
      ? snapshot.undefinedPaths : snapshot.undefinedPaths.filter(path => typeof path.at(-1) === "number"));
  });
}

/** The method encoder's native intermediate is charged as a complete JSON
 * envelope before it crosses the ordinary command input boundary. */
export function captureWorkflowCommandInput(value: WorkflowIntermediateValue) {
  return Result.gen(function* () {
    const snapshot = yield* captureIntermediate(value);
    return yield* captureCommerceInput({ payload: snapshot.value, undefinedPaths: snapshot.undefinedPaths });
  });
}

const decodeCommandEnvelope = commerceDecoder(Schema.Struct({
  payload: Schema.Struct({ value: Schema.optionalKey(Schema.Json) }),
  undefinedPaths: Schema.Array(Schema.Array(Schema.Union([
    Schema.String,
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  ])).check(Schema.isLengthBetween(1, 16))).check(Schema.isMaxLength(defaultCommerceResources.valueNodes)),
}), "invalidInput");

/** Serialized paths carry representation only. Capture foreign descriptors and
 * charge the entire envelope first, then verify every target on a detached tree
 * before invoking the command's authoritative argument decoder. */
export function decodeWorkflowCommandInput<Input>(input: unknown,
  decode: (value: unknown) => Result.Result<Input, CommerceTransactionError>) {
  return Result.gen(function* () {
    const snapshot = yield* capturePrivateIntermediateJsonData(input,
      { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 }, commerceError);
    if (snapshot.undefinedPaths.length !== 0) return yield* Result.fail(commerceError("invalidInput"));
    const envelope = yield* decodeCommandEnvelope(snapshot.value);
    if (envelope.undefinedPaths.some(path => path[0] !== "value")) return yield* Result.fail(commerceError("invalidInput"));
    if (!Object.hasOwn(envelope.payload, "value") && !envelope.undefinedPaths.some(path => path.length === 1))
      return yield* Result.fail(commerceError("invalidInput"));
    const restored = yield* restoreWorkflowValue(envelope.payload, envelope.undefinedPaths)
      .pipe(Result.mapError(cause => commerceError("invalidInput", cause)));
    // Restored missing members also consume the native source's node/depth and
    // sidecar budgets; a small serialized envelope cannot manufacture an
    // unbounded intermediate value through its path metadata.
    yield* captureIntermediate(restored);
    return yield* decode(restored);
  });
}

/** Capture-issued or checked transport paths target only this detached payload.
 * No path data confers source identity or authority. */
function restoreWorkflowValue(payload: Json | undefined, undefinedPaths: readonly PrivateIntermediateJsonPath[]) {
  return Result.gen(function* () {
    const owned: unknown = structuredClone(payload);
    for (const path of undefinedPaths) {
      let parent = owned;
      for (const key of path.slice(0, -1)) {
        if (typeof parent !== "object" || parent === null ||
          (typeof key === "number" ? !Array.isArray(parent) : !isNonArrayRecord(parent)) || !Object.hasOwn(parent, key))
          return yield* Result.fail(commerceError("storedCorruption"));
        parent = Object.getOwnPropertyDescriptor(parent, key)?.value;
      }
      const key = path.at(-1);
      if (key === undefined || typeof parent !== "object" || parent === null || (typeof key === "number"
        ? !Array.isArray(parent) || !Number.isSafeInteger(key) || key < 0 || key >= parent.length ||
          !Object.hasOwn(parent, key) || Object.getOwnPropertyDescriptor(parent, key)?.value !== null
        : !isNonArrayRecord(parent) || Object.hasOwn(parent, key))) return yield* Result.fail(commerceError("storedCorruption"));
      Object.defineProperty(parent, key, { value: undefined, enumerable: true, writable: true, configurable: true });
    }
    if (!isNonArrayRecord(owned)) return yield* Result.fail(commerceError("storedCorruption"));
    return owned.value;
  });
}

/** The staged SDK retains own undefined properties and positional results.
 * Budget the shared owner's JSON envelope before restoring only issued slots. */
export const captureWorkflowValue = Effect.fn("MedusaWorkflow.captureValue")(function* (ctx: AtomicCommerceContext, value: unknown) {
  let undefinedPaths: readonly PrivateIntermediateJsonPath[] = [];
  const captured = yield* ctx.capture(value, input =>
    captureIntermediate(input)
      .pipe(Result.map(snapshot => {
        undefinedPaths = snapshot.undefinedPaths;
        return { payload: snapshot.value, undefinedPaths };
      })));
  if (!isNonArrayRecord(captured)) return yield* ctx.refuse(commerceError("storedCorruption"));
  return yield* restoreWorkflowValue(captured.payload, undefinedPaths).pipe(Result.match({ onFailure: ctx.refuse, onSuccess: Effect.succeed }));
});
