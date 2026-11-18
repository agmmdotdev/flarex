import { expect, it } from "vitest";
import { selectedCorePerformanceScenarios } from "./support/scenarioCatalog";
import { corePerformanceSamplingPlan, maxCorePerformanceSeriesSamples } from "./support/measurementPlan";

const driverInput = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driverInput !== "pglite" && driverInput !== "postgres") throw new Error("Invalid flow verification driver");
const driver = driverInput;
const group = process.env.FLAREX_CORE_FLOW_GROUP ?? "all";
if (group !== "all" && group !== "product" && group !== "payload" && group !== "mixed") throw new Error("Invalid flow verification group");
const sizeInput = process.env.FLAREX_CORE_PERF_SIZE ?? "small";
if (sizeInput !== "small" && sizeInput !== "typical") throw new Error("Invalid flow verification size");
const size = sizeInput;

for (const selection of [
  { family: "product", name: "product-update", boundary: "native Product operation" },
  { family: "payload-scalar", name: "payload-create", boundary: "native Payload operation" },
  { family: "application-only", name: "application-only", boundary: "authoritative publication" },
] as const) {
  it.skipIf(process.env.FLAREX_CORE_FLOW_DIAGNOSTICS !== "1")(`exposes ${selection.name} as a diagnostic view and a fresh quiet view`, async () => {
    const { prepareCorePerformanceFamily } = await import("./support/prepareScenario");
    const { createEffectMeasurementCollector } = await import("./measurement/collectors/effect");
    const family = await prepareCorePerformanceFamily(selection.family, { driver, size, sampleCount: 2 });
    const scenario = family.scenario(selection.name);
    try {
      expect(scenario.pools === undefined).toBe(driver === "pglite");
      const sample = await scenario.prepareSample(`diagnostic-${selection.name}-${driver}`, 0);
      const collector = createEffectMeasurementCollector({ now: () => performance.now() });
      const cleanupFailures: unknown[] = [];
      scenario.setEffectDiagnostics?.(collector.binding);
      let result: unknown;
      try {
        try {
          result = await collector.runRequest("adapter request", () => sample.run(collector.publicationObservation(), cleanupFailures));
        } finally { scenario.setEffectDiagnostics?.(undefined); }
        await sample.verify(result);
        expect(cleanupFailures).toEqual([]);
        expect(collector.records().some(event => (event.kind === "phase" || event.kind === "effectSpan") && event.name === selection.boundary)).toBe(true);
        expect(collector.status()).toMatchObject({ closed: true, lostContextEvents: 0, droppedEvents: 0, failureCount: 0 });
      } finally { await sample.cleanup(); }
      const records = collector.records();
      const quiet = await scenario.prepareSample(`quiet-${selection.name}-${driver}`, 1);
      try { await quiet.verify(await quiet.run()); }
      finally { await quiet.cleanup(); }
      expect(collector.records()).toEqual(records);
      expect(collector.status()).toMatchObject({ lostContextEvents: 0, droppedEvents: 0 });
    } finally {
      scenario.setEffectDiagnostics?.(undefined);
      await family.dispose();
    }
  }, 240_000);
}

it.skipIf(group !== "all" && group !== "mixed")("supports the acceptance plan's late fresh attempt without raising runtime budgets", async () => {
  const plan = corePerformanceSamplingPlan({ acceptance: true, smoke: false, full: false });
  const sampleCount = plan.warmups + plan.measured;
  const family = await (await import("./support/mixedFlows")).prepareAdditionalMixedFlow("application-only", sampleCount, "small", driver);
  try {
    await expect(family.prepareSample("out-of-range", maxCorePerformanceSeriesSamples)).rejects.toThrow("Invalid mixed performance attempt index");
    const results: unknown[] = [];
    for (const index of [0, sampleCount - 1]) {
      const sample = await family.prepareSample(`acceptance-bound-${index}`, index);
      try { const result = await sample.run(); await sample.verify(result); results.push(result); }
      finally { await sample.cleanup(); }
    }
    expect(results[0]).not.toEqual(results[1]);
  } finally { await family.dispose(); }
}, 240_000);

it.skipIf(group !== "all" && group !== "product")("verifies timed native Product operations and lifecycle on fresh samples", async () => {
  const family = await (await import("./support/productFlows")).prepareProductFlows(driver, size);
  try {
    for (const { name } of selectedCorePerformanceScenarios("product")) {
      const sample = await family.prepareSample(name, `${name}-${driver}`);
      try { await sample.verify(await sample.run()); } finally { await sample.cleanup(); }
    }
  } finally { await family.dispose(); }
}, 240_000);

for (const profile of ["scalar", "one", "many", "joins"] as const) {
  it.skipIf(group !== "all" && group !== "payload")(`verifies Payload ${profile} Local API measurement demands`, async () => {
    const family = await (await import("./support/payloadFlows")).preparePayloadFlows(driver, profile, size);
    const key = profile === "scalar" ? "payload-scalar" : `payload-${profile}`;
    try {
      for (const { name } of selectedCorePerformanceScenarios("payload").filter(value => value.family === key)) {
        const sample = await family.prepareSample(name, `${name}-${driver}`);
        try { await sample.verify(await sample.run()); } finally { await sample.cleanup(); }
      }
    } finally { await family.dispose(); }
  }, 240_000);
}

for (const name of ["application-only", "mixed-application-payload", "mixed-repeated-product"] as const) {
  it.skipIf(group !== "all" && group !== "mixed")(`verifies ${name} through the complete finite executor`, async () => {
    const family = await (await import("./support/mixedFlows")).prepareAdditionalMixedFlow(name, 1, size, driver);
    try {
      const sample = await family.prepareSample(name, 0);
      try { await sample.verify(await sample.run()); } finally { await sample.cleanup(); }
    } finally { await family.dispose(); }
  }, 240_000);
}
