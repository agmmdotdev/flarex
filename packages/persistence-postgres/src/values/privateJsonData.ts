import { Result } from "effect";
import { measureCanonicalJsonUtf8Bytes, type Json } from "flarex-protocol/json";

/** Value ownership only. Exact detached immutable trees may cross trusted native
 * owners; these facts confer no source, request, storage or admission authority. */
export interface CapturedPrivateJsonDataFacts {
  readonly value: Json;
  readonly bytes: number;
  readonly nodes: number;
  readonly depth: number;
  readonly negativeZero: boolean;
}
const capturedValues = new WeakMap<object, CapturedPrivateJsonDataFacts>();
export const inspectCapturedPrivateJsonData = (input: unknown): CapturedPrivateJsonDataFacts | undefined =>
  typeof input === "object" && input !== null ? capturedValues.get(input) : undefined;

const detachIssuedJson = (value: Json): Json => {
  if (value === null || typeof value !== "object") return value;
  const issued = capturedValues.get(value);
  if (issued === undefined) throw new Error("Captured JSON child has no ownership facts");
  const detached = Array.isArray(value) ? Object.freeze(value.map(detachIssuedJson)) :
    Object.freeze(Object.fromEntries(Object.entries(value).map(([key, member]) => [key, detachIssuedJson(member)])));
  capturedValues.set(detached, Object.freeze({ ...issued, value: detached }));
  return detached;
};

/** Snapshot own data descriptors once; never measure one view and encode another. */
export function capturePrivateJsonData<Failure>(
  input: unknown,
  maximum: number,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
  policy?: Readonly<{ canonicalNumbers: true }>,
): Result.Result<
  Readonly<{ value: Json; bytes: number }>,
  Failure
> {
  const budget = { remaining: maximum };
  return snapshot(input, 0, budget, failure, false, policy?.canonicalNumbers === true).pipe(
    Result.map((value) =>
      Object.freeze({ value, bytes: maximum - budget.remaining }),
    ),
  );
}

/** Internal trusted handoff. Foreign wrappers still undergo their complete own
 * descriptor checks. Only exact issued children avoid another value walk. */
export function useCapturedPrivateJsonData<Failure>(input: unknown, maximum: number,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  const budget = { remaining: maximum };
  return snapshot(input, 0, budget, failure, true).pipe(Result.map(value =>
    Object.freeze({ value, bytes: maximum - budget.remaining })));
}
function spend<Failure>(
  budget: { remaining: number },
  bytes: number,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
): Result.Result<void, Failure> {
  budget.remaining -= bytes;
  return budget.remaining < 0
    ? Result.fail(failure("limitExceeded"))
    : Result.succeed(undefined);
}
function snapshot<Failure>(
  input: unknown,
  depth: number,
  budget: { remaining: number },
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
  owned: boolean,
  canonicalNumbers = false,
): Result.Result<Json, Failure> {
  return Result.gen(function* () {
    if (depth > 64) return yield* Result.fail(failure("limitExceeded"));
    const issued = inspectCapturedPrivateJsonData(input);
    if (issued !== undefined && !(canonicalNumbers && issued.negativeZero)) {
      if (depth + issued.depth > 64) return yield* Result.fail(failure("limitExceeded"));
      yield* spend(budget, issued.bytes, failure);
      return owned ? issued.value : detachIssuedJson(issued.value);
    }
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "boolean"
    ) {
      const measured = measureCanonicalJsonUtf8Bytes(input, budget.remaining);
      if (measured.kind !== "success")
        return yield* Result.fail(
          failure(
            measured.kind === "exceeded" ? "limitExceeded" : "invalidInput",
          ),
        );
      yield* spend(budget, measured.bytes, failure);
      return canonicalNumbers && typeof input === "number" && Object.is(input, -0) ? 0 : input;
    }
    if (typeof input !== "object")
      return yield* Result.fail(failure("invalidInput"));
    const meta = yield* Result.try({
      try: () => ({
        array: Array.isArray(input),
        prototype: Object.getPrototypeOf(input),
        keys: Reflect.ownKeys(input),
      }),
      catch: (cause) => failure("invalidInput", cause),
    });
    if (
      (meta.array
        ? meta.prototype !== Array.prototype
        : meta.prototype !== Object.prototype && meta.prototype !== null) ||
      meta.keys.some((key) => typeof key !== "string")
    )
      return yield* Result.fail(failure("invalidInput"));
    const remainingBefore = budget.remaining;
    yield* spend(budget, 2, failure);
    if (meta.keys.length > budget.remaining + 1)
      return yield* Result.fail(failure("limitExceeded"));
    const array: Json[] = [];
    const entries: [string, Json][] = [];
    let nodes = 1, relativeDepth = 0, negativeZero = false;
    const keys = meta.array
      ? meta.keys.filter((key) => key !== "length")
      : meta.keys;
    for (const [index, key] of keys.entries()) {
      if (typeof key !== "string" || (meta.array && key !== String(index)))
        return yield* Result.fail(failure("invalidInput"));
      const descriptor = yield* Result.try({
        try: () => Object.getOwnPropertyDescriptor(input, key),
        catch: (cause) => failure("invalidInput", cause),
      });
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      )
        return yield* Result.fail(failure("invalidInput"));
      if (index > 0) yield* spend(budget, 1, failure);
      if (!meta.array) {
        const keySize = measureCanonicalJsonUtf8Bytes(key, budget.remaining);
        if (keySize.kind !== "success")
          return yield* Result.fail(failure("limitExceeded"));
        yield* spend(budget, keySize.bytes + 1, failure);
      }
      const value = yield* snapshot(descriptor.value, depth + 1, budget, failure, owned, canonicalNumbers);
      const child = inspectCapturedPrivateJsonData(value);
      nodes += child?.nodes ?? 1;
      relativeDepth = Math.max(relativeDepth, 1 + (child?.depth ?? 0));
      negativeZero ||= child?.negativeZero ?? (typeof value === "number" && Object.is(value, -0));
      if (meta.array) array.push(value);
      else entries.push([key, value]);
    }
    if (meta.array) {
      const length = yield* Result.try({
        try: () => Object.getOwnPropertyDescriptor(input, "length"),
        catch: (cause) => failure("invalidInput", cause),
      });
      if (length?.value !== array.length)
        return yield* Result.fail(failure("invalidInput"));
      const value = Object.freeze(array);
      capturedValues.set(value, Object.freeze({ value, bytes: remainingBefore - budget.remaining,
        nodes, depth: relativeDepth, negativeZero }));
      return value;
    }
    const value = Object.freeze(Object.fromEntries(entries));
    capturedValues.set(value, Object.freeze({ value, bytes: remainingBefore - budget.remaining,
      nodes, depth: relativeDepth, negativeZero }));
    return value;
  });
}
