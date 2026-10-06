import type { PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/postgresHelpers";
import { corePerformanceScenarios, type CorePerformanceFamily, type CorePerformanceSize } from "./scenarioCatalog";
import type { PreparedPerformanceFamily } from "./scenarioLifetime";

/** Shared measurement composition. Flow owners retain preparation, native calls,
 * committed-result verification and cleanup; this only selects their factory. */
export async function prepareCorePerformanceFamily(family: CorePerformanceFamily, input: Readonly<{
  driver: "postgres" | "pglite";
  size: CorePerformanceSize;
  sampleCount: number;
  postgresEndpoints?: PostgresFixtureEndpoints;
}>): Promise<PreparedPerformanceFamily> {
  if (input.driver !== "postgres" && input.postgresEndpoints !== undefined)
    throw new Error("PostgreSQL endpoints require the PostgreSQL driver");
  const prepared = await prepare();
  return {
    dispose: prepared.dispose,
    scenario(name) {
      const descriptor = corePerformanceScenarios.find(value => value.name === name && value.family === family);
      if (descriptor === undefined) throw new Error("Measurement scenario does not belong to prepared family");
      const scenario = prepared.scenario(name);
      return { ...scenario, workload: { flow: descriptor.flow,
        cardinality: scenario.workload?.cardinality ?? {},
        ...(scenario.workload?.limitations === undefined ? {} : { limitations: scenario.workload.limitations }) } };
    },
  };

  async function prepare(): Promise<PreparedPerformanceFamily> {
    if (family === "product") return (await import("./productFlows")).prepareProductFlows(input.driver, input.size, input.postgresEndpoints);
    if (family === "payload-scalar" || family === "payload-one" || family === "payload-many" || family === "payload-joins") {
      return (await import("./payloadFlows")).preparePayloadFlows(input.driver,
        family === "payload-scalar" ? "scalar" : family === "payload-one" ? "one" : family === "payload-many" ? "many" : "joins",
        input.size, input.postgresEndpoints);
    }
    if (family === "application-only" || family === "mixed-application-payload" || family === "mixed-repeated-product") {
      return (await import("./mixedFlows")).prepareAdditionalMixedFlow(family, input.sampleCount, input.size, input.driver, input.postgresEndpoints);
    }
    if (family === "medusa-workflow") {
      const scenario = await (await import("./medusaScenario")).prepareStandaloneMedusaScenario(input.driver, input.postgresEndpoints);
      return { scenario: () => scenario, dispose: scenario.dispose };
    }
    const scenario = await (await import("./mixed")).prepareMixedScenario(family, input.sampleCount, input.driver, input.postgresEndpoints);
    return { scenario: () => scenario, dispose: scenario.dispose };
  }
}
