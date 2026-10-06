import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compare, measure } from "./index";
import { analyzeMeasurementEvidence } from "./analysis";

const directory = resolve(process.env.FLAREX_MEASUREMENT_OUTPUT ?? "work/validation/measurement-sdk");
const envelope = Schema.decodeUnknownSync(Schema.Struct({ execution: Schema.String, acceptance: Schema.String,
  cleanup: Schema.String, samples: Schema.Array(Schema.StructWithRest(Schema.Struct({
    kind: Schema.String, evidence: Schema.optional(Schema.Unknown),
  }), [Schema.Record(Schema.String, Schema.Unknown)])),
  pairs: Schema.Array(Schema.Struct({ nativeMs: Schema.Number, flarexMs: Schema.Number, addedMs: Schema.Number })),
}));

describe.skipIf(process.env.FLAREX_MEASUREMENT_INTEGRATION !== "1")("measurement SDK connected witness", () => {
  it("observes a real PGlite request with the SDK Layer and preserves a quiet request", async () => {
    await mkdir(directory, { recursive: true });
    const report = await measure({ selection: { scenario: "mixed-product" }, size: "small", mode: "timeline",
      driver: "pglite", warmups: 0, outputDirectory: directory });
    const raw = envelope(JSON.parse(await readFile(report.reports.raw, "utf8")));
    expect(report.execution).toBe("complete");
    expect(report.acceptance).toBe("notEvaluated");
    expect(raw.cleanup).toBe("completed");
    const calibration = raw.samples.filter(sample => sample.kind === "calibration");
    expect(calibration).toHaveLength(1);
    expect(calibration.every(sample => sample.evidence === undefined)).toBe(true);
    const diagnostic = raw.samples.find(sample => sample.kind === "diagnostic");
    const analysis = Result.getOrThrow(analyzeMeasurementEvidence(diagnostic?.evidence));
    expect(analysis.diagnostic).toBe("complete");
    expect(analysis.evidence.events.some(event => event.kind === "work")).toBe(true);
    expect(analysis.evidence.events.some(event => event.kind === "effectSpan" && event.parentId !== null)).toBe(true);
  });

  it.skipIf(process.env.FLAREX_MEASUREMENT_POSTGRES !== "1")("reconciles one ordinary-role PostgreSQL request and fresh native pair", async () => {
    const diagnostic = await measure({ selection: { scenario: "mixed-product" }, size: "small", mode: "database",
      warmups: 1, outputDirectory: directory });
    const raw = envelope(JSON.parse(await readFile(diagnostic.reports.raw, "utf8")));
    expect(diagnostic.execution).toBe("complete");
    const sample = raw.samples.find(sample => sample.kind === "diagnostic");
    const analysis = Result.getOrThrow(analyzeMeasurementEvidence(sample?.evidence));
    expect(analysis.diagnostic).toBe("complete");
    expect(analysis.database.driverExchanges).toBeGreaterThan(0);
    expect(analysis.database.transactions).toBe(2);
    expect(analysis.wall.driverAwaitUnionMs).toBeGreaterThan(0);
    expect(analysis.evidence.events.some(event => event.kind === "driverAwait" && event.transactionId !== null)).toBe(true);
    const comparison = await compare({ selection: { scenario: "mixed-product" }, size: "small", warmups: 0,
      samples: 1, outputDirectory: directory });
    const paired = envelope(JSON.parse(await readFile(comparison.reports.raw, "utf8")));
    expect(comparison.execution).toBe("complete");
    expect(comparison.acceptance).toBe("failed"); // This is an integration proof, below acceptance sampling.
    expect(paired.cleanup).toBe("completed");
    expect(paired.pairs).toHaveLength(1);
    expect(paired.samples.every(sample => sample.evidence === undefined)).toBe(true);
    const pair = paired.pairs[0];
    expect(pair?.addedMs).toBe((pair?.flarexMs ?? 0) - (pair?.nativeMs ?? 0));
  });
});
