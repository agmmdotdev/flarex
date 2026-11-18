/** Pure canonical v6 ID mechanism shared with same-realm validator matching.
 * Pinned Convex db914cf06 value/{id_v6,base32}.rs. Encoding proves no authority. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const CHAR_AT = String.prototype.charAt;
const INDEX_OF = String.prototype.indexOf;
const SLICE = String.prototype.slice;
const APPLY = Reflect.apply;
const FREEZE = Object.freeze;
const BYTES = Uint8Array;
const TABLE_NUMBER_MAX_BYTES = 5;
export const INTERNAL_DOCUMENT_ID_BYTES = 16;
const CHECKSUM_BYTES = 2;
const MAX_BINARY_BYTES = TABLE_NUMBER_MAX_BYTES + INTERNAL_DOCUMENT_ID_BYTES + CHECKSUM_BYTES;

function checksum(bytes: Uint8Array, length: number): number {
  let low = 0;
  let high = 0;
  for (let index = 0; index < length; index += 1) {
    low = (low + bytes[index]!) & 255;
    high = (high + low) & 255;
  }
  return high << 8 | low;
}

/** Encodes a validated nonzero u32 table number and sixteen genuine ID bytes. */
export function encodeCanonicalDocumentId(tableNumber: number, internalId: Uint8Array): string {
  const bytes = new BYTES(MAX_BINARY_BYTES);
  let byteCount = 0;
  let remaining = tableNumber;
  while (remaining >= 128) {
    bytes[byteCount++] = remaining & 127 | 128;
    remaining >>>= 7;
  }
  bytes[byteCount++] = remaining;
  for (let index = 0; index < INTERNAL_DOCUMENT_ID_BYTES; index += 1) {
    bytes[byteCount++] = internalId[index]!;
  }
  const sum = checksum(bytes, byteCount);
  bytes[byteCount++] = sum & 255;
  bytes[byteCount++] = sum >>> 8;

  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (let index = 0; index < byteCount; index += 1) {
    accumulator = accumulator << 8 | bytes[index]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += APPLY(CHAR_AT, ALPHABET, [accumulator >>> bits & 31]);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += APPLY(CHAR_AT, ALPHABET, [accumulator << 5 - bits & 31]);
  return output;
}

export function decodeCanonicalDocumentIdParts(text: string): Readonly<{ tableNumber: number; internalId: Uint8Array }> | undefined {
  if (text.length < 31 || text.length > 37) return undefined;
  const bytes = new BYTES(MAX_BINARY_BYTES);
  let byteCount = 0;
  let accumulator = 0;
  let bits = 0;
  for (let index = 0; index < text.length; index += 1) {
    const digit: number = APPLY(INDEX_OF, ALPHABET, [APPLY(CHAR_AT, text, [index])]);
    if (digit < 0) return undefined;
    accumulator = accumulator << 5 | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteCount++] = accumulator >>> bits & 255;
      accumulator &= (1 << bits) - 1;
    }
  }
  let tableNumber = 0;
  let position = 0;
  for (; position < TABLE_NUMBER_MAX_BYTES; position += 1) {
    const byte = bytes[position]!;
    tableNumber += (byte & 127) * 2 ** (position * 7);
    if (byte < 128) {
      position += 1;
      break;
    }
  }
  const bodyEnd = position + INTERNAL_DOCUMENT_ID_BYTES;
  if (tableNumber < 1 || tableNumber > 0xffff_ffff || byteCount !== bodyEnd + CHECKSUM_BYTES) return undefined;
  const sum = checksum(bytes, bodyEnd);
  if (bytes[bodyEnd] !== (sum & 255) || bytes[bodyEnd + 1] !== (sum >>> 8)) return undefined;

  const internalId = new BYTES(INTERNAL_DOCUMENT_ID_BYTES);
  for (let index = 0; index < INTERNAL_DOCUMENT_ID_BYTES; index += 1) {
    internalId[index] = bytes[position + index]!;
  }
  if (encodeCanonicalDocumentId(tableNumber, internalId) !== text) return undefined;
  return FREEZE({ tableNumber, internalId });
}

/** Advisory fragments are ignored by admission and the caller's string is unchanged. */
export function isFunctionHandleString(value: string): boolean {
  if (APPLY(SLICE, value, [0, 11]) !== "function://") return false;
  const fragment: number = APPLY(INDEX_OF, value, ["#", 11]);
  const id: string = APPLY(SLICE, value, fragment < 0 ? [11] : [11, fragment]);
  return decodeCanonicalDocumentIdParts(id) !== undefined;
}
