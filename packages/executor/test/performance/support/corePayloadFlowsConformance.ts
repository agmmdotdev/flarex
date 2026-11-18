import { expect, it } from "vitest";
import { preparePayloadFlows } from "./payloadFlows";
import type { CorePerformanceScenarioName } from "./scenarioCatalog";

/** Execute one real graph for correctness. There are no repetitions, request
 * timers, performance assertions, measurement artifacts or campaign activation. */
export function registerCorePayloadFlowConformance(driver: "pglite" | "postgres") {
  const profiles: readonly Readonly<{ profile: "one" | "many" | "joins"; flows: readonly CorePerformanceScenarioName[] }>[] = [
    { profile: "one", flows: ["payload-populate-one"] },
    { profile: "many", flows: ["payload-populate-many", "payload-replace-many"] },
    { profile: "joins", flows: ["payload-reverse-join"] },
  ];
  for (const { profile, flows } of profiles) it("constructs and verifies the current " + profile + " workload without a timing campaign", async () => {
    const prepared = await preparePayloadFlows(driver, profile, "small");
    try {
      for (const flow of flows) {
        const scenario = prepared.scenario(flow);
        if (driver === "postgres") {
          expect(scenario.pools?.targetPool).toBeDefined();
          expect(scenario.pools?.controlPool).toBe(scenario.pools?.targetPool);
        }
        const sample = await prepared.prepareSample(flow, "native-flow-" + crypto.randomUUID());
        try { await sample.verify(await sample.run()); }
        finally { await sample.cleanup(); }
      }
    } finally { await prepared.dispose(); }
  }, 180_000);
}
