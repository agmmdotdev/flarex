import { describe, expect, it } from "vitest";
import { compare, measure } from "./index";

describe("measurement public configuration boundary", () => {
  it("rejects an empty destination before acquiring resources", async () => {
    await expect(measure({ selection: { scenario: "mixed-product" }, size: "small", mode: "quiet",
      outputDirectory: " " })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("rejects unsupported driver diagnostics before acquisition", async () => {
    await expect(measure({ selection: { scenario: "mixed-product" }, size: "small", mode: "database",
      driver: "pglite", outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("rejects excessive first-cohort sampling before acquisition", async () => {
    await expect(compare({ selection: { scenario: "mixed-product" }, size: "small", samples: 100,
      outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
});
