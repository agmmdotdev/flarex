import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Schema } from "effect";
import type { CorePerformanceScenarioName, CorePerformanceSize } from "./scenarioCatalog";
import type { latencySummary } from "./measurement";

export const nativeBusinessReferencePath = "packages/medusa-adapter/benchmarks/core-performance/native-business/reports/e5a156a5-c6d2-488e-880b-999391a32d63.json.gz";
const duration = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_VALUE }));
const count = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const decodeReference = Schema.decodeUnknownSync(Schema.Struct({
  runId: Schema.Literal("e5a156a5-c6d2-488e-880b-999391a32d63"), complete: Schema.Literal(true),
  acceptanceSampling: Schema.Literal(true), warmups: count, samples: count,
  summaries: Schema.Array(Schema.Struct({ flow: Schema.String, retainedSamples: count,
    medianMs: duration, p95Ms: duration, maximumMs: duration })),
}));

/** Read the pinned historical reference once at runner construction, outside
 * all request timers. This is reference evidence, never a fresh paired lane. */
export function loadNativeBusinessReference() {
  const bytes = readFileSync(new URL("../../../../medusa-adapter/benchmarks/core-performance/native-business/reports/e5a156a5-c6d2-488e-880b-999391a32d63.json.gz", import.meta.url));
  const reference = decodeReference(JSON.parse(gunzipSync(bytes).toString("utf8")));
  return { ...reference, sha256Hex: createHash("sha256").update(bytes).digest("hex") };
}

export function nativeBusinessComparison(reference: ReturnType<typeof loadNativeBusinessReference>,
  scenario: CorePerformanceScenarioName, size: CorePerformanceSize, completeCost: ReturnType<typeof latencySummary>) {
  // Only the original small daily graphs are declared by preflight 26. Scalar
  // update is not Product update/retrieve/list; typical is not implicitly matched.
  const nativeGraph = size === "small" && ["payload-create", "medusa-workflow", "mixed-product", "mixed-payload", "mixed-workflow"].includes(scenario)
    ? scenario : null;
  const summary = nativeGraph === null ? undefined : reference.summaries.find(value => value.flow === nativeGraph);
  if (nativeGraph !== null && summary === undefined) throw new Error("Pinned native business graph is missing");
  return {
    status: summary === undefined ? "missing-native-graph" : "reference-only",
    reference: { path: nativeBusinessReferencePath, runId: reference.runId, sha256Hex: reference.sha256Hex,
      warmups: reference.warmups, measured: reference.samples },
    nativeGraph, nativeMedianMs: summary?.medianMs ?? null, nativeP95Ms: summary?.p95Ms ?? null,
    observedCompleteCost: completeCost,
    wholeGraphAddedBudget: { medianMs: 5, p95Ms: 10 },
    planningTotalBudget: summary === undefined ? null : { medianMs: summary.medianMs + 5, p95Ms: summary.p95Ms + 10 },
    pairedExcess: null, acceptance: "pending-paired-comparison",
    remainingAttribution: ["Fresh final-source matched pairs and stable tails are not captured by this runner.",
      "Snapshot/OCC, revision history, journal, atomic outcome and durable publication costs remain to be attributed at their real owners."],
    limitations: ["Native framework calls commit independently; Application writes are PostgreSQL surrogates.",
      "This retained reference guides planning; independent percentile subtraction is not paired excess.",
      ...(summary === undefined ? ["This flow/size requires its own declared matching native business graph."] : [])],
  };
}

export function quietSamplingEligible(plan: Readonly<{ warmups: number; measured: number }>,
  retainedMeasured: number, failed: boolean, diagnostic: boolean, smoke: boolean) {
  return !failed && !diagnostic && !smoke && plan.warmups >= 5 && plan.measured >= 30 && retainedMeasured === plan.measured;
}
