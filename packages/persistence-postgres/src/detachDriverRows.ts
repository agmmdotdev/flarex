import { isUint8Array } from "@flarex/utils/bytes";
import type * as EffectBrand from "effect/Brand";

/**
 * Detaches cloneable database-driver rows and freezes only the owned array.
 * Domain decoding, nested freezing, and specialized byte/date ownership remain
 * with the consuming persistence boundary.
 */
export type StructuredCloneSafeDriverValue<Value> =
  Value extends CallableFunction
    ? never
    : Value extends null | undefined | string | number | boolean | bigint
    ? Value
    : Value extends Date
      ? ExactCloneBuiltin<Value, Date>
      : Value extends Uint8Array<infer Buffer>
        ? ExactCloneBuiltin<Value, Uint8Array<Buffer>>
        : Value extends Array<infer Element>
          ? Array<StructuredCloneSafeDriverValue<Element>>
          : Value extends ReadonlyArray<infer Element>
            ? ReadonlyArray<StructuredCloneSafeDriverValue<Element>>
            : Value extends object
              ? {
                  readonly [Key in keyof Value]:
                    StructuredCloneSafeDriverValue<Value[Key]>;
                }
              : never;

type UnbrandedEffectValue<Value> =
  Value extends EffectBrand.Brand<infer _Keys>
    ? EffectBrand.Brand.Unbranded<Value>
    : Value;

type ExactCloneBuiltin<Value, Base> =
  UnbrandedEffectValue<Value> extends Base
    ? Base extends UnbrandedEffectValue<Value>
      ? Value
      : never
    : never;

export type StructuredCloneSafeDriverRow<Row extends object> = {
  readonly [Key in keyof Row]: StructuredCloneSafeDriverValue<Row[Key]>;
};

export function detachDriverRows<Row extends object>(
  rows: ReadonlyArray<Row> &
    ReadonlyArray<StructuredCloneSafeDriverRow<NoInfer<Row>>>,
): ReadonlyArray<Row> {
  assertPlainDriverRows(rows);
  return detachRows<Row>(rows);
}

export function detachUnknownDriverRows(
  rows: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> {
  return detachRows(rows);
}

function detachRows<Row>(rows: ReadonlyArray<Row>): ReadonlyArray<Row> {
  return Object.freeze(structuredClone(rows));
}

function assertPlainDriverRows(rows: ReadonlyArray<object>): void {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
    throw new TypeError("Driver rows must use a plain array.");
  }
  const seen = new WeakSet<object>();
  seen.add(rows);
  assertPlainArrayProperties(rows, seen, "Driver rows");
}

function assertPlainDriverValue(value: unknown, seen: WeakSet<object>): void {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError("Driver rows contain an unsupported value.");
  }
  if (isIntrinsicDate(value)) return;
  if (isUint8Array(value)) {
    assertCloneDetachesUint8Array(value);
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError("Driver row arrays must use the plain prototype.");
    }
    assertPlainArrayProperties(value, seen, "Driver row arrays");
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Driver rows must contain only plain records.");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError("Driver row records must use string keys.");
    }
    assertEnumerableDataProperty(value, key, seen);
  }
}

function assertPlainArrayProperties(
  value: ReadonlyArray<unknown>,
  seen: WeakSet<object>,
  owner: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !isArrayIndexKey(key)) {
      throw new TypeError(`${owner} contain an unsupported key.`);
    }
    assertEnumerableDataProperty(value, key, seen);
  }
}

function assertEnumerableDataProperty(
  owner: object,
  key: string,
  seen: WeakSet<object>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new TypeError(
      "Driver rows must contain only enumerable data properties.",
    );
  }
  assertPlainDriverValue(descriptor.value, seen);
}

function isIntrinsicDate(value: object): boolean {
  try {
    Date.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        SharedArrayBuffer.prototype,
        "byteLength",
      )?.get;

function assertCloneDetachesUint8Array(value: Uint8Array): void {
  if (TYPED_ARRAY_BUFFER_GETTER === undefined) {
    throw new TypeError("Uint8Array intrinsic buffer access is unavailable.");
  }
  const buffer: unknown = TYPED_ARRAY_BUFFER_GETTER.call(value);
  if (isIntrinsicSharedArrayBuffer(buffer)) {
    throw new TypeError(
      "Driver row bytes must not use SharedArrayBuffer storage.",
    );
  }
}

function isIntrinsicSharedArrayBuffer(value: unknown): boolean {
  if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return false;
  try {
    SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value);
    return true;
  } catch {
    return false;
  }
}

function isArrayIndexKey(key: string): boolean {
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < 4_294_967_295 &&
    String(index) === key
  );
}
