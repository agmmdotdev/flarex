import { Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { commerceError, type CommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";
const decodeProjection = commerceDecoder(Schema.Struct({ payload: Schema.Json, omitted: Schema.Array(Schema.Array(Schema.String)) }), "storedCorruption");

/** Category DTOs can distinguish an own undefined parent from an absent field.
 * Preserve that representation across the private JSON command boundary. */
export const captureCategoryProjection = (input: unknown, resources: Pick<CommerceResources, "commandBytes" | "valueNodes">) => Result.gen(function* () {
  const omitted: string[][] = [];
  const payload = yield* captureCommerceInput(input, resources, path => omitted.push([...path]));
  return { payload, omitted } satisfies Json;
});

export const decodeCategoryProjection = (input: Json): Result.Result<unknown, ReturnType<typeof commerceError>> => Result.gen(function* () {
  const counted = Array.isArray(input);
  const envelope = counted ? input[0] : input;
  const decoded = yield* decodeProjection(envelope);
  const value: unknown = structuredClone(decoded.payload);
  for (const path of decoded.omitted) {
    const key = path.at(-1);
    let parent = value;
    for (const segment of path.slice(0, -1)) {
      if ((!isNonArrayRecord(parent) && !Array.isArray(parent)) || !Object.hasOwn(parent, segment)) return yield* Result.fail(commerceError("storedCorruption"));
      parent = Object.getOwnPropertyDescriptor(parent, segment)?.value;
    }
    if (key === undefined || !isNonArrayRecord(parent) || Object.hasOwn(parent, key)) return yield* Result.fail(commerceError("storedCorruption"));
    Object.defineProperty(parent, key, { value: undefined, enumerable: true, configurable: true, writable: true });
  }
  if (counted && (input.length !== 2 || typeof input[1] !== "number")) return yield* Result.fail(commerceError("storedCorruption"));
  return counted ? [value, input[1]] : value;
});
