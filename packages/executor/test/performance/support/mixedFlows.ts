import { Schema } from "effect";
import { expect } from "vitest";
import { mixedPayloadSuccessProfile } from "../../../../payload-adapter/src/testing/mutation";
import { prepareMixedMutationPerformanceSeries } from "./mixedMutationProductFixture";
import type { CorePerformanceScenario } from "./scenario";
import type { CorePerformanceScenarioName, CorePerformanceSize } from "./scenarioCatalog";
import type { PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/support/postgresHelpers";
import {
  type PointCommitPublicationObservation,
} from "../../../../persistence-postgres/src/commit/point/observation";

const resultSchema = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, finalName: Schema.String,
  pending: Schema.optional(Schema.Struct({ id: Schema.String, title: Schema.String })),
  payloadId: Schema.optional(Schema.String) }));

export function measurementApplicationSource(name: CorePerformanceScenarioName, repeats: number) {
  const payloadParticipant = JSON.stringify(mixedPayloadSuccessProfile.participant);
  const body = name === "application-only" ? `
    const before = await ctx.db.get(id);
    if (before.name !== "before") throw new Error("Missing pending Application insert");
    const finalName = "after";
    await ctx.db.patch(id, { name: finalName });
    const final = await ctx.db.get(id);
    if (final.name !== finalName) throw new Error("Missing pending Application patch");
    return { id, finalName };`
    : name === "mixed-application-payload" ? `
    const created = await ctx.privateMixed.call(${payloadParticipant}, "payload-create",
      { collection: "posts", data: { title: "payload-" + seed.updateInput.id, publishedAt: "2026-01-01" } });
    const pending = await ctx.privateMixed.call(${payloadParticipant}, "payload-findByID", { collection: "posts", id: created.id });
    if (pending.score !== 1) throw new Error("Missing pending hook update");
    const final = await ctx.privateMixed.call(${payloadParticipant}, "payload-update", { collection: "posts", id: created.id, data: { enabled: true } });
    const finalName = final.title + ":" + final.score;
    await ctx.db.patch(id, { name: finalName });
    return { id, finalName, payloadId: final.id };`
      : name === "mixed-repeated-product" ? `
    let pending;
    for (let index = 0; index < ${repeats}; index++) {
      const title = seed.updateInput.data.title + "-" + index;
      await ctx.privateMixed.call("medusa.product", "update", { id: seed.updateInput.id, data: { ...seed.updateInput.data, title } });
      pending = await ctx.privateMixed.call("medusa.product", "retrieve", seed.retrieveInput);
      if (pending.title !== title) throw new Error("Missing pending Product update");
    }
    const finalName = pending.title;
    await ctx.db.patch(id, { name: finalName });
    return { id, finalName, pending };` : undefined;
  if (body === undefined) throw new Error("Unknown additional mixed measurement graph");
  return `export default { users: { create: { isMutation: true, isPublic: true, _handler: async (ctx, args) => {
    const seed = JSON.parse(args.body);
    const id = await ctx.db.insert("users", { name: "before" });
    ${body}
  } } } };`;
}

export async function prepareAdditionalMixedFlow(name: CorePerformanceScenarioName, sampleCount: number,
  size: CorePerformanceSize, driver: "postgres" | "pglite" = "postgres", postgresEndpoints?: PostgresFixtureEndpoints) {
  const repeats = size === "small" ? 2 : 4;
  const series = await prepareMixedMutationPerformanceSeries({ driver, suffix: `executor-${name}-${size}`,
    profile: name === "mixed-application-payload" ? "productPayload" : "product", sampleCount,
    ...(postgresEndpoints === undefined ? {} : { postgresEndpoints }),
    applicationSource: () => measurementApplicationSource(name, repeats) });
  async function prepareSample(_id: string, index: number) {
    await series.prepareAttempt(index);
    let outcome: Awaited<ReturnType<typeof series.runAttempt>> | undefined;
    return {
      async run(observation?: PointCommitPublicationObservation, cleanupFailures?: unknown[]) {
        outcome = await series.runAttempt(index, observation, undefined, cleanupFailures); return outcome.returnedValue;
      },
      async verify(result: unknown) {
        if (outcome === undefined) throw new Error("Missing finite outcome");
        expect(outcome.publication.kind).toBe("published");
        if (outcome.publication.kind !== "published") throw new Error("Missing publication");
        expect(outcome.publication.successfulResult.valueJson).toEqual(result);
        expect(outcome.canonicalResultBytes).toBeGreaterThan(0);
        expect(outcome.workerConstructionMilliseconds).toBe(0);
        const business = resultSchema(result);
        expect(await outcome.fixture.readCurrentApplicationDocument(business.id)).toMatchObject({ name: business.finalName });
        if (name === "mixed-repeated-product") {
          expect(business.pending).toMatchObject({ id: outcome.seed.productId, title: `${outcome.seed.newTitle}-${repeats - 1}` });
          expect(await outcome.fixture.readCurrentProduct()).toMatchObject(business.pending ?? {});
        } else if (name === "mixed-application-payload") {
          if (business.payloadId === undefined) throw new Error("Missing committed Payload identity");
          expect(business.finalName).toBe(`payload-${outcome.seed.productId}:1`);
          expect(await outcome.fixture.readCurrentPayloadPost(business.payloadId)).toMatchObject({
            id: business.payloadId, title: `payload-${outcome.seed.productId}`, score: 1, enabled: true });
          expect(await outcome.fixture.readCurrentProduct()).toMatchObject({ id: outcome.seed.productId, title: `Mixed draft ${outcome.seed.productId.slice("prod_mixed_".length)}` });
        } else expect(business.finalName).toBe("after");
        expect(await outcome.fixture.readSettlementLedger()).not.toBeNull();
      },
      async cleanup() {},
    };
  }
  return { dispose: series.close, prepareSample,
    scenario(): CorePerformanceScenario {
      return { timings: { provisionAndPrepareMs: series.provisioningMilliseconds,
        runtimeConstructionMs: series.preparedModuleMilliseconds,
        initialSeedMs: series.initialSeedingMilliseconds + series.additionalSetupSeedingMilliseconds,
        fixturePreparation: series.currency.preparationTiming },
        ...(series.currency.resource.kind === "postgres" ? {
          pools: { controlPool: series.currency.resource.control.pool, targetPool: series.currency.resource.target.pool },
        } : {}),
        workload: { flow: name, cardinality: { applicationRoots: 1, productUpdates: name === "mixed-repeated-product" ? repeats : 0,
          payloadRoots: name === "mixed-application-payload" ? 1 : 0 },
          limitations: ["Existing fixture installs and seeds Product sources even when the business graph does not call Product; preparation cost is included."] },
        setTrace: series.setTrace, setEffectDiagnostics: series.setEffectDiagnostics, prepareSample, dispose: series.close };
    },
  };
}
