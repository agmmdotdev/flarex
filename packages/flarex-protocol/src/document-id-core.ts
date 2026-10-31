/** Pure canonical v6 ID mechanism shared with same-realm validator matching.
 * Pinned Convex db914cf06 value/{id_v6,base32}.rs. Encoding proves no authority. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const CHAR_AT = String.prototype.charAt;
const INDEX_OF = String.prototype.indexOf;
const SLICE = String.prototype.slice;
const APPLY = Reflect.apply;
const DEFINE = Object.defineProperty;
const FREEZE = Object.freeze;
const FLOOR = Math.floor;
const BYTES = Uint8Array;
function push(array: number[], value: number): void { DEFINE(array, array.length, { value, configurable: true, enumerable: true, writable: true }); }
function checksum(bytes: readonly number[], length: number): number {
  let low = 0; let high = 0;
  for (let index = 0; index < length; index += 1) { low = (low + bytes[index]!) & 255; high = (high + low) & 255; }
  return high << 8 | low;
}
export function encodeCanonicalDocumentId(tableNumber: number, internalId: Uint8Array): string {
  const bytes: number[] = []; let remaining = tableNumber;
  while (remaining >= 128) { push(bytes, remaining % 128 | 128); remaining = FLOOR(remaining / 128); }
  push(bytes, remaining); for (let index = 0; index < internalId.length; index += 1) push(bytes, internalId[index]!);
  const sum = checksum(bytes, bytes.length); push(bytes, sum & 255); push(bytes, sum >>> 8);
  let output = ""; let accumulator = 0; let bits = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    accumulator = accumulator << 8 | bytes[index]!; bits += 8;
    while (bits >= 5) { bits -= 5; output += APPLY(CHAR_AT, ALPHABET, [accumulator >>> bits & 31]); }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += APPLY(CHAR_AT, ALPHABET, [accumulator << 5 - bits & 31]);
  return output;
}
export function decodeCanonicalDocumentIdParts(text: string): Readonly<{ tableNumber: number; internalId: Uint8Array }> | undefined {
  if (text.length < 31 || text.length > 37) return undefined;
  const bytes: number[] = []; let accumulator = 0; let bits = 0;
  for (let index = 0; index < text.length; index += 1) {
    const digit: number = APPLY(INDEX_OF, ALPHABET, [APPLY(CHAR_AT, text, [index])]); if (digit < 0) return undefined;
    accumulator = accumulator << 5 | digit; bits += 5;
    if (bits >= 8) { bits -= 8; push(bytes, accumulator >>> bits & 255); accumulator &= (1 << bits) - 1; }
  }
  let tableNumber = 0; let position = 0;
  for (; position < 5; position += 1) { const byte = bytes[position]; if (byte === undefined) return undefined; tableNumber += (byte & 127) * 2 ** (position * 7); if (byte < 128) { position += 1; break; } }
  if (tableNumber < 1 || tableNumber > 0xffff_ffff || bytes.length !== position + 18) return undefined;
  const sum = checksum(bytes, position + 16);
  if (bytes[position + 16] !== (sum & 255) || bytes[position + 17] !== (sum >>> 8)) return undefined;
  const internalId = new BYTES(16); for (let index = 0; index < 16; index += 1) internalId[index] = bytes[position + index]!;
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
