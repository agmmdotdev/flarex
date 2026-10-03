import { expect } from "vitest";
import { count } from "drizzle-orm";
import { fxSystemCommits } from "../../../../persistence-postgres/src/schema";
import { prepareStandaloneProductLaunchPerformanceSeries } from "../../../../medusa-adapter/test/support/product-launch-performance-fixture";
import type { CorePerformanceScenario } from "./scenario";
import { verifyProductLaunchWorkflow } from "./workflowResult";

export async function prepareStandaloneMedusaScenario(): Promise<CorePerformanceScenario> {
  const series = await prepareStandaloneProductLaunchPerformanceSeries();
  if (series.currency.resource.kind !== "postgres") {
    await series.close();
    throw new Error("Standalone workflow requires PostgreSQL");
  }
  return {
    timings: { provisionAndPrepareMs: series.provisioningAndInstallationMs,
      runtimeConstructionMs: series.runtimeConstructionMs, initialSeedMs: 0,
      ...(series.currency.installationTiming === undefined ? {} : { installation: series.currency.installationTiming }),
      fixturePreparation: series.currency.preparationTiming },
    pools: { controlPool: series.currency.resource.control.pool, targetPool: series.currency.resource.target.pool },
    async prepareSample(id) {
      const { seed } = await series.prepareSeed(id);
      const database = series.currency.persistence.drizzle;
      const before = (await database.select({ value: count() }).from(fxSystemCommits))[0]?.value;
      let completed = false;
      return {
        run: () => series.run(seed),
        async verify(result) {
          const graph = verifyProductLaunchWorkflow(result, seed.productId, seed.tagId);
          const persisted = await series.readCommittedProduct(seed.productId);
          expect(persisted).toMatchObject({ id: seed.productId,
            tags: [{ id: seed.tagId, value: "launched" }],
            variants: [expect.objectContaining({ id: graph.pricing.variants[0]?.id })] });
          expect((await database.select({ value: count() }).from(fxSystemCommits))[0]?.value).toBe((before ?? 0) + 1);
          completed = true;
        },
        async cleanup() { if (completed) await series.retireLaunchedTag(seed, id); },
      };
    },
    dispose: series.close,
  };
}
