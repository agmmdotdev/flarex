import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { documentValidationRecoverySource } from "./support/documentValidationRecoverySource";
import { prepareMixedMutationPerformanceSeries } from "./support/mixedMutationProductFixture";
import { runMixedMutationInProcess } from "./support/mixedMutationInProcessRuntime";

describe("direct mixed performance execution", () => {
  it("publishes separate authenticated Product attempts using one prepared database", async () => {
    const series = await prepareMixedMutationPerformanceSeries({
      driver: "pglite", suffix: "core-performance-direct", profile: "product", sampleCount: 2,
      applicationSource: documentValidationRecoverySource,
    });
    try {
      await series.prepareAttempt(0);
      const first = await series.runAttempt(0);
      await series.prepareAttempt(1);
      const second = await series.runAttempt(1);
      expect(first.fixture.currency.resource).toBe(second.fixture.currency.resource);
      expect(first.fixture.activation.anchor.sessionId).not.toBe(second.fixture.activation.anchor.sessionId);
      expect(first.seed.productId).not.toBe(second.seed.productId);
      expect(series.workerConstructionCount).toBe(0);
      for (const sample of [first, second]) {
        expect(sample.returnedValue).toMatchObject({
          caughtDocumentValidation: true,
          earlier: { name: "earlier accepted" },
          updated: { id: sample.seed.productId, title: sample.seed.newTitle },
          pending: { id: sample.seed.productId, title: sample.seed.newTitle },
        });
        expect(sample.publication).toMatchObject({ kind: "published" });
        expect(sample.workerConstructionMilliseconds).toBe(0);
        expect(sample.canonicalResultBytes).toBeGreaterThan(0);
        expect(sample.fixture.nativeInvokeCount.get("update")).toBe(1);
        expect((await sample.fixture.readSettlementLedger())?.syscallReceipts).toBe(8);
        const earlier = Schema.decodeUnknownSync(Schema.Struct({ earlier: Schema.Struct({ _id: Schema.String }) }))(sample.returnedValue).earlier;
        expect(await sample.fixture.readCurrentApplicationDocument(earlier._id)).toMatchObject({ name: "earlier accepted" });
      }
      await expect(series.runAttempt(0)).rejects.toThrow("already used");
    } finally { await series.close(); }
  }, 180_000);

  it("retains a caught participant failure through portable runtime drain", async () => {
    const cause = new Error("participant rejected");
    await expect(runMixedMutationInProcess({
      source: `export default { users: { create: { isMutation: true, isPublic: true,
        _handler: async ctx => { try { await ctx.privateMixed.call("example", "run", {}); }
          catch {} return "caught"; } } } };`,
      request: JSON.stringify({ format: "flarex.point-mutation-exact-runtime", version: 1,
        artifact: { runtime: "dynamic-worker", artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sourcePackageHash: "a".repeat(64), executionModule: "app.js" },
        function: { path: "users:create", executionModule: "app.js", kind: "mutation", visibility: "public",
          argsValidator: { type: "any" }, returnsValidator: null },
        auth: { kind: "anonymous" }, arguments: {}, argumentArraySemanticBytes: 4,
        tables: [{ tableId: 1, logicalName: "users" }], context: { executionId: "run-1", logScopeId: "log-1",
          randomSeed: Array(32).fill(5), executionTime: Date.UTC(2026, 6, 24), initialCreationTimeCursor: Date.UTC(2026, 6, 24) },
      }),
      executionModule: "app.js", executionTime: Date.UTC(2026, 6, 24),
      bridge: async () => { throw cause; },
    })).rejects.toMatchObject({ cause });
  });
});
