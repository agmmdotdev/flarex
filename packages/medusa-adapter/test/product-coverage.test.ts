import { describe, expect, it } from "vitest";
import { matchesProductCoverage } from "./support/product-coverage";
describe("Product coverage declaration counts", () => {
  const expected = ["duplicate", "duplicate", "single"];
  it("retains both unchanged declarations regardless of execution order", () => {
    expect(matchesProductCoverage(expected, ["single", "duplicate", "duplicate"])).toBe(true);
  });
  it("rejects a missing occurrence", () => {
    expect(matchesProductCoverage(expected, ["duplicate", "single"])).toBe(false);
  });
  it("rejects an excess occurrence even at the same total", () => {
    expect(matchesProductCoverage(expected, ["duplicate", "single", "single"])).toBe(false);
    expect(matchesProductCoverage(expected, [...expected, "duplicate"])).toBe(false);
  });
  it("rejects an unexpected test even at the same total", () => {
    expect(matchesProductCoverage(expected, ["duplicate", "single", "unexpected"])).toBe(false);
  });
});
