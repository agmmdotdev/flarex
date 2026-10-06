import { describe, expect, it } from "vitest";
import { parseCorePerformanceArguments } from "./run-core-performance.mjs";
import { corePerformanceSamplingPlan, maxCorePerformanceSeriesSamples } from "../packages/executor/test/performance/support/measurementPlan.ts";

describe("core performance command", () => {
  it("uses a short selected Payload scenario by default", () => {
    expect(parseCorePerformanceArguments([])).toMatchObject({ scenario: "payload-create", full: false, sql: false, cpu: false, help: false, size: "small", smoke: false });
    expect(parseCorePerformanceArguments(["--", "--scenario", "medusa-workflow", "--sql"]))
      .toMatchObject({ scenario: "medusa-workflow", full: false, sql: true, cpu: false, help: false });
    expect(parseCorePerformanceArguments(["--all", "--full"])).toMatchObject({ scenario: "all", full: true });
  });
  it("selects CPU diagnostics explicitly and keeps SQL diagnostics separate", () => {
    expect(parseCorePerformanceArguments(["--scenario", "mixed-product", "--full", "--cpu"]))
      .toMatchObject({ scenario: "mixed-product", full: true, sql: false, cpu: true, help: false });
    expect(() => parseCorePerformanceArguments(["--cpu", "--sql"])).toThrow("Choose --cpu or --sql");
    expect(() => parseCorePerformanceArguments(["--sql", "--cpu"])).toThrow("Choose --cpu or --sql");
  });
  it("selects fast family smoke and lists inventory without measurement", () => {
    expect(parseCorePerformanceArguments(["--family", "product", "--smoke"]))
      .toMatchObject({ scenario: "product", smoke: true, size: "small" });
    expect(parseCorePerformanceArguments(["--daily", "--size", "typical"]))
      .toMatchObject({ scenario: "daily", size: "typical" });
    expect(parseCorePerformanceArguments(["--list"])).toMatchObject({ list: true });
    for (const args of [["--size", "huge"], ["--family", "all"], ["--family", "product", "--all"],
      ["--daily", "--scenario", "payload-create"], ["--smoke", "--full"], ["--smoke", "--sql"], ["--smoke", "--cpu"]])
      expect(() => parseCorePerformanceArguments(args)).toThrow();
  });
  it("refuses ambiguous or invalid selection before starting a runner", () => {
    for (const args of [["--scenario"], ["--scenario", "application"], ["--cold"],
      ["--all", "--scenario", "payload-create"], ["--scenario", "payload-create", "--scenario", "mixed-product"]]) {
      expect(() => parseCorePerformanceArguments(args)).toThrow();
    }
  });
  it("selects native acceptance sampling separately from iteration and diagnostics", () => {
    expect(parseCorePerformanceArguments(["--daily", "--acceptance"]))
      .toMatchObject({ scenario: "daily", acceptance: true, full: false, smoke: false, sql: false, cpu: false });
    const plan = corePerformanceSamplingPlan(parseCorePerformanceArguments(["--daily", "--acceptance"]));
    expect(plan).toEqual({ warmups: 5, measured: 100 });
    expect(plan.warmups + plan.measured).toBe(maxCorePerformanceSeriesSamples);
    for (const flag of ["--full", "--smoke", "--sql", "--cpu"])
      expect(() => parseCorePerformanceArguments(["--acceptance", flag])).toThrow("separate quiet series");
  });
});
