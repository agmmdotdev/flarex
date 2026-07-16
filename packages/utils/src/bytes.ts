/** Returns an owned byte array that does not share storage with the input. */
export function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
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
