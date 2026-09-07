import { Result } from "effect";
import { capturePrivateJsonData, commerceError, commerceLimits, type Json, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
/** Medusa builds plain option objects with undefined members. Omit those members
 * at this foreign boundary, then use the core's strict captured JSON contract. */
export function captureCommerceInput(input: unknown): Result.Result<Json, CommerceTransactionError> {
  let nodes = 0;
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): Result.Result<unknown, CommerceTransactionError> => Result.gen(function* () {
    if (++nodes > 8192 || depth > 16) return yield* Result.fail(commerceError("limitExceeded"));
    if (value === null || typeof value !== "object") return value;
    const meta = yield* Result.try({ try: () => ({ array: Array.isArray(value), prototype: Object.getPrototypeOf(value), keys: Reflect.ownKeys(value) }), catch: cause => commerceError("invalidInput", cause) });
    if (active.has(value) || (meta.array ? meta.prototype !== Array.prototype : meta.prototype !== Object.prototype && meta.prototype !== null)) return yield* Result.fail(commerceError("invalidInput"));
    active.add(value);
    const entries: [string, unknown][] = [];
    if (meta.keys.length > 8192) return yield* Result.fail(commerceError("limitExceeded"));
    for (const key of meta.keys) {
      if (meta.array && key === "length") continue;
      if (typeof key !== "string") return yield* Result.fail(commerceError("invalidInput"));
      const property = yield* Result.try({ try: () => Object.getOwnPropertyDescriptor(value, key), catch: cause => commerceError("invalidInput", cause) });
      if (property === undefined || !("value" in property) || !property.enumerable) return yield* Result.fail(commerceError("invalidInput"));
      if (property.value === undefined && !meta.array) continue;
      entries.push([key, yield* visit(property.value, depth + 1)]);
    }
    active.delete(value);
    if (meta.array) {
      const length = yield* Result.try({ try: () => Object.getOwnPropertyDescriptor(value, "length"), catch: cause => commerceError("invalidInput", cause) });
      if (entries.length !== length?.value || entries.some(([key], index) => key !== String(index))) return yield* Result.fail(commerceError("invalidInput"));
      return entries.map(([, member]) => member);
    }
    return Object.fromEntries(entries);
  });
  return visit(input, 0).pipe(Result.flatMap(value => capturePrivateJsonData(value, commerceLimits.commandBytes, commerceError)), Result.map(value => value.value));
}
