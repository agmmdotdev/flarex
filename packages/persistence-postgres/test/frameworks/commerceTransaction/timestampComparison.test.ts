import { describe, it } from "vitest";
import { timestampComparisonPhysicalScenario, timestampComparisonScenario } from "./timestampComparisonScenario";

describe("strict timestamp comparisons on PGlite", () => {
  it("uses the logical index and same-root overlay", () => timestampComparisonScenario("pglite"), 240_000);
  it("excludes NULL candidates before finite index limits", () => timestampComparisonScenario("pglite", true), 240_000);
  it("preserves physical compatibility semantics", () => timestampComparisonPhysicalScenario("pglite"), 240_000);
});
