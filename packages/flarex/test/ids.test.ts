import { describe, expect, it } from "vitest";
import {
  encodeFlarexId,
  isFlarexIdForTable,
  parseFlarexId,
  requireFlarexId,
} from "../src/ids";

describe("Flarex IDs", () => {
  it("encodes and parses canonical numeric table IDs", () => {
    const id = encodeFlarexId<"users">(1, "ada");

    expect(id).toBe("1:ada");
    expect(parseFlarexId(id)).toEqual({ tableId: 1, documentId: "ada" });
    expect(requireFlarexId(id)).toEqual({ tableId: 1, documentId: "ada" });
    expect(isFlarexIdForTable(id, 1)).toBe(true);
    expect(isFlarexIdForTable(id, 2)).toBe(false);
  });

  it("rejects malformed IDs", () => {
    expect(parseFlarexId("users:ada")).toBeNull();
    expect(parseFlarexId("1:")).toBeNull();
    expect(parseFlarexId(":ada")).toBeNull();
    expect(() => encodeFlarexId(1, "")).toThrow("suffix must not be empty");
    expect(() => requireFlarexId("users:ada")).toThrow("Invalid Flarex document id");
  });
});
