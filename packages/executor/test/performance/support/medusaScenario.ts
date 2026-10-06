import { expect } from "vitest";
import { count } from "drizzle-orm";
import { fxSystemCommits } from "../../../../persistence-postgres/src/schema";
import { prepareStandaloneProductLaunchPerformanceSeries } from "../../../../medusa-adapter/test/support/product-launch-performance-fixture";
import type { CorePerformanceScenario } from "./scenario";
import { verifyProductLaunchWorkflow } from "./workflowResult";
import type { MixedMutationEffectDiagnostics } from "./measurement";
import type { PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/postgresHelpers";

export async function prepareStandaloneMedusaScenario(driver: "postgres" | "pglite" = "postgres",
  postgresEndpoints?: PostgresFixtureEndpoints): Promise<CorePerformanceScenario> {
  const series = await prepareStandaloneProductLaunchPerformanceSeries({ driver,
    ...(postgresEndpoints === undefined ? {} : { postgresEndpoints }) });
  let diagnostics: MixedMutationEffectDiagnostics | undefined;
  return {
    workload: { flow: "medusa-workflow", cardinality: { products: 1, tags: 1, variants: 1, priceSets: 1, links: 1 },
      limitations: ["Original Product launch graph has fixed cardinality across size selections."] },
    timings: { provisionAndPrepareMs: series.provisioningAndInstallationMs,
      runtimeConstructionMs: series.runtimeConstructionMs, initialSeedMs: 0,
      ...(series.currency.installationTiming === undefined ? {} : { installation: series.currency.installationTiming }),
      fixturePreparation: series.currency.preparationTiming },
    ...(series.currency.resource.kind === "postgres" ? {
      pools: { controlPool: series.currency.resource.control.pool, targetPool: series.currency.resource.target.pool },
    } : {}),
    setEffectDiagnostics: next => { diagnostics = next; },
    async prepareSample(id) {
      const { seed } = await series.prepareSeed(id);
      const database = series.currency.persistence.drizzle;
      const before = (await database.select({ value: count() }).from(fxSystemCommits))[0]?.value;
      let completed = false;
      return {
        run: () => {
          const binding = diagnostics;
          return series.run(seed, binding === undefined ? undefined
            : work => binding.provide(binding.traceEffect("native Medusa workflow", work)));
        },
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
