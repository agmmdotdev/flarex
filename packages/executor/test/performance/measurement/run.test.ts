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
  it("rejects excessive sampling before acquisition", async () => {
    await expect(compare({ selection: { scenario: "mixed-product" }, size: "small", samples: 101,
      outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("reserves a separate fresh diagnostic calibration attempt", async () => {
    await expect(measure({ selection: { scenario: "mixed-product" }, size: "small", mode: "cpu",
      samples: 100, warmups: 5, outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("reserves a fresh quiet execution for each resource sample", async () => {
    await expect(measure({ selection: { scenario: "mixed-product" }, size: "small", mode: "resources",
      samples: 51, warmups: 5, outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("fails closed for a comparison without a matched native graph", async () => {
    // Exercise the runtime Schema against foreign input without weakening the public type.
    const input = JSON.parse('{"selection":{"scenario":"product-update"},"size":"small","outputDirectory":"unused"}');
    await expect(compare(input)).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("fails closed for typical native comparisons", async () => {
    const input = JSON.parse('{"selection":{"scenario":"mixed-product"},"size":"typical","outputDirectory":"unused"}');
    await expect(compare(input)).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
});
