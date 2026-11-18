import { Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Snapshot a foreign native DAL record without evaluating its accessors.
 * Values remain unknown until the selected scalar codec has captured them. */
export const captureNativeRecord = Effect.fn("MedusaAdapter.captureNativeRecord")(function* (input: unknown) {
  const reflected = yield* Effect.try({ try: () => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw commerceError("invalidInput");
    return { prototype: Object.getPrototypeOf(input), properties: Object.getOwnPropertyDescriptors(input) };
  }, catch: cause => commerceError("invalidInput", cause) });
  if (reflected.prototype !== Object.prototype && reflected.prototype !== null) return yield* Effect.fail(commerceError("invalidInput"));
  const row: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(reflected.properties)) {
    const property = typeof key === "string" ? reflected.properties[key] : undefined;
    if (typeof key !== "string" || property === undefined || !("value" in property) || !property.enumerable)
      return yield* Effect.fail(commerceError("invalidInput"));
    Object.defineProperty(row, key, { value: property.value, enumerable: true, writable: true, configurable: true });
  }
  return row;
});

/** Only the module's selected business dates accept genuine native Date values.
 * Managed timestamps and all other fields still pass their ordinary codecs. */
export const captureNativeDateRecord = Effect.fn("MedusaAdapter.captureNativeDateRecord")(function* (input: unknown, fields: readonly string[]) {
  const row = yield* captureNativeRecord(input);
  for (const name of fields) {
    if (!Object.hasOwn(row, name)) continue;
    const value = row[name];
    if (value instanceof Date) row[name] = yield* Effect.try({ try: () => Date.prototype.toISOString.call(value), catch: cause => commerceError("invalidInput", cause) });
  }
  return row;
});
