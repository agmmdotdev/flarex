const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;

/** Returns an owned byte array that does not share storage with the input. */
export function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

/** Copies the visible bytes into a fresh, exactly sized ArrayBuffer. */
export function copyBytesToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

/**
 * Narrows an unknown value to a Uint8Array whose visible view has exactly the
 * requested byte length.
 */
export function isUint8ArrayWithByteLength(
  value: unknown,
  expectedByteLength: number,
): value is Uint8Array {
  try {
    if (
      !(value instanceof Uint8Array) ||
      TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
      TYPED_ARRAY_TAG_GETTER === undefined
    ) {
      return false;
    }
    const typedArrayTag: unknown = TYPED_ARRAY_TAG_GETTER.call(value);
    if (typedArrayTag !== "Uint8Array") return false;
    const byteLength: unknown = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value);
    return byteLength === expectedByteLength;
  } catch {
    return false;
  }
}

/**
 * Encodes the visible byte range as lowercase hexadecimal text.
 *
 * Intrinsic typed-array iteration reads the actual visible byte range, ignores
 * caller-overridden iterators, and preserves the platform TypeError for
 * detached views instead of treating a formerly non-empty view as empty.
 */
export function encodeBytesToLowercaseHex(value: Uint8Array): string {
  let encoded = "";
  for (const byte of Uint8Array.prototype.values.call(value)) {
    encoded += byte.toString(16).padStart(2, "0");
  }
  return encoded;
}

/**
 * Compares unsigned bytes lexicographically, with a shorter equal prefix
 * ordered before a longer one.
 */
export function compareBytesLexicographically(
  left: Uint8Array,
  right: Uint8Array,
): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

/** Compares byte arrays and returns as soon as a mismatch is found. */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Compares every byte of equal-length arrays before returning.
 *
 * Length mismatches still return immediately. JavaScript engines may optimize
 * this code, so it is not a cryptographic constant-time guarantee.
 */
export function bytesEqualFullScan(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
