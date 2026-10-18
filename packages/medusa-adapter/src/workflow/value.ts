import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { capturePrivateIntermediateJsonData, commerceError, defaultCommerceResources, type Json, type PrivateIntermediateJsonPath } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";

const captureIntermediate = (input: unknown) => capturePrivateIntermediateJsonData({ value: input },
  { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 }, commerceError);

/** Method/Query inputs retain dense positional undefined values until their
 * native argument decoder normalizes them. Own object undefined stays omitted.
 * The shared capture owner bounds descriptors and the complete sidecar first. */
export function captureWorkflowInput(input: unknown) {
  return Result.gen(function* () {
    const snapshot = yield* captureIntermediate(input);
    const envelope = yield* captureCommerceInput({ payload: snapshot.value, undefinedPaths: snapshot.undefinedPaths });
    if (!isNonArrayRecord(envelope)) return yield* Result.fail(commerceError("storedCorruption"));
    return yield* restoreWorkflowValue(envelope.payload, snapshot.undefinedPaths.filter(path => typeof path.at(-1) === "number"));
  });
}

/** Only paths issued by the bounded private capture owner reach restoration. */
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
