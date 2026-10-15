import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { capturePrivateIntermediateJsonData, commerceError, defaultCommerceResources, type PrivateIntermediateJsonPath } from "@flarex/persistence-postgres/internal/commerce-values";

/** The staged SDK retains own undefined properties and positional results.
 * Budget the shared owner's JSON envelope before restoring only issued slots. */
export const captureWorkflowValue = Effect.fn("MedusaWorkflow.captureValue")(function* (ctx: AtomicCommerceContext, value: unknown) {
  let undefinedPaths: readonly PrivateIntermediateJsonPath[] = [];
  const captured = yield* ctx.capture(value, input =>
    capturePrivateIntermediateJsonData({ value: input },
      { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 }, commerceError)
      .pipe(Result.map(snapshot => {
        undefinedPaths = snapshot.undefinedPaths;
        return { payload: snapshot.value, undefinedPaths };
      })));
  if (!isNonArrayRecord(captured)) return yield* ctx.refuse(commerceError("storedCorruption"));
  const owned: unknown = structuredClone(captured.payload);
  for (const path of undefinedPaths) {
    let parent = owned;
    for (const key of path.slice(0, -1)) {
      if (typeof parent !== "object" || parent === null ||
        (typeof key === "number" ? !Array.isArray(parent) : !isNonArrayRecord(parent)) || !Object.hasOwn(parent, key))
        return yield* ctx.refuse(commerceError("storedCorruption"));
      parent = Object.getOwnPropertyDescriptor(parent, key)?.value;
    }
    const key = path.at(-1);
    if (key === undefined || typeof parent !== "object" || parent === null || (typeof key === "number"
      ? !Array.isArray(parent) || !Number.isSafeInteger(key) || key < 0 || key >= parent.length ||
        !Object.hasOwn(parent, key) || Object.getOwnPropertyDescriptor(parent, key)?.value !== null
      : !isNonArrayRecord(parent) || Object.hasOwn(parent, key))) return yield* ctx.refuse(commerceError("storedCorruption"));
    Object.defineProperty(parent, key, { value: undefined, enumerable: true, writable: true, configurable: true });
  }
  if (!isNonArrayRecord(owned)) return yield* ctx.refuse(commerceError("storedCorruption"));
  return owned.value;
});
