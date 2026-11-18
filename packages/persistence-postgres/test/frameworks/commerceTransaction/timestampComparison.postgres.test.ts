import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { timestampComparisonPhysicalScenario, timestampComparisonScenario } from "./timestampComparisonScenario";

describe.skipIf(postgresUrl === null)("strict timestamp comparisons on ordinary-role PostgreSQL", () => {
  it("uses the logical index and same-root overlay", () => timestampComparisonScenario("postgres"), 240_000);
  it("excludes NULL candidates before finite index limits", () => timestampComparisonScenario("postgres", true), 240_000);
  it("preserves physical compatibility semantics", () => timestampComparisonPhysicalScenario("postgres"), 240_000);
});
