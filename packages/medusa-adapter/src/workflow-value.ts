import { Effect } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";

/** The staged SDK may retain own undefined fields. Account an owned JSON
 * envelope through the root budget, then restore only the recorded omissions. */
export const captureWorkflowValue = Effect.fn("MedusaWorkflow.captureValue")(function* (ctx: AtomicCommerceContext, value: unknown) {
  const omitted: string[][] = [];
  const payload = yield* Effect.fromResult(captureCommerceInput({ value }, undefined, path => omitted.push([...path])));
  const captured = yield* ctx.capture({ payload, omitted });
  if (!isNonArrayRecord(captured)) return yield* ctx.refuse(commerceError("storedCorruption"));
  const owned: unknown = structuredClone(captured.payload);
  for (const path of omitted) {
    let parent = owned;
    for (const key of path.slice(0, -1)) {
      if (typeof parent !== "object" || parent === null || !Object.hasOwn(parent, key)) return yield* ctx.refuse(commerceError("storedCorruption"));
      parent = Object.getOwnPropertyDescriptor(parent, key)?.value;
    }
    const key = path.at(-1);
    if (key === undefined || !isNonArrayRecord(parent) || Object.hasOwn(parent, key)) return yield* ctx.refuse(commerceError("storedCorruption"));
    Object.defineProperty(parent, key, { value: undefined, enumerable: true, writable: true, configurable: true });
  }
  if (!isNonArrayRecord(owned)) return yield* ctx.refuse(commerceError("storedCorruption"));
  return owned.value;
});
