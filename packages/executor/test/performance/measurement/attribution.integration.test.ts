import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { Schema } from "effect";
import { compare } from "./index";

const selected = process.env.FLAREX_MEASUREMENT_ATTRIBUTION;
it.skipIf(selected === undefined)("attributes the complete matched mixed workflow through the SDK", async () => {
  const mode = Schema.decodeUnknownSync(Schema.Literals(["cycles", "cpu", "control"]))(selected);
  const detail = Schema.decodeUnknownSync(Schema.Literals(["engine", "generators"]))(process.env.FLAREX_MEASUREMENT_CYCLE_DETAIL ?? "engine");
  const order = Schema.decodeUnknownSync(Schema.Literals(["abba", "baab"]))(process.env.FLAREX_MEASUREMENT_CYCLE_ORDER ?? "abba");
  const readerPath = process.env.FLAREX_MEASUREMENT_CYCLE_READER;
  const outputDirectory = process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY;
  if (outputDirectory === undefined || (mode === "cycles" && readerPath === undefined)) throw new Error("Explicit diagnostic artifact paths are required");
  const samples = Schema.decodeUnknownSync(Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 100 })))
    (Number(process.env.FLAREX_MEASUREMENT_SAMPLES ?? 32));
  const result = await compare({ selection: { scenario: "mixed-workflow" }, size: "small", warmups: 5, samples,
    mode: mode === "cpu" ? "cpu" : "root-counters", outputDirectory,
    ...(mode !== "cycles" || readerPath === undefined ? {} : { attribution: { readerPath, detail, order } }) });
  expect(result.execution).toBe("complete");
  expect(result.acceptance).toBe("notEvaluated");
  const raw = JSON.parse(await readFile(result.reports.raw, "utf8"));
  expect(raw.cleanup).toBe("completed");
  expect(raw.gates.every((gate: { passed: boolean }) => gate.passed)).toBe(true);
  expect(raw.cpuPairs).toHaveLength(samples);
  if (mode === "cycles") {
    const observed = raw.samples.filter((sample: { cycleEvidence?: { observed: boolean } }) => sample.cycleEvidence?.observed);
    expect(observed).toHaveLength(samples / 2);
    expect(observed.every((sample: { cycleEvidence: { buckets: { site: string; calls: number }[] } }) =>
      sample.cycleEvidence.buckets.some(bucket => bucket.site === "effect-engine-excluding-observed-bodies" && bucket.calls > 0))).toBe(true);
    if (detail === "generators") expect(raw.cycleAttribution.sources.length).toBeGreaterThan(0);
  }
  console.log(JSON.stringify(result));
});
