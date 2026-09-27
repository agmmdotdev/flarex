import { Data, Result, Schema } from "effect";

import {
  encodeCanonicalJson,
  JsonValue,
} from "./json";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

export const ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1 =
  "flarex.admitted-framework-operation";
export const ADMITTED_FRAMEWORK_OPERATION_VERSION_V1 = 1;
export const MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1 = 1_048_576;
const MAX_ADMITTED_FRAMEWORK_OPERATION_NODES_V1 = 32_768;
const MAX_ADMITTED_FRAMEWORK_OPERATION_DEPTH_V1 = 64;

const textEncoder = new TextEncoder();
const BoundedSelection = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) =>
    textEncoder.encode(value).byteLength <= 128 &&
      !value.includes("\u0000")
      ? undefined
      : "Expected a bounded non-null selection"
  ),
);

const OperationSchema = Schema.Struct({
  format: Schema.Literal(ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1),
  version: Schema.Literal(ADMITTED_FRAMEWORK_OPERATION_VERSION_V1),
  participant: BoundedSelection,
  operation: BoundedSelection,
  args: JsonValue,
}).annotate(StrictStructOptions);

export type AdmittedFrameworkOperationV1 = typeof OperationSchema.Type;
const decodeOperationResult = Schema.decodeUnknownResult(
  OperationSchema,
  StrictParseOptions,
);

export class AdmittedFrameworkOperationV1Error extends Data.TaggedError(
  "AdmittedFrameworkOperationV1Error",
)<{
  readonly reason: "invalidShape" | "tooLarge" | "encodingInvariant";
  readonly cause?: unknown;
}> {}

/** This frame selects a trusted participant; it carries no write authority.
 * The parent journal capability supplies the attempt fence and sequence. */
export function decodeAdmittedFrameworkOperationV1Result(
  candidate: unknown,
): Result.Result<AdmittedFrameworkOperationV1, AdmittedFrameworkOperationV1Error> {
  return Result.flatMap(captureBoundedInput(candidate), captured =>
    decodeOperationResult(captured).pipe(Result.mapError(cause =>
      new AdmittedFrameworkOperationV1Error({ reason: "invalidShape", cause }))));
}

export function encodeAdmittedFrameworkOperationV1Result(
  candidate: unknown,
): Result.Result<
  Readonly<{ readonly operation: AdmittedFrameworkOperationV1; readonly bytes: Uint8Array }>,
  AdmittedFrameworkOperationV1Error
> {
  return Result.gen(function* () {
    const operation = yield* decodeAdmittedFrameworkOperationV1Result(candidate);
    let canonical: string;
    try {
      canonical = encodeCanonicalJson(operation, (cause) => {
        throw new AdmittedFrameworkOperationV1Error({
          reason: "encodingInvariant",
          cause,
        });
      });
    } catch (cause) {
      if (cause instanceof AdmittedFrameworkOperationV1Error) {
        return yield* Result.fail(cause);
      }
      throw cause;
    }
    const bytes = textEncoder.encode(canonical);
    if (bytes.byteLength > MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1) {
      return yield* Result.fail(new AdmittedFrameworkOperationV1Error({
        reason: "tooLarge",
      }));
    }
    return Object.freeze({ operation, bytes });
  });
}

/** Capture each data property exactly once before Schema visits it. The
 * pending count is charged before enqueueing so a wide object cannot allocate
 * an unbounded queue. The root also charges cumulative attempt budgets. */
function captureBoundedInput(
  candidate: unknown,
): Result.Result<unknown, AdmittedFrameworkOperationV1Error> {
  type Frame = Readonly<{ value: unknown; depth: number } & (
    { target: "root" } |
    { target: "array"; parent: unknown[]; index: number } |
    { target: "object"; parent: Record<string, unknown>; key: string }
  )>;
  const pending: Frame[] = [{ value: candidate, depth: 0, target: "root" }];
  let nodes = 0;
  let textUnits = 0;
  let captured: unknown;
  const fail = (reason: "invalidShape" | "tooLarge") => Result.fail(
    new AdmittedFrameworkOperationV1Error({ reason }),
  );
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) return fail("invalidShape");
    nodes += 1;
    if (
      nodes > MAX_ADMITTED_FRAMEWORK_OPERATION_NODES_V1 ||
      frame.depth > MAX_ADMITTED_FRAMEWORK_OPERATION_DEPTH_V1
    ) return fail("tooLarge");
    const value = frame.value;
    let copy: unknown = value;
    if (typeof value === "string") {
      textUnits += value.length;
      if (textUnits > MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1) {
        return fail("tooLarge");
      }
    } else if (value !== null && typeof value === "object") {
      let descriptors: Record<string, PropertyDescriptor>;
      try {
        const prototype = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
          return fail("invalidShape");
        }
        descriptors = Object.getOwnPropertyDescriptors(value);
      } catch {
        return fail("invalidShape");
      }
      if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
        return fail("invalidShape");
      }
      if (Array.isArray(value)) {
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 ||
          length > MAX_ADMITTED_FRAMEWORK_OPERATION_NODES_V1 - nodes - pending.length) {
          return fail("tooLarge");
        }
        if (Object.keys(descriptors).length !== length + 1) return fail("invalidShape");
        const array: unknown[] = Array.from({ length });
        copy = array;
        for (let index = length - 1; index >= 0; index -= 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor)) {
            return fail("invalidShape");
          }
          pending.push({ value: descriptor.value, depth: frame.depth + 1,
            target: "array", parent: array, index });
        }
      } else {
        const keys = Object.keys(descriptors);
        if (keys.length > MAX_ADMITTED_FRAMEWORK_OPERATION_NODES_V1 - nodes - pending.length) {
          return fail("tooLarge");
        }
        const object: Record<string, unknown> = Object.create(null);
        copy = object;
        for (const key of keys) {
          textUnits += key.length;
          if (textUnits > MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1) return fail("tooLarge");
          const descriptor = descriptors[key];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            return fail("invalidShape");
          }
          pending.push({ value: descriptor.value, depth: frame.depth + 1,
            target: "object", parent: object, key });
        }
      }
    }
    if (frame.target === "root") {
      captured = copy;
    } else if (frame.target === "array") {
      frame.parent[frame.index] = copy;
    } else {
      Object.defineProperty(frame.parent, frame.key, {
        value: copy, enumerable: true, configurable: true, writable: true,
      });
    }
  }
  return Result.succeed(captured);
}
