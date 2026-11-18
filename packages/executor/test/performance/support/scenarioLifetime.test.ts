import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { performanceFamilyLifetime } from "./scenarioLifetime";
import { corePerformanceScenarios, selectedCorePerformanceScenarios } from "./scenarioCatalog";
import type { PreparedPerformanceFamily } from "./scenarioLifetime";
import type { CorePerformanceScenario } from "./scenario";

describe("bounded measurement families", () => {
  it("retains the five daily graphs and selects the expanded families", () => {
    expect(selectedCorePerformanceScenarios("daily").map(value => value.name)).toEqual([
      "payload-create", "medusa-workflow", "mixed-product", "mixed-payload", "mixed-workflow",
    ]);
    expect(new Set(corePerformanceScenarios.map(value => value.name)).size).toBe(corePerformanceScenarios.length);
    expect(selectedCorePerformanceScenarios("all")).toHaveLength(25);
    expect(selectedCorePerformanceScenarios("product")).toHaveLength(7);
    expect(selectedCorePerformanceScenarios("payload")).toHaveLength(11);
    expect(selectedCorePerformanceScenarios("missing")).toEqual([]);
  });
  it("keeps one construction and distinct sample views until the last selected use", async () => {
    const pool = new Pool();
    let preparations = 0;
    let disposals = 0;
    const view = (): CorePerformanceScenario => ({ timings: { provisionAndPrepareMs: 0, runtimeConstructionMs: null, initialSeedMs: 0 },
      pools: { controlPool: pool, targetPool: pool }, async dispose() {},
      async prepareSample(id) { return { async run() { return id; }, verify() {}, async cleanup() {} }; } });
    const family = { scenario: view, async dispose() { disposals++; } } satisfies PreparedPerformanceFamily;
    const lifetime = performanceFamilyLifetime(async () => { preparations++; return family; }, new Map([["product", 2]]));
    try {
      const first = await lifetime.acquire("product", "product-create");
      const second = await lifetime.acquire("product", "product-update");
      expect(first.preparationReuse?.reused).toBe(false); expect(second.preparationReuse?.reused).toBe(true);
      expect(await (await first.prepareSample("first", 0)).run()).toBe("first");
      expect(await (await second.prepareSample("second", 0)).run()).toBe("second");
      await first.dispose(); await first.dispose(); expect(disposals).toBe(0);
      await second.dispose(); expect(disposals).toBe(1);
      await lifetime.close(); await lifetime.close();
      expect(preparations).toBe(1); expect(disposals).toBe(1);
      await expect(lifetime.acquire("product", "product-create")).rejects.toThrow("closed");
    } finally { await lifetime.close(); await pool.end(); }
  });
  it("closes a prepared family if scenario-view construction fails", async () => {
    let disposed = false;
    const original = new Error("view failed");
    const lifetime = performanceFamilyLifetime(async () => ({ scenario() { throw original; }, async dispose() { disposed = true; } }));
    await expect(lifetime.acquire("product", "product-create")).rejects.toBe(original);
    await lifetime.close(); expect(disposed).toBe(true);
  });
  it("preserves preparation failures without replacing them during shutdown", async () => {
    const original = new Error("construction failed");
    const lifetime = performanceFamilyLifetime(async () => { throw original; });
    await expect(lifetime.acquire("product", "product-create")).rejects.toBe(original);
    await lifetime.close();
  });
  it("propagates family shutdown failures and disposes every other family", async () => {
    const first = new Error("first cleanup failed");
    const second = new Error("second cleanup failed");
    const released: string[] = [];
    const lifetime = performanceFamilyLifetime(async family => ({
      scenario() { throw new Error("view failed"); },
      async dispose() { released.push(family); throw family === "product" ? first : second; },
    }));
    await expect(lifetime.acquire("product", "product-create")).rejects.toThrow("view failed");
    await expect(lifetime.acquire("payload-scalar", "payload-create")).rejects.toThrow("view failed");
    await expect(lifetime.close()).rejects.toMatchObject({ errors: [second, first] });
    expect(released).toEqual(["payload-scalar", "product"]);
    await lifetime.close(); expect(released).toHaveLength(2);
  });
  it("retains a failed last-use release for the final shutdown report", async () => {
    const pool = new Pool();
    const original = new Error("last release failed");
    let disposals = 0;
    const lifetime = performanceFamilyLifetime(async () => ({
      scenario(): CorePerformanceScenario { return { timings: { provisionAndPrepareMs: 0, runtimeConstructionMs: null, initialSeedMs: 0 },
        pools: { controlPool: pool, targetPool: pool }, async dispose() {},
        async prepareSample() { throw new Error("unused"); } }; },
      async dispose() { disposals++; throw original; },
    }), new Map([["product", 1]]));
    try {
      const scenario = await lifetime.acquire("product", "product-create");
      await expect(scenario.dispose()).rejects.toBe(original);
      await expect(lifetime.close()).rejects.toMatchObject({ errors: [original] });
      expect(disposals).toBe(1);
    } finally { await lifetime.close(); await pool.end(); }
  });
});
