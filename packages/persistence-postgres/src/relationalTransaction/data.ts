import { Result } from "effect";
import { measureCanonicalJsonUtf8Bytes, type Json } from "flarex-protocol/json";
import { relationalError } from "./model";
import type { RelationalTransactionError } from "./model";

/** Snapshot own data descriptors once; never measure one view and encode another. */
export function captureRelationalData(
  input: unknown,
  maximum: number,
): Result.Result<
  Readonly<{ value: Json; bytes: number }>,
  RelationalTransactionError
> {
  const budget = { remaining: maximum };
  return snapshot(input, 0, budget).pipe(
    Result.map((value) =>
      Object.freeze({ value, bytes: maximum - budget.remaining }),
    ),
  );
}
function spend(
  budget: { remaining: number },
  bytes: number,
): Result.Result<void, RelationalTransactionError> {
  budget.remaining -= bytes;
  return budget.remaining < 0
    ? Result.fail(relationalError("limitExceeded"))
    : Result.succeed(undefined);
}
function snapshot(
  input: unknown,
  depth: number,
  budget: { remaining: number },
): Result.Result<Json, RelationalTransactionError> {
  return Result.gen(function* () {
    if (depth > 64) return yield* Result.fail(relationalError("limitExceeded"));
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "boolean"
    ) {
      const measured = measureCanonicalJsonUtf8Bytes(input, budget.remaining);
      if (measured.kind !== "success")
        return yield* Result.fail(
          relationalError(
            measured.kind === "exceeded" ? "limitExceeded" : "invalidInput",
          ),
        );
      yield* spend(budget, measured.bytes);
      return input;
    }
    if (typeof input !== "object")
      return yield* Result.fail(relationalError("invalidInput"));
    const meta = yield* Result.try({
      try: () => ({
        array: Array.isArray(input),
        prototype: Object.getPrototypeOf(input),
        keys: Reflect.ownKeys(input),
      }),
      catch: (cause) => relationalError("invalidInput", cause),
    });
    if (
      (meta.array
        ? meta.prototype !== Array.prototype
        : meta.prototype !== Object.prototype && meta.prototype !== null) ||
      meta.keys.some((key) => typeof key !== "string")
    )
      return yield* Result.fail(relationalError("invalidInput"));
    yield* spend(budget, 2);
    if (meta.keys.length > budget.remaining + 1)
      return yield* Result.fail(relationalError("limitExceeded"));
    const array: Json[] = [];
    const entries: [string, Json][] = [];
    const keys = meta.array
      ? meta.keys.filter((key) => key !== "length")
      : meta.keys;
    for (const [index, key] of keys.entries()) {
      if (typeof key !== "string" || (meta.array && key !== String(index)))
        return yield* Result.fail(relationalError("invalidInput"));
      const descriptor = yield* Result.try({
        try: () => Object.getOwnPropertyDescriptor(input, key),
        catch: (cause) => relationalError("invalidInput", cause),
      });
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      )
        return yield* Result.fail(relationalError("invalidInput"));
      if (index > 0) yield* spend(budget, 1);
      if (!meta.array) {
        const keySize = measureCanonicalJsonUtf8Bytes(key, budget.remaining);
        if (keySize.kind !== "success")
          return yield* Result.fail(relationalError("limitExceeded"));
        yield* spend(budget, keySize.bytes + 1);
      }
      const value = yield* snapshot(descriptor.value, depth + 1, budget);
      if (meta.array) array.push(value);
      else entries.push([key, value]);
    }
    if (meta.array) {
      const length = yield* Result.try({
        try: () => Object.getOwnPropertyDescriptor(input, "length"),
        catch: (cause) => relationalError("invalidInput", cause),
      });
      if (length?.value !== array.length)
        return yield* Result.fail(relationalError("invalidInput"));
      return Object.freeze(array);
    }
    return Object.freeze(Object.fromEntries(entries));
  });
}
