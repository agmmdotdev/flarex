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
  return capture(input, maximum, failure, false, policy?.canonicalNumbers === true);
}

/** Internal trusted handoff. Foreign wrappers still undergo their complete own
 * descriptor checks. Only exact issued children avoid another value walk. */
export function useCapturedPrivateJsonData<Failure>(input: unknown, maximum: number,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  return capture(input, maximum, failure, true, false);
}

/** Omit own undefined object members while capturing their descriptors once.
 * Descriptor/node/depth refusals and ordered omission callbacks precede strict
 * JSON/byte refusal. Only successfully captured values receive ownership facts. */
export function capturePrivateJsonDataOmittingUndefined<Failure>(
  input: unknown,
  bounds: Readonly<{ bytes: number; nodes: number; depth: number }>,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
  onOmitted?: (path: readonly string[]) => void,
): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  return capture(input, bounds.bytes, failure, true, false, { bounds, onOmitted });
}

interface CaptureRefusal {
  readonly reason: "limitExceeded" | "invalidInput";
  readonly cause?: unknown;
}
interface OmissionCapture {
  readonly bounds: Readonly<{ bytes: number; nodes: number; depth: number }>;
  readonly onOmitted: ((path: readonly string[]) => void) | undefined;
}

/** This bounded inspection owns descriptor safety, first refusal and issuance.
 * Its local traversal state is folded into Result only at the parse boundary;
 * per-node Result generators would allocate without adding another boundary. */
function capture<Failure>(
  input: unknown,
  maximum: number,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
  owned: boolean,
  canonicalNumbers: boolean,
  omission?: OmissionCapture,
): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  let remaining = maximum;
  let visitedNodes = 0;
  let strictRefusal: CaptureRefusal | undefined;
  let nativeRefusal: CaptureRefusal | undefined;
  const active = new Set<object>();
  const refuseStrict = (reason: CaptureRefusal["reason"], cause?: unknown): void => {
    strictRefusal ??= { reason, cause };
  };
  const spend = (bytes: number): void => {
    if (strictRefusal !== undefined) return;
    remaining -= bytes;
    if (remaining < 0) refuseStrict("limitExceeded");
  };
  const visit = (valueInput: unknown, depth: number, path: readonly string[]): Json => {
    if (nativeRefusal !== undefined || (omission === undefined && strictRefusal !== undefined)) return null;
    const issued = inspectCapturedPrivateJsonData(valueInput);
    if (omission !== undefined) {
      visitedNodes += issued?.nodes ?? 1;
      if (visitedNodes > omission.bounds.nodes || depth + (issued?.depth ?? 0) > omission.bounds.depth) {
        nativeRefusal = { reason: "limitExceeded" };
        return null;
      }
    }
    if (depth > 64) { refuseStrict("limitExceeded"); return null; }
    if (issued !== undefined && !(canonicalNumbers && issued.negativeZero)) {
      if (depth + issued.depth > 64) { refuseStrict("limitExceeded"); return null; }
      spend(issued.bytes);
      if (strictRefusal !== undefined) return null;
      return owned ? issued.value : detachIssuedJson(issued.value);
    }
    if (
      valueInput === null || typeof valueInput === "string" ||
      typeof valueInput === "number" || typeof valueInput === "boolean"
    ) {
      if (strictRefusal !== undefined) return null;
      const measured = measureCanonicalJsonUtf8Bytes(valueInput, remaining);
      if (measured.kind !== "success") {
        refuseStrict(measured.kind === "exceeded" ? "limitExceeded" : "invalidInput");
        return null;
      }
      spend(measured.bytes);
      return canonicalNumbers && typeof valueInput === "number" && Object.is(valueInput, -0) ? 0 : valueInput;
    }
    if (typeof valueInput !== "object") { refuseStrict("invalidInput"); return null; }
    let isArray: boolean;
    let prototype: unknown;
    let keys: readonly PropertyKey[];
    try {
      isArray = Array.isArray(valueInput);
      prototype = Object.getPrototypeOf(valueInput);
      keys = Reflect.ownKeys(valueInput);
    } catch (cause) {
      if (omission === undefined) refuseStrict("invalidInput", cause);
      else nativeRefusal = { reason: "invalidInput", cause };
      return null;
    }
    if ((isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
      (omission !== undefined && active.has(valueInput))) {
      if (omission === undefined) refuseStrict("invalidInput");
      else nativeRefusal = { reason: "invalidInput" };
      return null;
    }
    if (omission !== undefined) {
      active.add(valueInput);
      if (keys.length > omission.bounds.nodes) { nativeRefusal = { reason: "limitExceeded" }; return null; }
    } else if (keys.some(key => typeof key !== "string")) {
      refuseStrict("invalidInput"); return null;
    }
    const remainingBefore = remaining;
    const refusalBefore = strictRefusal;
    spend(2);
    if (omission === undefined && keys.length > remaining + 1) { refuseStrict("limitExceeded"); return null; }
    const array: Json[] = [];
    const entries: [string, Json][] = [];
    let nodes = 1, relativeDepth = 0, negativeZero = false;
    let index = 0;
    let arrayKeysDense = true;
    for (const key of keys) {
      if (isArray && key === "length") continue;
      if (typeof key !== "string" || (omission === undefined && isArray && key !== String(index))) {
        if (omission === undefined) refuseStrict("invalidInput");
        else nativeRefusal = { reason: "invalidInput" };
        return null;
      }
      let descriptor: PropertyDescriptor | undefined;
      try { descriptor = Object.getOwnPropertyDescriptor(valueInput, key); }
      catch (cause) {
        if (omission === undefined) refuseStrict("invalidInput", cause);
        else nativeRefusal = { reason: "invalidInput", cause };
        return null;
      }
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
        if (omission === undefined) refuseStrict("invalidInput");
        else nativeRefusal = { reason: "invalidInput" };
        return null;
      }
      if (omission !== undefined && descriptor.value === undefined && !isArray) {
        omission.onOmitted?.([...path, key]);
        continue;
      }
      if (index > 0) spend(1);
      if (!isArray && strictRefusal === undefined) {
        const keySize = measureCanonicalJsonUtf8Bytes(key, remaining);
        if (keySize.kind !== "success") refuseStrict("limitExceeded");
        else spend(keySize.bytes + 1);
      }
      const value = visit(descriptor.value, depth + 1, omission?.onOmitted === undefined ? [] : [...path, key]);
      if (nativeRefusal !== undefined || (omission === undefined && strictRefusal !== undefined)) return null;
      const child = inspectCapturedPrivateJsonData(value);
      nodes += child?.nodes ?? 1;
      relativeDepth = Math.max(relativeDepth, 1 + (child?.depth ?? 0));
      negativeZero ||= child?.negativeZero ?? (typeof value === "number" && Object.is(value, -0));
      if (isArray) array.push(value);
      else entries.push([key, value]);
      if (omission !== undefined && isArray && key !== String(index)) {
        // Native normalization checks density after visiting all array members.
        // Retain this fact without changing descriptor or node refusal order.
        arrayKeysDense = false;
      }
      index++;
    }
    if (isArray) {
      let length: PropertyDescriptor | undefined;
      try { length = Object.getOwnPropertyDescriptor(valueInput, "length"); }
      catch (cause) {
        if (omission === undefined) refuseStrict("invalidInput", cause);
        else nativeRefusal = { reason: "invalidInput", cause };
        return null;
      }
      if (length?.value !== array.length || !arrayKeysDense) {
        if (omission === undefined) refuseStrict("invalidInput");
        else nativeRefusal = { reason: "invalidInput" };
        return null;
      }
    }
    if (omission !== undefined) {
      active.delete(valueInput);
      // The strict capture's container key-count check precedes child byte or
      // primitive checks. Omitted keys become known only after native validation.
      if (refusalBefore === undefined && index + (isArray ? 1 : 0) > remainingBefore - 1)
        strictRefusal = { reason: "limitExceeded" };
    }
    if (strictRefusal !== undefined) return null;
    const value = isArray ? Object.freeze(array) : Object.freeze(Object.fromEntries(entries));
    capturedValues.set(value, Object.freeze({ value, bytes: remainingBefore - remaining,
      nodes, depth: relativeDepth, negativeZero }));
    return value;
  };
  const value = visit(input, 0, []);
  const refusal = nativeRefusal ?? strictRefusal;
  return refusal === undefined
    ? Result.succeed(Object.freeze({ value, bytes: maximum - remaining }))
    : Result.fail(failure(refusal.reason, refusal.cause));
}
