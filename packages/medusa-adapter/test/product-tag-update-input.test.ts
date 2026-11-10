import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeProductTagUpdateInput } from "../src/modules/product/tag-update-input";

describe("native Product Tag selector update input", () => {
  it("admits omitted value and nullable object metadata", () => {
    for (const update of [{}, { metadata: {} }, { metadata: null }, { metadata: { nested: { enabled: true } } }, { value: "" }]) {
      const input = { selector: { id: "ptag_1" }, update };
      expect(Result.getOrThrow(decodeProductTagUpdateInput(input))).toEqual(input);
    }
  });

  it("refuses managed fields, malformed values and non-object metadata", () => {
    for (const update of [{ id: "ptag_other" }, { created_at: "2026-01-01" }, { value: null }, { value: 1 },
      { metadata: [] }, { metadata: "invalid" }, { metadata: 1 }]) {
      expect(Result.isFailure(decodeProductTagUpdateInput({ selector: { id: "ptag_1" }, update }))).toBe(true);
    }
  });
});
