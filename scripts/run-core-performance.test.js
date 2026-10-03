import { describe, expect, it } from "vitest";
import { parseCorePerformanceArguments } from "./run-core-performance.mjs";

describe("core performance command", () => {
  it("uses a short selected Payload scenario by default", () => {
    expect(parseCorePerformanceArguments([])).toEqual({ scenario: "payload-create", full: false, sql: false, help: false });
    expect(parseCorePerformanceArguments(["--", "--scenario", "medusa-workflow", "--sql"]))
      .toEqual({ scenario: "medusa-workflow", full: false, sql: true, help: false });
    expect(parseCorePerformanceArguments(["--all", "--full"])).toMatchObject({ scenario: "all", full: true });
  });
  it("refuses ambiguous or invalid selection before starting a runner", () => {
    for (const args of [["--scenario"], ["--scenario", "application"], ["--cold"],
      ["--all", "--scenario", "payload-create"], ["--scenario", "payload-create", "--scenario", "mixed-product"]]) {
      expect(() => parseCorePerformanceArguments(args)).toThrow();
    }
  });
});
