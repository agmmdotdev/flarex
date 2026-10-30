import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeDocumentId, DeveloperDocumentIdSchema, encodeDocumentId } from "../src/document-id";

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
