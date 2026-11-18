import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compare, measure } from "./index";
import { decodeMeasurementEvidence } from "./artifact";

const cases = [
  { name: "pglite-resources", scenario: "application-only", driver: "pglite", mode: "resources", size: "small" },
  { name: "pglite-cpu", scenario: "application-only", driver: "pglite", mode: "cpu", size: "small" },
  { name: "postgres-cpu", scenario: "mixed-product", driver: "postgres", mode: "cpu", size: "small" },
  { name: "postgres-server", scenario: "mixed-product", driver: "postgres", mode: "server", size: "small" },
  { name: "product-timeline", scenario: "product-update", driver: "pglite", mode: "timeline", size: "typical" },
  { name: "payload-database", scenario: "payload-create", driver: "postgres", mode: "database", size: "small" },
] as const;
const selected = process.env.FLAREX_MEASUREMENT_INTEGRATION;
// The connected observer proofs in integration.test.ts share this selector.
if (selected !== undefined && selected !== "1" && selected !== "postgres-compare" && !cases.some(value => value.name === selected)) throw new Error("Unknown SDK integration proof");
const decodeReport = Schema.decodeUnknownSync(Schema.Struct({ samples: Schema.Array(Schema.Struct({
  kind: Schema.String, evidence: Schema.optional(Schema.Unknown),
})) }));

describe("connected measurement SDK", () => {
  it.skipIf(selected !== "postgres-compare")("fresh Payload native pair", async () => {
    const outputDirectory = resolve(process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY ?? "work/validation/measurement-completion", "postgres-compare");
    const result = await compare({ selection: { scenario: "payload-create" }, size: "small",
      warmups: 0, samples: 1, outputDirectory });
    // One fresh pair validates assembly and retention; it cannot meet sampling
    // or native-relative latency acceptance.
    expect(result).toMatchObject({ execution: "complete", acceptance: "failed" });
    const raw = Schema.decodeUnknownSync(Schema.Struct({ pairs: Schema.Array(Schema.Struct({
      nativeMs: Schema.Finite, flarexMs: Schema.Finite, addedMs: Schema.Finite,
    })), samples: Schema.Array(Schema.Struct({ lane: Schema.String, evidence: Schema.optional(Schema.Unknown) })) }))(
      JSON.parse(await readFile(result.reports.raw, "utf8")));
    expect(raw.pairs).toHaveLength(1);
    expect(raw.samples.map(sample => sample.lane)).toEqual(["native", "flarex"]);
    expect(raw.samples.every(sample => sample.evidence === undefined)).toBe(true);
  }, 240_000);
  for (const proof of cases) it.skipIf(selected !== proof.name)(proof.name, async () => {
    const outputDirectory = resolve(process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY ?? "work/validation/measurement-completion", proof.name);
    const result = await measure({ selection: { scenario: proof.scenario }, size: proof.size,
      driver: proof.driver, mode: proof.mode, warmups: 0, samples: 1, outputDirectory });
    expect(result).toMatchObject({ execution: "complete", acceptance: "notEvaluated" });
    const raw = decodeReport(JSON.parse(await readFile(result.reports.raw, "utf8")));
    const diagnostic = raw.samples.find(sample => sample.kind === "diagnostic");
    const evidence = Result.getOrThrow(decodeMeasurementEvidence(diagnostic?.evidence));
    expect(evidence.collection).toMatchObject({ droppedEvents: 0, lostContextEvents: 0, failures: [] });
    if (proof.mode === "cpu") {
      expect(evidence.cpu?.complete).toBe(true);
      expect(evidence.cpu?.cpuProfile?.samples?.length).toBeGreaterThan(0);
      expect(result.reports.profiles).toHaveLength(2);
    }
    if (proof.mode === "resources") {
      expect(evidence.events.some(event => event.kind === "effectSpan" && event.resources !== undefined)).toBe(true);
      expect(evidence.cpu).toBeUndefined();
      expect(evidence.server).toBeUndefined();
      expect(evidence.events.some(event => event.kind === "driverAwait")).toBe(false);
    }
    if (proof.driver === "postgres") {
      const dispatches = evidence.events.filter(event => event.kind === "driverAwait");
      expect(dispatches.length).toBeGreaterThan(0);
      expect(dispatches.every(event => event.backendPid !== null)).toBe(true);
    }
    if (proof.mode === "server") {
      expect(evidence.server?.status).toBe("complete");
      expect(evidence.server?.statements.some(statement => statement.calls > 0)).toBe(true);
      if (process.env.FLAREX_MEASUREMENT_SERVER_LOG !== undefined) {
        expect(evidence.server?.actualPlans.status).toBe("complete");
        if (evidence.server?.actualPlans.status !== "unavailable")
          expect(evidence.server?.actualPlans.plans.length).toBeGreaterThan(0);
      }
    }
  }, 240_000);
});
