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

/** Returns detached, frozen containers and copied binary leaves. */
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

function capture(value: unknown, profile: FlarexValueProfileV1): Result.Result<CapturedDocumentValue, DocumentValueError> {
  return Result.try({
    try: () => {
      const { value: captured, semanticSizeBytes, nestingDepth } = normalizeFlarexRuntimeValueV1(value, profile);
      return Object.freeze({ value: captured, semanticSizeBytes, nestingDepth });
    },
    catch: (cause: unknown) => {
      if (cause instanceof FlarexValueRuntimeCoreV1Error)
        return new DocumentValueError({ reason: "invalidValue", issue: cause.issue });
      throw cause;
    },
  });
}

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
    const value = yield* fromJson(json);
    return yield* captureDocumentValue(value);
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

function fromJson(value: Json, parentNesting = 0): Result.Result<DocumentValue, DocumentValueError> {
  return Result.gen(function* () {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
    if (isJsonArray(value)) {
      if (parentNesting >= MAX_FLAREX_VALUE_NESTING_V1)
        return yield* Result.fail(new DocumentValueError({ reason: "invalidValue" }));
      const array: DocumentValue[] = [];
      for (const child of value) array.push(yield* fromJson(child, parentNesting + 1));
      return array;
    }
    if (!isJsonObject(value)) return yield* invalidTag();
    const entries = Object.entries(value);
    const entry = entries.length === 1 ? entries[0] : undefined;
    if (entry !== undefined && entry[0].startsWith("$")) {
      const [tag, encoded] = entry;
      if ((tag !== "$bytes" && tag !== "$integer" && tag !== "$float") || typeof encoded !== "string")
        return yield* invalidTag();
      const decoded = yield* Encoding.decodeBase64(encoded).pipe(Result.mapError(() => new DocumentValueError({ reason: "invalidTag" })));
      if (tag === "$bytes") return decoded.slice().buffer;
      if (decoded.byteLength !== 8) return yield* invalidTag();
      const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
      if (tag === "$integer") return view.getBigInt64(0, true);
      const float = view.getFloat64(0, true);
      if (!isSpecialFloat(float)) return yield* invalidTag();
      return float;
    }
    if (parentNesting >= MAX_FLAREX_VALUE_NESTING_V1)
      return yield* Result.fail(new DocumentValueError({ reason: "invalidValue" }));
    const object: Record<string, DocumentValue> = {};
    for (const [key, child] of entries) Object.defineProperty(object, key, {
      enumerable: true, value: yield* fromJson(child, parentNesting + 1),
    });
    return object;
  });
}

export function isDocumentArray(value: DocumentValue): value is readonly DocumentValue[] {
  return Array.isArray(value);
}

function isSpecialFloat(value: number): boolean {
  return !Number.isFinite(value) || Object.is(value, -0);
}

function invalidTag(): Result.Result<never, DocumentValueError> {
  return Result.fail(new DocumentValueError({ reason: "invalidTag" }));
}
