import { Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeDocumentId, DeveloperDocumentIdSchema, encodeDocumentId, normalizeDocumentId } from "../src/document-id";

// Source-derived vectors: pinned id_v6.rs VInt, [0..15] internal ID, footer
// (sum(bytes), sum(reverse-position*byte)) modulo256, Crockford base32.
const vectors = [
  [1, "040020g30g2gc1r81450p30d1r7qke8"],
  [127, "fw0020g30g2gc1r81450p30d1r7ze5r"],
  [128, "g00g00820c20a1g7104gm2rc1m70zyds"],
  [16384, "g2002001081g81860w40j2gb1g6gw3vs74"],
  [4294967295, "zzzzzzrf000g40r40m30e209185gr38e1y1nj"],
] as const;

describe("Convex v6 document identities", () => {
  it("preserves VInt boundaries, unsigned table numbers and exact source-derived bytes", () => {
    const internal = Uint8Array.from({ length: 16 }, (_, i) => i);
    for (const [tableNumber, text] of vectors) {
      expect(Result.getOrThrow(encodeDocumentId(tableNumber, internal))).toBe(text);
      expect(Result.getOrThrow(decodeDocumentId(text))).toEqual({ id: text, tableNumber, internalId: internal });
      expect(Schema.is(DeveloperDocumentIdSchema)(text)).toBe(true);
    }
    const decoded = Result.getOrThrow(decodeDocumentId(vectors[0][1]));
    decoded.internalId.fill(255);
    expect(Result.getOrThrow(decodeDocumentId(vectors[0][1])).internalId).toEqual(internal);
  });

  it("rejects checksum/version corruption and noncanonical encodings", () => {
    const text = vectors[0][1];
    for (const input of [null, 1, "", text.toUpperCase(), text + "0", text.slice(1), text.slice(0, -1) + "9", text.slice(0, -1) + "a", text.slice(0, -1) + "i", "1:00000000-0000-0000-0000-000000000000"]) {
      expect(Result.isFailure(decodeDocumentId(input)), String(input)).toBe(true);
    }
    // Nonminimal VInt zero extension: table1 as 0x81,0x00, valid checksum.
    expect(Result.isFailure(decodeDocumentId("g400000000000000000000000000108j"))).toBe(true);
  });

  it("requires a nonzero u32 table and sixteen internal bytes", () => {
    for (const table of [0, -1, 1.5, NaN, Infinity, 4294967296])
      expect(encodeDocumentId(table, new Uint8Array(16))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidTableNumber" } });
    for (const size of [0, 15, 17])
      expect(encodeDocumentId(1, new Uint8Array(size))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInternalId" } });
  });
});

describe("Convex normalizeId developer formats", () => {
  const normalized = (table: number, value: unknown) => Result.getOrThrow(normalizeDocumentId(table, value));
  it("normalizes source v5 base64url and keeps ordinary reads canonical v6", () => {
    const old = "AAECAwQFBgcICQoLDA0ODw";
    expect(Option.getOrThrow(normalized(1, old))).toBe(vectors[0][1]);
    expect(Option.getOrThrow(normalized(1, vectors[0][1]))).toBe(vectors[0][1]);
    expect(Result.isFailure(decodeDocumentId(old))).toBe(true);
    for (const invalid of [old + "=", old.slice(0, -1) + "x", old.slice(1), old.replace("A", "+"), "", null, 1])
      expect(Option.isNone(normalized(1, invalid)), String(invalid)).toBe(true);
    expect(Option.isNone(normalized(2, vectors[0][1]))).toBe(true);
  });

  it("preserves the pinned v4 little-endian base62 and SHA256 conversion", () => {
    // Source-derived, independently calculated: old payload bytes [0..16],
    // kryptco digits LSB-first; SHA256([0..14])[0..14] + day bytes 15,16.
    const expected = Uint8Array.from([0x70, 0x71, 0xfc, 0x31, 0x88, 0xfd, 0xe7, 0xe7,
      0xe5, 0x00, 0xd4, 0x76, 0x8f, 0x17, 0x0f, 0x10]);
    // Source decoder removes its first byte without requiring the encoder's 1.
    for (const old of ["sJ4KfQiVw3VptW3x9I3ZcAW", "uk9Ac0anqU5yM3g9h3CEDL21",
      "sJ4KfQiVw3VptW3x9I3ZcAW" + "0".repeat(1000)]) {
      const value = Option.getOrThrow(normalized(10001, old));
      expect(Result.getOrThrow(decodeDocumentId(value))).toMatchObject({ tableNumber: 10001, internalId: expected });
      expect(Result.isFailure(decodeDocumentId(old))).toBe(true);
    }
    for (const invalid of ["sJ4KfQiVw3VptW3x9I3ZcA!", "Z".repeat(1000), "0".repeat(1000)])
      expect(Option.isNone(normalized(10001, invalid))).toBe(true);
  });
});
