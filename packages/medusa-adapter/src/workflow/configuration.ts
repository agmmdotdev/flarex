import { Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { commerceError, commerceLimits, capturePrivateJsonDataOmittingUndefined, useCapturedPrivateJsonData } from "@flarex/persistence-postgres/internal/commerce-values";

/** Configuration uses the atomic owner's policy JSON contract (64 KiB and
 * depth 64), rather than the native business-value envelope. Keep the complete
 * canonical preimage so existing workflow replay identities remain unchanged. */
export const captureWorkflowPolicy = (input: unknown) => capturePrivateJsonDataOmittingUndefined(input,
  // Native optional metadata still omits own undefined members. Bound descriptor
  // work by the configuration byte ceiling, independently of business values.
  { bytes: commerceLimits.rowBytes, nodes: commerceLimits.rowBytes, depth: 64 }, commerceError).pipe(
    Result.flatMap(snapshot => useCapturedPrivateJsonData(snapshot.value, commerceLimits.rowBytes,
      commerceError, { canonicalNumbers: true, wellFormedUnicode: true })),
    Result.map(snapshot => snapshot.value),
  );

/** Capture trusted registration data without dispatching property getters.
 * Nested capabilities are captured by their owners, never cloned as JSON. */
export function captureWorkflowRecord<T extends object>(input: T) {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const reflected = yield* Result.try({
      try: () => ({ prototype: Object.getPrototypeOf(input), properties: Object.getOwnPropertyDescriptors(input) }),
      catch: cause => commerceError("unsupportedProfile", cause),
    });
    if (reflected.prototype !== Object.prototype && reflected.prototype !== null) return yield* Result.fail(commerceError("unsupportedProfile"));
    const keys = Reflect.ownKeys(reflected.properties);
    if (keys.length > commerceLimits.commandDefinitions) return yield* Result.fail(commerceError("limitExceeded"));
    const entries: [string, unknown][] = [];
    for (const key of keys) {
      if (typeof key !== "string") return yield* Result.fail(commerceError("unsupportedProfile"));
      const property = reflected.properties[key];
      if (property === undefined || !("value" in property) || !property.enumerable) return yield* Result.fail(commerceError("unsupportedProfile"));
      entries.push([key, property.value]);
    }
    // SAFETY: every own enumerable data property is copied exactly once. This
    // preserves T, but does not authenticate any nested capability or callback.
    return Object.freeze(Object.fromEntries(entries)) as Readonly<T>;
  });
}

export const isWorkflowResourceName = (name: unknown): name is string => typeof name === "string" && /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name)
  && !["initialize", "__proto__", "constructor", "prototype", "then", "toJSON"].includes(name);

export function captureWorkflowArray<Value>(input: readonly Value[]) {
  return Result.gen(function* () {
    if (!Array.isArray(input)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const reflected = yield* Result.try({ try: () => ({ prototype: Object.getPrototypeOf(input), properties: Object.getOwnPropertyDescriptors(input), length: Object.getOwnPropertyDescriptor(input, "length") }),
      catch: cause => commerceError("unsupportedProfile", cause) });
    const length: unknown = reflected.length?.value;
    if (reflected.prototype !== Array.prototype || typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > commerceLimits.commandDefinitions) return yield* Result.fail(commerceError("unsupportedProfile"));
    if (Reflect.ownKeys(reflected.properties).length !== length + 1) return yield* Result.fail(commerceError("unsupportedProfile"));
    const values: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const property = reflected.properties[String(index)];
      if (property === undefined || !("value" in property) || !property.enumerable) return yield* Result.fail(commerceError("unsupportedProfile"));
      values.push(property.value);
    }
    // SAFETY: dense own data members retain their original typed values.
    return Object.freeze(values) as readonly Value[];
  });
}
