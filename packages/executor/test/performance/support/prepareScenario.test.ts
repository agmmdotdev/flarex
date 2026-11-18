import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CorePerformanceScenario } from "./scenario";
import type { PreparedPerformanceFamily } from "./scenarioLifetime";
import { prepareCorePerformanceFamily } from "./prepareScenario";

const factories = vi.hoisted(() => ({
  product: vi.fn<(...input: unknown[]) => Promise<PreparedPerformanceFamily>>(),
  payload: vi.fn<(...input: unknown[]) => Promise<PreparedPerformanceFamily>>(),
  additional: vi.fn<(...input: unknown[]) => Promise<PreparedPerformanceFamily>>(),
  mixed: vi.fn<(...input: unknown[]) => Promise<CorePerformanceScenario>>(),
  workflow: vi.fn<(...input: unknown[]) => Promise<CorePerformanceScenario>>(),
}));
vi.mock("./productFlows", () => ({ prepareProductFlows: factories.product }));
vi.mock("./payloadFlows", () => ({ preparePayloadFlows: factories.payload }));
vi.mock("./mixedFlows", () => ({ prepareAdditionalMixedFlow: factories.additional }));
vi.mock("./mixed", () => ({ prepareMixedScenario: factories.mixed }));
vi.mock("./medusaScenario", () => ({ prepareStandaloneMedusaScenario: factories.workflow }));

describe("shared measurement preparation boundary", () => {
  beforeEach(() => vi.resetAllMocks());

  it("retains the PGlite owner's sample, diagnostics and cleanup without requiring pools", async () => {
    const sample = { run: vi.fn(async () => "committed"), verify: vi.fn(), cleanup: vi.fn(async () => {}) };
    const view: CorePerformanceScenario = {
      timings: { provisionAndPrepareMs: 7, runtimeConstructionMs: null, initialSeedMs: 0 },
      workload: { flow: "private", cardinality: { products: 1 }, limitations: ["fixed graph"] },
      setEffectDiagnostics: vi.fn(), async prepareSample() { return sample; }, dispose: vi.fn(async () => {}),
    };
    const dispose = vi.fn(async () => {});
    factories.product.mockResolvedValue({ scenario: () => view, dispose });
    const family = await prepareCorePerformanceFamily("product", { driver: "pglite", size: "typical", sampleCount: 1 });
    const scenario = family.scenario("product-create");
    expect(scenario.pools).toBeUndefined();
    expect(scenario.timings).toBe(view.timings);
    expect(scenario.setEffectDiagnostics).toBe(view.setEffectDiagnostics);
    expect(scenario.prepareSample).toBe(view.prepareSample);
    expect(await scenario.prepareSample("request", 0)).toBe(sample);
    expect(scenario.workload).toEqual({ flow: "Native scalar Product create", cardinality: { products: 1 }, limitations: ["fixed graph"] });
    await family.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(sample.run).not.toHaveBeenCalled();
    expect(sample.verify).not.toHaveBeenCalled();
    expect(sample.cleanup).not.toHaveBeenCalled();
  });

  it("forwards explicit endpoints through scalar, relation, finite and workflow factory owners", async () => {
    const view: CorePerformanceScenario = {
      timings: { provisionAndPrepareMs: 0, runtimeConstructionMs: null, initialSeedMs: 0 },
      async prepareSample() { throw new Error("unused"); }, async dispose() {},
    };
    const prepared: PreparedPerformanceFamily = { scenario: () => view, dispose: view.dispose };
    factories.payload.mockResolvedValue(prepared);
    factories.additional.mockResolvedValue(prepared);
    factories.mixed.mockResolvedValue(view);
    factories.workflow.mockResolvedValue(view);
    const postgresEndpoints = { connectionString: "postgresql://runtime.invalid/fixture", provisioningConnectionString: "postgresql://provision.invalid/fixture" };
    const input = { driver: "postgres" as const, size: "typical" as const, sampleCount: 6, postgresEndpoints };
    await prepareCorePerformanceFamily("payload-joins", input);
    await prepareCorePerformanceFamily("mixed-repeated-product", input);
    await prepareCorePerformanceFamily("mixed-workflow", input);
    await prepareCorePerformanceFamily("medusa-workflow", input);
    expect(factories.payload).toHaveBeenCalledWith("postgres", "joins", "typical", postgresEndpoints);
    expect(factories.additional).toHaveBeenCalledWith("mixed-repeated-product", 6, "typical", "postgres", postgresEndpoints);
    expect(factories.mixed).toHaveBeenCalledWith("mixed-workflow", 6, "postgres", postgresEndpoints);
    expect(factories.workflow).toHaveBeenCalledWith("postgres", postgresEndpoints);
  });

  it("rejects cross-family views and PGlite endpoint inputs before invoking the mismatched owner", async () => {
    const scenario = vi.fn<PreparedPerformanceFamily["scenario"]>();
    const dispose = vi.fn(async () => {});
    factories.product.mockResolvedValue({ scenario, dispose });
    const family = await prepareCorePerformanceFamily("product", { driver: "pglite", size: "small", sampleCount: 1 });
    expect(() => family.scenario("payload-create")).toThrow("does not belong");
    expect(scenario).not.toHaveBeenCalled();
    await family.dispose();
    await expect(prepareCorePerformanceFamily("product", { driver: "pglite", size: "small", sampleCount: 1,
      postgresEndpoints: { connectionString: "runtime", provisioningConnectionString: "provision" },
    })).rejects.toThrow("PostgreSQL endpoints require");
    expect(factories.product).toHaveBeenCalledOnce();
  });

  it("preserves a factory's original preparation failure", async () => {
    const original = new Error("original preparation failed");
    factories.product.mockRejectedValue(original);
    await expect(prepareCorePerformanceFamily("product", { driver: "pglite", size: "small", sampleCount: 1 })).rejects.toBe(original);
  });
});
