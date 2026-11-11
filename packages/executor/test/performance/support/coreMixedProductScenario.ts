import assert from "node:assert/strict";
import { Schema } from "effect";
import { createCoreMixedProductFixture } from "./coreMixedProductFixture";
import type { CorePerformanceScenario } from "./scenario";
import type { PostgresFixtureEndpoints } from "../../../../persistence-postgres/test/support/postgresHelpers";
import type { MixedMutationPerformanceTrace } from "../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";

const decodeBusiness = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  updated: Schema.Struct({ id: Schema.String, title: Schema.String, handle: Schema.String, status: Schema.String }),
  pending: Schema.Struct({ id: Schema.String, title: Schema.String }),
  listed: Schema.Array(Schema.Struct({ id: Schema.String })),
}));
const decodeUser = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }));

/** Current construction for the actual mixed-product scenario. Historical
 * finite instrumentation stays with its original consumers and frozen reports. */
export async function prepareCoreMixedProductScenario(sampleCount: number, driver: "postgres" | "pglite",
  postgresEndpoints?: PostgresFixtureEndpoints,
): Promise<CorePerformanceScenario & { setTrace(trace: MixedMutationPerformanceTrace | undefined): void }> {
  const started = performance.now();
  const fixture = await createCoreMixedProductFixture({ driver, suffix: "core-perf-mixed-product", sampleCount,
    ...(postgresEndpoints === undefined ? {} : { postgresEndpoints }) });
  const attempted = new Set<number>();
  return {
    workload: { flow: "mixed-product", cardinality: { applicationRoots: 1, productRoots: 1, payloadRoots: 0, workflows: 0 },
      limitations: ["Current Core construction; performance measurement remains paused. Legacy finite observation is unsupported."] },
    timings: { provisionAndPrepareMs: performance.now() - started, runtimeConstructionMs: null, initialSeedMs: 0 },
    setTrace(trace) { if (trace !== undefined) throw new Error("Core mixed Product does not support legacy finite tracing"); },
    setEffectDiagnostics(diagnostics) { if (diagnostics !== undefined) throw new Error("Core mixed Product does not support legacy finite diagnostics"); },
    async prepareSample(_id, index) {
      const seed = await fixture.prepare(index);
      let outcome: Awaited<ReturnType<typeof fixture.invoke>> | undefined;
      return {
        async run(observation) {
          if (observation !== undefined) throw new Error("Core mixed Product does not support legacy publication observation");
          if (attempted.has(index)) throw new Error("Core mixed Product sample already used");
          attempted.add(index);
          outcome = await fixture.invoke(index);
          return outcome.outcome.value;
        },
        async verify(result) {
          if (outcome === undefined) throw new Error("Missing Core mixed Product outcome");
          assert.equal(outcome.outcome.disposition, "published");
          assert.deepEqual(result, outcome.outcome.value);
          const business = decodeBusiness(result);
          const expected = { id: seed.productId, title: seed.newTitle, handle: seed.newHandle, status: "published" };
          assert.deepEqual(business.updated, expected);
          assert.deepEqual(business.pending, { id: seed.productId, title: seed.newTitle });
          assert.deepEqual(business.listed, [{ id: seed.productId }]);
          assert.deepEqual(decodeBusiness({ ...business, updated: await fixture.readProduct(seed.productId) }).updated, expected);
          const application = await fixture.readApplication(business.id);
          assert.deepEqual(decodeUser(application), { name: seed.newTitle });
        },
        cleanup: async () => {},
      };
    },
    dispose: fixture.close,
  };
}
