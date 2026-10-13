import { describe, expect, it } from "vitest";
import { compare, measure } from "./index";

describe("measurement public configuration boundary", () => {
  it.each([1, 3, 5, 30, 99])("rejects %i cycle samples before acquiring resources", async samples => {
    const input = { selection: { scenario: "mixed-workflow" as const }, size: "small" as const, mode: "root-counters" as const,
      outputDirectory: "unused", samples, attribution: { readerPath: "unused.node", detail: "engine" as const, order: "abba" as const } };
    await expect(compare(input)).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
    await expect(measure(input)).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("rejects cycle attribution in quiet mode before acquiring resources", async () => {
    await expect(compare({ selection: { scenario: "mixed-workflow" }, size: "small", mode: "quiet", outputDirectory: "unused",
      attribution: { readerPath: "unused.node", detail: "engine", order: "abba" } }))
      .rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("rejects root CPU observation in other modes before acquiring resources", async () => {
    for (const mode of ["quiet", "root-counters", "timeline", "resources", "database", "server"] as const) {
      await expect(measure({ selection: { scenario: "mixed-product" }, size: "small", mode,
        observation: "root", outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
    }
  });
  it("reserves a fresh quiet execution for each root CPU sample", async () => {
    await expect(measure({ selection: { scenario: "mixed-product" }, size: "small", mode: "cpu", observation: "root",
      samples: 53, warmups: 0, outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
  });
  it("rejects selected owner observation in other modes before acquiring resources", async () => {
    for (const mode of ["quiet", "root-counters", "timeline", "database", "cpu", "server"] as const) {
      await expect(measure({ selection: { scenario: "payload-create" }, size: "small", mode,
        observation: "owners", outputDirectory: "unused" })).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
    }
  });
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
  it("rejects traced modes in matched native comparisons before acquisition", async () => {
    const input = JSON.parse('{"selection":{"scenario":"mixed-product"},"size":"small","mode":"resources","outputDirectory":"unused"}');
    await expect(compare(input)).rejects.toMatchObject({ _tag: "InvalidMeasurementConfiguration" });
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
