/**
 * Mechanisms translated from Convex crates/common/src/document.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Result, Schema } from "effect";
import { captureDocumentObjectWithSize, captureDocumentValueWithSize, DocumentValueError,
  type DocumentObject } from "flarex-protocol/document-value";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/internal/value-runtime-core";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";

export interface CoreMeasuredDocument {
  readonly value: DocumentObject;
  readonly semanticSizeBytes: number;
  readonly nestingDepth: number;
}

/** Source's allocation cursor can be zero; increment only requires finite nonnegative values. */
export const CoreCreationTimeSchema = Schema.Finite.check(
  Schema.makeFilter(value => value >= 0 && !Object.is(value, -0) ? undefined : "Expected a nonnegative finite creation-time cursor"),
);
/** Resolved documents have a narrower intrinsic-field domain than their cursor. */
const DocumentCreationTimeSchema = CoreCreationTimeSchema.check(
  Schema.makeFilter(value => value > 0 && value < 2 ** 53 ? undefined : "Expected a positive finite creation time below2^53"),
);
const SystemFields = Schema.Struct({ _id: DeveloperDocumentIdSchema, _creationTime: DocumentCreationTimeSchema });
const decodeSystemFields = Schema.decodeUnknownResult(SystemFields);
const decodeCreationTime = Schema.decodeUnknownResult(CoreCreationTimeSchema);

/** Return the old cursor only after its next representable value is valid. */
export function incrementCoreCreationTime(current: number): Result.Result<Readonly<{
  value: number; next: number;
}>, DocumentValueError> {
  return Result.gen(function* () {
    const value = yield* Result.mapError(decodeCreationTime(current), () => new DocumentValueError({ reason: "invalidValue" }));
    let successor: number;
    if (value === 0) successor = Number.MIN_VALUE;
    else {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, value);
      view.setBigUint64(0, view.getBigUint64(0) + 1n);
      successor = view.getFloat64(0);
    }
    const next = yield* Result.mapError(decodeCreationTime(successor), () => new DocumentValueError({ reason: "invalidValue" }));
    return { value, next };
  });
}

/** User object profile1MiB/16; private metadata values may use general32MiB/64. */
export function captureCoreObject(value: unknown, system: boolean): Result.Result<CoreMeasuredDocument, DocumentValueError> {
  return Result.flatMap(system ? captureDocumentValueWithSize(value) : captureDocumentObjectWithSize(value), captured =>
    isCanonicalFlarexRuntimeObjectV1(captured.value)
      ? Result.succeed({ ...captured, value: captured.value })
      : Result.fail(new DocumentValueError({ reason: "invalidValue" })));
}

/** Full documents additionally require canonical system fields and nesting<=16. */
export function captureCoreDocument(value: unknown, system: boolean): Result.Result<CoreMeasuredDocument, DocumentValueError> {
  return Result.gen(function* () {
    const captured = yield* captureCoreObject(value, system);
    yield* Result.mapError(decodeSystemFields(captured.value), () => new DocumentValueError({ reason: "invalidValue" }));
    if (captured.nestingDepth > 16 || Object.keys(captured.value).some(name => name.startsWith("_") && name !== "_id" && name !== "_creationTime"))
      return yield* Result.fail(new DocumentValueError({ reason: "invalidValue" }));
    return captured;
  });
}
