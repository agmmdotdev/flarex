import { Result, Schema } from "effect";
import { measureCanonicalJsonUtf8Bytes, type Json } from "flarex-protocol/json";

/** Value ownership only. Exact detached immutable trees may cross trusted native
 * owners; these facts confer no source, request, storage or admission authority. */
export interface CapturedPrivateJsonDataFacts {
  readonly value: Json;
  readonly bytes: number;
  readonly nodes: number;
  readonly depth: number;
  readonly negativeZero: boolean;
  readonly wellFormedUnicode: boolean;
}
const capturedValues = new WeakMap<object, CapturedPrivateJsonDataFacts>();
const capturedUnicodeRefusals = new WeakMap<object, string>();
const unicodePattern = /^[^\uD800-\uDFFF]*$/u;
// Successful strings need only the pure predicate. Decode the selected malformed
// string once on refusal, preserving the outcome owner's original Schema cause.
const decodeUnicodeRefusal = Schema.decodeUnknownResult(Schema.String.check(Schema.isPattern(unicodePattern)));
interface CapturePolicy {
  readonly canonicalNumbers?: true;
  /** Unicode refusal follows complete structural/byte capture, as required by
   * JSON outcomes; generic JSON capture continues to allow escaped surrogates. */
  readonly wellFormedUnicode?: true;
}
export const inspectCapturedPrivateJsonData = (input: unknown): CapturedPrivateJsonDataFacts | undefined =>
  typeof input === "object" && input !== null ? capturedValues.get(input) : undefined;

/** Own data members without assignment semantics: an inherited setter or getter,
 * including `__proto__` and an inherited array index, is never consulted and the
 * descriptor reads no inherited field. Assignment is used only when nothing of
 * that name is inherited; the target is this owner's fresh ordinary object or
 * array, so `in` runs no code. */
const defineOwn = (target: { [key: string]: unknown } | unknown[], key: string | number, value: unknown): void => {
  const descriptor: PropertyDescriptor = { value, writable: true, enumerable: true, configurable: true };
  Object.setPrototypeOf(descriptor, null);
  Object.defineProperty(target, key, descriptor);
};
const defineMember = (target: { [key: string]: Json }, key: string, value: Json): void => {
  if (key in target) defineOwn(target, key, value);
  else target[key] = value;
};
// Deliberately better than the former accidental throw: under an inherited index
// accessor the element is still the correct own data property.
const appendElement = <Value>(target: Value[], value: Value): void => {
  if (target.length in target) defineOwn(target, target.length, value);
  else target.push(value);
};
const noPath: PrivateIntermediateJsonPath = Object.freeze([]);

const detachIssuedJson = (value: Json): Json => {
  if (value === null || typeof value !== "object") return value;
  const issued = capturedValues.get(value);
  if (issued === undefined) throw new Error("Captured JSON child has no ownership facts");
  let detached: Json;
  if (Array.isArray(value)) {
    const members: Json[] = [];
    for (let index = 0; index < value.length; index++) appendElement(members, detachIssuedJson(value[index] ?? null));
    detached = Object.freeze(members);
  } else {
    const members: { [key: string]: Json } = {};
    for (const [key, member] of Object.entries(value)) defineMember(members, key, detachIssuedJson(member));
    detached = Object.freeze(members);
  }
  capturedValues.set(detached, Object.freeze({ ...issued, value: detached }));
  const selectedUnicodeRefusal = capturedUnicodeRefusals.get(value);
  if (selectedUnicodeRefusal !== undefined) capturedUnicodeRefusals.set(detached, selectedUnicodeRefusal);
  return detached;
};

/** Snapshot own data descriptors once; never measure one view and encode another. */
export function capturePrivateJsonData<Failure>(
  input: unknown,
  maximum: number,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
  policy?: CapturePolicy,
): Result.Result<
  Readonly<{ value: Json; bytes: number }>,
  Failure
> {
  return capture(input, maximum, failure, false, policy?.canonicalNumbers === true, policy?.wellFormedUnicode === true);
}

/** Internal trusted handoff. Foreign wrappers still undergo their complete own
 * descriptor checks. Only exact issued children avoid another value walk. */
export function useCapturedPrivateJsonData<Failure>(input: unknown, maximum: number,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
  policy?: CapturePolicy,
): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  return capture(input, maximum, failure, true, policy?.canonicalNumbers === true, policy?.wellFormedUnicode === true);
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
  return capture(input, bounds.bytes, failure, true, false, false, { bounds, onOmitted });
}

/** Explicit private intermediate representation. Strings identify object keys;
 * numbers identify dense own array indices. Null placeholders retain positions
 * without broadening ordinary/final JSON or accepting sparse array holes.
 * Source and sidecar each obey the supplied node/byte bounds independently;
 * the receiving owner must charge their complete envelope to its root budget. */
export type PrivateIntermediateJsonPath = readonly (string | number)[];
export function capturePrivateIntermediateJsonData<Failure>(
  input: unknown,
  bounds: Readonly<{ bytes: number; nodes: number; depth: number }>,
  failure: (reason: "limitExceeded" | "invalidInput", cause?: unknown) => Failure,
): Result.Result<Readonly<{ value: Json; bytes: number; undefinedPaths: readonly PrivateIntermediateJsonPath[] }>, Failure> {
  const undefinedPaths: PrivateIntermediateJsonPath[] = [];
  return capture(input, bounds.bytes, failure, true, false, false, { bounds, onOmitted: undefined,
    onUndefinedSlot: path => { appendElement(undefinedPaths, Object.freeze([...path])); },
  }).pipe(Result.map(captured => Object.freeze({ ...captured, undefinedPaths: Object.freeze(undefinedPaths) })));
}

interface CaptureRefusal {
  readonly reason: "limitExceeded" | "invalidInput";
  readonly cause?: unknown;
}
interface OmissionCapture {
  readonly bounds: Readonly<{ bytes: number; nodes: number; depth: number }>;
  readonly onOmitted: ((path: readonly string[]) => void) | undefined;
  readonly onUndefinedSlot?: (path: PrivateIntermediateJsonPath) => void;
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
  requireWellFormedUnicode: boolean,
  omission?: OmissionCapture,
): Result.Result<Readonly<{ value: Json; bytes: number }>, Failure> {
  let remaining = maximum;
  let visitedNodes = 0;
  let undefinedPathNodes = 1, undefinedPathBytes = 2, undefinedPathCount = 0;
  let strictRefusal: CaptureRefusal | undefined;
  let nativeRefusal: CaptureRefusal | undefined;
  // Facts of the container the latest `visit` returned. A parent reads them only
  // for a returned object, which every such return has just described.
  let returnedFacts: CapturedPrivateJsonDataFacts | undefined;
  const active = omission === undefined ? undefined : new Set<object>();
  const onOmitted = omission?.onOmitted, onUndefinedSlot = omission?.onUndefinedSlot;
  const tracksPaths = onOmitted !== undefined || onUndefinedSlot !== undefined;
  const refuseStrict = (reason: CaptureRefusal["reason"], cause?: unknown): void => {
    strictRefusal ??= { reason, cause };
  };
  /** Descriptor and structure refusals are native under omission, strict otherwise. */
  const refuseStructure = (reason: CaptureRefusal["reason"], cause?: unknown): null => {
    if (omission === undefined) refuseStrict(reason, cause);
    else nativeRefusal = { reason, cause };
    return null;
  };
  const spend = (bytes: number): void => {
    if (strictRefusal !== undefined) return;
    remaining -= bytes;
    if (remaining < 0) refuseStrict("limitExceeded");
  };
  const visit = (valueInput: unknown, depth: number, path: PrivateIntermediateJsonPath): Json => {
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
      returnedFacts = issued;
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
      return refuseStructure("invalidInput", cause);
    }
    if ((isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
      (active !== undefined && active.has(valueInput))) return refuseStructure("invalidInput");
    const keyCount = keys.length;
    if (omission !== undefined) {
      active?.add(valueInput);
      if (keyCount > omission.bounds.nodes) { nativeRefusal = { reason: "limitExceeded" }; return null; }
    } else {
      for (let position = 0; position < keyCount; position++)
        if (typeof keys[position] !== "string") { refuseStrict("invalidInput"); return null; }
    }
    const remainingBefore = remaining;
    const refusalBefore = strictRefusal;
    spend(2);
    if (omission === undefined && keyCount > remaining + 1) { refuseStrict("limitExceeded"); return null; }
    const array: Json[] = [];
    const record: { [key: string]: Json } = {};
    let nodes = 1, relativeDepth = 0, negativeZero = false, wellFormedUnicode = true;
    let index = 0;
    let arrayKeysDense = true;
    for (let position = 0; position < keyCount; position++) {
      const key = keys[position];
      if (isArray && key === "length") continue;
      if (typeof key !== "string" || (omission === undefined && isArray && key !== String(index)))
        return refuseStructure("invalidInput");
      let descriptor: PropertyDescriptor | undefined;
      try { descriptor = Object.getOwnPropertyDescriptor(valueInput, key); }
      catch (cause) { return refuseStructure("invalidInput", cause); }
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true)
        return refuseStructure("invalidInput");
      const member: unknown = descriptor.value;
      const childPath = tracksPaths ? [...path, isArray ? Number(key) : key] : noPath;
      const undefinedSlot = onUndefinedSlot !== undefined && member === undefined;
      if (omission !== undefined && onUndefinedSlot !== undefined && undefinedSlot) {
        // Sidecar paths are retained data too. Bound their accumulation before
        // the caller charges the complete private envelope to its root budget.
        undefinedPathNodes += childPath.length + 1;
        const metadataRemaining = omission.bounds.bytes - undefinedPathBytes - (undefinedPathCount === 0 ? 0 : 1);
        if (undefinedPathNodes > omission.bounds.nodes || metadataRemaining < 0) {
          nativeRefusal = { reason: "limitExceeded" }; return null;
        }
        const measured = measureCanonicalJsonUtf8Bytes(childPath, metadataRemaining);
        if (measured.kind !== "success") {
          nativeRefusal = { reason: measured.kind === "invalid" ? "invalidInput" : "limitExceeded" };
          return null;
        }
        undefinedPathBytes += measured.bytes + (undefinedPathCount++ === 0 ? 0 : 1);
        onUndefinedSlot(childPath);
      }
      if (omission !== undefined && member === undefined && !isArray) {
        onOmitted?.(childPath.map(String));
        continue;
      }
      if (index > 0) spend(1);
      if (!isArray && strictRefusal === undefined) {
        const keySize = measureCanonicalJsonUtf8Bytes(key, remaining);
        if (keySize.kind !== "success") refuseStrict("limitExceeded");
        else spend(keySize.bytes + 1);
        wellFormedUnicode = unicodePattern.test(key) && wellFormedUnicode;
      }
      const value = visit(undefinedSlot ? null : member, depth + 1, childPath);
      if (nativeRefusal !== undefined || (omission === undefined && strictRefusal !== undefined)) return null;
      const child = value !== null && typeof value === "object" ? returnedFacts : undefined;
      if (child === undefined) {
        nodes += 1;
        if (relativeDepth < 1) relativeDepth = 1;
        if (typeof value === "number") negativeZero ||= Object.is(value, -0);
        else if (typeof value === "string") wellFormedUnicode = unicodePattern.test(value) && wellFormedUnicode;
      } else {
        nodes += child.nodes;
        if (relativeDepth < 1 + child.depth) relativeDepth = 1 + child.depth;
        negativeZero ||= child.negativeZero;
        wellFormedUnicode = child.wellFormedUnicode && wellFormedUnicode;
      }
      if (isArray) appendElement(array, value);
      else defineMember(record, key, value);
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
      catch (cause) { return refuseStructure("invalidInput", cause); }
      if (length?.value !== array.length || !arrayKeysDense) return refuseStructure("invalidInput");
    }
    if (omission !== undefined) {
      active?.delete(valueInput);
      // The strict capture's container key-count check precedes child byte or
      // primitive checks. Omitted keys become known only after native validation.
      if (refusalBefore === undefined && index + (isArray ? 1 : 0) > remainingBefore - 1)
        strictRefusal = { reason: "limitExceeded" };
    }
    if (strictRefusal !== undefined) return null;
    const value = isArray ? Object.freeze(array) : Object.freeze(record);
    const facts = Object.freeze({ value, bytes: remainingBefore - remaining,
      nodes, depth: relativeDepth, negativeZero, wellFormedUnicode });
    capturedValues.set(value, facts);
    if (!wellFormedUnicode) {
      // Only malformed subtrees need a refusal selection. Enumerate the captured
      // object: numeric keys regain native order even after foreign proxy keys.
      if (isArray) {
        for (const member of array) {
          const issue = unicodeRefusal(member);
          if (issue !== undefined) { capturedUnicodeRefusals.set(value, issue); break; }
        }
      } else {
        for (const [key, member] of Object.entries(value)) {
          const issue = !unicodePattern.test(key) ? key : unicodeRefusal(member);
          if (issue !== undefined) { capturedUnicodeRefusals.set(value, issue); break; }
        }
      }
    }
    returnedFacts = facts;
    return value;
  };
  const value = visit(input, 0, noPath);
  const refusal = nativeRefusal ?? strictRefusal;
  if (refusal !== undefined) return Result.fail(failure(refusal.reason, refusal.cause));
  const captured = Object.freeze({ value, bytes: maximum - remaining });
  // JSON's byte contract permits escaped lone surrogates. The outcome policy
  // refuses them only after the complete descriptor and byte capture succeeds.
  const malformedUnicode = requireWellFormedUnicode ? unicodeRefusal(value) : undefined;
  return malformedUnicode === undefined
    ? Result.succeed(captured)
    : decodeUnicodeRefusal(malformedUnicode).pipe(
      Result.mapError(cause => failure("invalidInput", cause)), Result.map(() => captured));
}

function unicodeRefusal(value: Json): string | undefined {
  if (typeof value === "string") return unicodePattern.test(value) ? undefined : value;
  return value !== null && typeof value === "object" ? capturedUnicodeRefusals.get(value) : undefined;
}
