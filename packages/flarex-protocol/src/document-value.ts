/**
 * Convex internal JSON mapping translated from npm-packages/convex/src/values/
 * value.ts at db914cf06e2b06ee985646611b9e12ed7a770318 (Apache-2.0,
 * Copyright 2026 Convex, Inc.; see that package's LICENSE).
 * Descriptor-safe capture reuses the existing authoritative runtime normalizer;
 * its size/nesting/array/field limits match crates/value/src/{size,array,object}.rs.
 * The old value envelope and NUL-string JSON tag are deliberately not used.
 */
import { Data, Encoding, Result, Schema } from "effect";
import { JsonValue, isJsonArray, isJsonObject, type Json } from "./json";
import {
  FlarexValueRuntimeCoreV1Error,
  MAX_FLAREX_APP_DOCUMENT_NESTING_V1,
  MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
  MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1,
  MAX_FLAREX_VALUE_NESTING_V1,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexRuntimeValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type FlarexValueCodecV1Issue,
  type FlarexValueProfileV1,
  type NormalizedFlarexRuntimeValueV1,
} from "./value-runtime-core";

export type DocumentValue = CanonicalFlarexRuntimeValueV1;
export type DocumentObject = CanonicalFlarexRuntimeObjectV1;
export type CapturedDocumentValue = Omit<NormalizedFlarexRuntimeValueV1, "profile">;
export type CapturedDocumentObject = Omit<CapturedDocumentValue, "value"> & {
  readonly value: DocumentObject;
};

export class DocumentValueError extends Data.TaggedError("DocumentValueError")<{
  readonly reason: "invalidValue" | "invalidJson" | "invalidTag";
  readonly issue?: FlarexValueCodecV1Issue;
}> {}

const decodeJson = Schema.decodeUnknownResult(JsonValue);
const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Returns detached, frozen containers and copied binary leaves. Once the codec
 * has walked a tree that could not change under it and held scalar leaves only
 * (a frozen input, a root this module issued, or a tree it decoded), later
 * captures of that walk's output return it without another walk. */
export function captureDocumentValue(value: unknown): Result.Result<DocumentValue, DocumentValueError> {
  return captureDocumentValueWithSize(value).pipe(Result.map(captured => captured.value));
}

/** Capture and semantic accounting share the authoritative traversal. */
export function captureDocumentValueWithSize(value: unknown): Result.Result<CapturedDocumentValue, DocumentValueError> {
  return capture(value, "generalValue");
}

/** Enforces the pinned full-document 1 MiB / nesting-16 object profile. */
export function captureDocumentObject(value: unknown): Result.Result<DocumentObject, DocumentValueError> {
  return captureDocumentObjectWithSize(value).pipe(Result.map(captured => captured.value));
}

export function captureDocumentObjectWithSize(value: unknown): Result.Result<CapturedDocumentObject, DocumentValueError> {
  return capture(value, "appDocument").pipe(Result.flatMap(captured =>
    isCanonicalFlarexRuntimeObjectV1(captured.value)
      ? Result.succeed(Object.freeze({ ...captured, value: captured.value }))
      : Result.fail(new DocumentValueError({ reason: "invalidValue" }))));
}

/** Top-level undefined means patch deletion; nested undefined remains omitted. */
export function captureDocumentPatch(value: unknown): Result.Result<
  Readonly<Record<string, DocumentValue | undefined>>, DocumentValueError
> {
  return Result.gen(function* () {
    const captured = yield* captureDocumentObject(value);
    // The shared capture above proves data-only shape without evaluating getters.
    if (value === null || typeof value !== "object")
      return yield* Result.fail(new DocumentValueError({ reason: "invalidValue" }));
    const deletions: Record<string, null> = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
        return yield* Result.fail(new DocumentValueError({ reason: "invalidValue" }));
      if (descriptor.value === undefined) Object.defineProperty(deletions, key, { enumerable: true, value: null });
    }
    // The authoritative normalizer deliberately omits undefined object values.
    // Validate deletion names through it too, rather than a second field validator.
    yield* captureDocumentValue(deletions);
    const patch: Record<string, DocumentValue | undefined> = {};
    for (const [key, child] of Object.entries(captured)) Object.defineProperty(patch, key, { enumerable: true, value: child });
    for (const key of Object.keys(deletions)) Object.defineProperty(patch, key, { enumerable: true, value: undefined });
    return Object.freeze(patch);
  });
}

/** Container roots issued by capture: their complete trees are normalized and
 * frozen by the authoritative codec. Binary leaves stay owned by that tree.
 * `proven` is the codec's own output for a walk whose input held scalar leaves
 * only and could not change: the walk of a frozen tree, a later walk of that
 * root, or the walk of a tree this module decoded.
 * `false` records that the root can never be proven. */
interface IssuedRoot {
  /** Size the codec measured at issuance; a genuine tree costs no more. */
  readonly semanticSizeBytes: number;
  proven: CapturedDocumentValue | false | undefined;
}
const capturedRoots = new WeakMap<object, IssuedRoot>();
/** True only for a root this module captured; structural checks never qualify. */
export function isCapturedDocumentRoot(value: DocumentValue): boolean {
  return typeof value === "object" && value !== null && capturedRoots.has(value);
}
/** True only for a root this module issued and has itself seen to be frozen
 * plain containers over scalar leaves, so it cannot change and holds no binary
 * leaf. Identity is the evidence; a look-alike tree never qualifies. */
export function isProvenScalarDocumentRoot(value: DocumentValue): boolean {
  const proven = typeof value === "object" && value !== null ? capturedRoots.get(value)?.proven : undefined;
  return proven !== undefined && proven !== false;
}

/** Frozen plain containers over scalar leaves cannot change after this check,
 * and the codec copies nothing foreign out of them. A binary leaf can be
 * written, transferred or detached by any holder, and the codec copies it
 * through the input's own method, so a tree with one is never proven.
 * Each node is charged no more than the codec's semantic size for it, so a
 * size the codec measured, or the limit it would refuse above, bounds the walk. */
function isImmutableScalarTree(value: unknown, depth: number, budget: { bytes: number }): boolean {
  if (value === null || typeof value === "boolean") return --budget.bytes >= 0;
  if (typeof value === "number" || typeof value === "bigint") return (budget.bytes -= 9) >= 0;
  if (typeof value === "string") return (budget.bytes -= 2 + value.length) >= 0;
  if (typeof value !== "object" || (budget.bytes -= 2) < 0 || depth > MAX_FLAREX_VALUE_NESTING_V1) return false;
  // Frozen first: a Proxy that reports frozen has a frozen target, and the
  // language then pins its prototype, keys and values for every later read.
  if (!Object.isFrozen(value)) return false;
  const array = Array.isArray(value);
  // Exact prototypes: the codec tests for a binary value before an array.
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    if (typeof key !== "string" || (!array && (budget.bytes -= key.length + 1) < 0)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) ||
      !isImmutableScalarTree(descriptor.value, depth + 1, budget)) return false;
  }
  return true;
}

/** The shape check reads a Proxy's extensibility, which the codec never does.
 * A trap that throws there proves nothing and leaves the outcome to the codec. */
function isPinnedScalarTree(value: unknown, bytes: number): boolean {
  try {
    return isImmutableScalarTree(value, 0, { bytes });
  } catch {
    return false;
  }
}

function capture(value: unknown, profile: FlarexValueProfileV1,
  ownScalarTree = false): Result.Result<CapturedDocumentValue, DocumentValueError> {
  const issued = typeof value === "object" && value !== null ? capturedRoots.get(value) : undefined;
  const proven = issued?.proven;
  // The codec produced these facts for this content from scalar-only input,
  // under this profile's limits or stricter ones; every other case walks.
  if (proven !== undefined && proven !== false && proven.semanticSizeBytes <= limitBytes(profile) &&
    proven.nestingDepth <= limitNesting(profile) && !(profile === "appDocument" && Array.isArray(proven.value)))
    return Result.succeed(proven);
  // Shape is pinned before the codec walks it, so both inspect the same tree.
  // `ownScalarTree` is this module's own fresh tree without a binary leaf: the
  // codec copies nothing foreign out of it, so its output needs no second walk.
  // Any other frozen scalar tree is pinned the same way whoever built it; a
  // tree larger than the profile's limit is refused by the codec's own walk.
  const proving = ownScalarTree || (proven === undefined && typeof value === "object" && value !== null &&
    isPinnedScalarTree(value, issued?.semanticSizeBytes ?? limitBytes(profile)));
  if (issued !== undefined && proven === undefined && !proving) issued.proven = false;
  return Result.try({
    try: () => {
      const { value: captured, semanticSizeBytes, nestingDepth } = normalizeFlarexRuntimeValueV1(value, profile);
      const result = Object.freeze({ value: captured, semanticSizeBytes, nestingDepth });
      if (typeof captured === "object" && captured !== null && !(captured instanceof ArrayBuffer))
        capturedRoots.set(captured, { semanticSizeBytes, proven: proving ? result : undefined });
      // Later captures of either root return this output, never the first tree.
      if (proving && issued !== undefined) issued.proven = result;
      return result;
    },
    catch: (cause: unknown) => {
      if (proving && issued !== undefined) issued.proven = false;
      if (cause instanceof FlarexValueRuntimeCoreV1Error)
        return new DocumentValueError({ reason: "invalidValue", issue: cause.issue });
      throw cause;
    },
  });
}
const limitBytes = (profile: FlarexValueProfileV1) =>
  profile === "appDocument" ? MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1 : MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1;
const limitNesting = (profile: FlarexValueProfileV1) =>
  profile === "appDocument" ? MAX_FLAREX_APP_DOCUMENT_NESTING_V1 : MAX_FLAREX_VALUE_NESTING_V1;

/** UTF-8 internal JSON for the complete document; no private outer envelope. */
export function encodeDocumentValue(value: unknown): Result.Result<Uint8Array, DocumentValueError> {
  return captureDocumentValue(value).pipe(Result.map(captured => utf8.encode(JSON.stringify(toJson(captured)))));
}

export function decodeDocumentValue(bytes: Uint8Array): Result.Result<DocumentValue, DocumentValueError> {
  return Result.gen(function* () {
    const text = yield* Result.try({
      try: () => utf8Decoder.decode(bytes),
      catch: (cause: unknown) => {
        if (cause instanceof TypeError) return new DocumentValueError({ reason: "invalidJson" });
        throw cause;
      },
    });
    const parsed = yield* Result.try({
      try: (): unknown => JSON.parse(text),
      catch: (cause: unknown) => {
        if (cause instanceof SyntaxError) return new DocumentValueError({ reason: "invalidJson" });
        throw cause;
      },
    });
    const json = yield* decodeJson(parsed).pipe(Result.mapError(() => new DocumentValueError({ reason: "invalidJson" })));
    const built = { binary: false };
    const value = yield* Result.try({
      try: () => fromJson(json, 0, built),
      catch: (cause: unknown) => {
        if (cause instanceof DocumentValueError) return cause;
        throw cause;
      },
    });
    return (yield* capture(value, "generalValue", !built.binary)).value;
  });
}

function toJson(value: DocumentValue): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigInt64(0, value, true);
    return { $integer: Encoding.encodeBase64(new Uint8Array(buffer)) };
  }
  if (typeof value === "number") {
    if (!isSpecialFloat(value)) return value;
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    return { $float: Encoding.encodeBase64(new Uint8Array(buffer)) };
  }
  if (value instanceof ArrayBuffer) return { $bytes: Encoding.encodeBase64(new Uint8Array(value)) };
  if (isDocumentArray(value)) return value.map(toJson);
  const object: Record<string, Json> = {};
  for (const key of Object.keys(value).toSorted()) {
    const child = value[key];
    if (child !== undefined) Object.defineProperty(object, key, { enumerable: true, value: toJson(child) });
  }
  return object;
}

/** Builds this module's own fresh tree; refusals are thrown to the decode
 * boundary because a Result per node would allocate without adding one. */
function fromJson(value: Json, parentNesting: number, built: { binary: boolean }): DocumentValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (isJsonArray(value)) {
    if (parentNesting >= MAX_FLAREX_VALUE_NESTING_V1) throw new DocumentValueError({ reason: "invalidValue" });
    const array: DocumentValue[] = [];
    for (const child of value) array.push(fromJson(child, parentNesting + 1, built));
    return array;
  }
  if (!isJsonObject(value)) throw new DocumentValueError({ reason: "invalidTag" });
  const entries = Object.entries(value);
  const entry = entries.length === 1 ? entries[0] : undefined;
  if (entry !== undefined && entry[0].startsWith("$")) {
    const [tag, encoded] = entry;
    if ((tag !== "$bytes" && tag !== "$integer" && tag !== "$float") || typeof encoded !== "string")
      throw new DocumentValueError({ reason: "invalidTag" });
    const decoded = Result.getOrThrowWith(Encoding.decodeBase64(encoded), () => new DocumentValueError({ reason: "invalidTag" }));
    if (tag === "$bytes") { built.binary = true; return decoded.slice().buffer; }
    if (decoded.byteLength !== 8) throw new DocumentValueError({ reason: "invalidTag" });
    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    if (tag === "$integer") return view.getBigInt64(0, true);
    const float = view.getFloat64(0, true);
    if (!isSpecialFloat(float)) throw new DocumentValueError({ reason: "invalidTag" });
    return float;
  }
  if (parentNesting >= MAX_FLAREX_VALUE_NESTING_V1) throw new DocumentValueError({ reason: "invalidValue" });
  const object: Record<string, DocumentValue> = {};
  for (const [key, child] of entries) Object.defineProperty(object, key, {
    enumerable: true, value: fromJson(child, parentNesting + 1, built),
  });
  return object;
}

export function isDocumentArray(value: DocumentValue): value is readonly DocumentValue[] {
  return Array.isArray(value);
}

function isSpecialFloat(value: number): boolean {
  return !Number.isFinite(value) || Object.is(value, -0);
}
