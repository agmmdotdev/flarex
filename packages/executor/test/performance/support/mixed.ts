import { Schema } from "effect";
import { expect } from "vitest";
import { prepareMixedMutationPerformanceSeries } from "./mixedMutationProductFixture";
import type { CorePerformanceScenario } from "./scenario";
import type { MixedMutationPerformanceTrace } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { verifyProductLaunchWorkflow } from "./workflowResult";

const decodeBusiness = Schema.decodeUnknownSync(Schema.Struct({
  updated: Schema.Struct({ id: Schema.String, title: Schema.String, handle: Schema.String, status: Schema.String }),
  pending: Schema.Struct({ id: Schema.String, title: Schema.String }),
}));
const decodePayload = Schema.decodeUnknownSync(Schema.Struct({
  created: Schema.Struct({ id: Schema.String, title: Schema.String, score: Schema.Number, enabled: Schema.Boolean }),
  afterHook: Schema.Struct({ id: Schema.String, title: Schema.String, score: Schema.Number, enabled: Schema.Boolean }),
  final: Schema.Struct({ id: Schema.String, title: Schema.String, score: Schema.Number, enabled: Schema.Boolean }),
}));

export async function prepareMixedScenario(name: "mixed-product" | "mixed-payload" | "mixed-workflow",
  sampleCount: number): Promise<CorePerformanceScenario & { setTrace(trace: MixedMutationPerformanceTrace | undefined): void }> {
  const profile = name === "mixed-product" ? "product" : name === "mixed-payload" ? "productPayload" : "workflow";
  const series = await prepareMixedMutationPerformanceSeries({ driver: "postgres", suffix: `core-perf-${name}`,
    profile, sampleCount });
  if (series.currency.resource.kind !== "postgres") { await series.close(); throw new Error("Expected PostgreSQL"); }
  return {
    timings: { provisionAndPrepareMs: series.provisioningMilliseconds,
      runtimeConstructionMs: series.preparedModuleMilliseconds,
      initialSeedMs: series.initialSeedingMilliseconds + series.additionalSetupSeedingMilliseconds,
      ...(series.currency.installationTiming === undefined ? {} : { installation: series.currency.installationTiming }),
      fixturePreparation: series.currency.preparationTiming },
    pools: { controlPool: series.currency.resource.control.pool, targetPool: series.currency.resource.target.pool },
    setTrace: series.setTrace,
    async prepareSample(_id, index) {
      await series.prepareAttempt(index);
      let outcome: Awaited<ReturnType<typeof series.runAttempt>> | undefined;
      return {
        async run() { outcome = await series.runAttempt(index); return outcome.returnedValue; },
        async verify(result) {
          if (outcome === undefined) throw new Error("Missing settled mixed result");
          expect(result).toEqual(outcome.returnedValue);
          expect(outcome.publication.kind).toBe("published");
          if (outcome.publication.kind !== "published") throw new Error("Missing publication");
          expect(outcome.publication.successfulResult.valueJson).toEqual(result);
          expect(outcome.workerConstructionMilliseconds).toBe(0);
          expect(outcome.sealedJournalBytes).toBeGreaterThan(0);
          const business = decodeBusiness(outcome.returnedValue);
          expect(business.updated).toMatchObject({ id: outcome.seed.productId, title: outcome.seed.newTitle,
            handle: outcome.seed.newHandle, status: "published" });
          expect(business.pending).toMatchObject({ id: outcome.seed.productId, title: outcome.seed.newTitle });
          const committedProduct = await outcome.fixture.readCurrentProduct();
          expect(committedProduct).toMatchObject({ id: outcome.seed.productId,
            title: outcome.seed.newTitle, handle: outcome.seed.newHandle, status: "published" });
          expect(await outcome.fixture.readSettlementLedger()).not.toBeNull();
          if (name !== "mixed-product") {
            const payload = decodePayload(outcome.returnedValue);
            expect(payload.created).toMatchObject({ title: outcome.seed.newTitle, score: 0, enabled: false });
            expect(payload.afterHook).toMatchObject({ id: payload.created.id, score: 1, enabled: false });
            expect(payload.final).toMatchObject({ id: payload.created.id, score: 1, enabled: true });
            expect(await outcome.fixture.readCurrentPayloadPost(payload.created.id)).toMatchObject({
              id: payload.created.id, title: outcome.seed.newTitle, score: 1, enabled: true,
            });
          }
          if (name === "mixed-workflow") {
            const workflow = Schema.decodeUnknownSync(Schema.Struct({ workflow: Schema.Unknown }))(result).workflow;
            const graph = verifyProductLaunchWorkflow(workflow, outcome.seed.productId, outcome.seed.tagId, outcome.seed.newTitle);
            const variant = graph.pricing.variants[0];
            const priceSet = graph.pricing.priceSets[0];
            if (variant === undefined || priceSet === undefined) throw new Error("Missing verified workflow pricing graph");
            expect(committedProduct).toMatchObject({
              tags: [{ id: outcome.seed.tagId, value: "launched" }],
              variants: [{ id: variant.id, product_id: outcome.seed.productId }],
            });
            const persisted = await outcome.fixture.readCurrentWorkflowPricing(variant.id, priceSet.id);
            expect(persisted.priceSet).toMatchObject({ id: priceSet.id, prices: [
              { currency_code: "USD", amount: 50, price_rules: [] },
            ] });
            expect(persisted.links).toMatchObject([[{ variant_id: variant.id, price_set_id: priceSet.id }], 1]);
          } else expect(Schema.decodeUnknownSync(Schema.Struct({ listed: Schema.Array(Schema.Struct({ id: Schema.String })) }))(result)
            .listed).toEqual([expect.objectContaining({ id: outcome.seed.productId })]);
        },
        cleanup: async () => {},
      };
    },
    dispose: series.close,
  };
}
