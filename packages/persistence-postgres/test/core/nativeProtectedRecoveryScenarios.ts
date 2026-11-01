import { randomBytes } from "node:crypto";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreNativeRootRecoveryInput } from "../../src/core/api";
import type { CorePersistenceFixture } from "./fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { coreNativeTestBudget } from "./nativeTestBudget";

/** This is an outcome-owner witness, separate from protected Worker/native
 * permission and binding-lifecycle consumer proof. No fixture publishes results. */
export function registerNativeProtectedRecoveryScenarios(label: string, fixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    it("reconstructs historical disclosure after withdrawal without granting fresh native authority", async () => {
      const tested = await fixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const compiled = yield* compilePayloadCollections([{ slug: "posts", fields: [{ name: "title", type: "text", required: true }] }]);
        const definition = yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
          scopeUuid: "1726a4fd-1e3f-4166-a276-72742040bd95", epochUuid: "21172004-bd8d-40f5-b735-825ec68c06bd" });
        const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
        const options = { schemaBundles: [bundle], now: Effect.succeed(1_000_000_000n),
          randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
          schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
        const database = yield* Effect.acquireRelease(openCoreDatabase(tested.persistence, options), owner => owner.close());
        const proposal = yield* database.prepareSchema({ bundle });
        let activated = false;
        for (let step = 0; step < 128; step++) {
          const status = yield* database.schemaStatus(proposal);
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
            yield* database.activateSchema(proposal, { programs: [], bundle }); activated = true; break;
          }
          yield* database.advanceSchema(proposal, { pageSize: 8, maxPages: 8 });
        }
        if (!activated) return yield* Effect.die(new Error("Protected recovery fixture schema did not activate"));
        const binding = yield* database.bindNative({ definition });
        const childLimits = { maxIdentities: 16, maxDocumentBytes: 65_536 };
        const recoveryInput: CoreNativeRootRecoveryInput = { bundle, contract: { name: "protected-history", principal: "alice" },
          participants: [{ definition, commands: [{ name: "payload-create", mode: "write" }],
            limits: childLimits }], maxFinalUserDocuments: 16 };
        const root = yield* database.bindNativeRoot({ ...recoveryInput,
          participants: [{ binding, commands: ["payload-create"], limits: childLimits }] });
        const liveMetadata = yield* database.readNativeRootBinding(root);
        const historical = yield* database.bindNativeRootRecovery(recoveryInput);
        expect(historical.identity).toEqual(liveMetadata.identity);
        const correlation = { key: "protected-historical-result", requestHash: "alice+normalized-request" };
        const request = { ...correlation, kind: "nativeRoot" as const, root: historical.identity };
        const acquisition = yield* database.claimRequest(request, root);
        if (acquisition.kind !== "claimed") return yield* Effect.die(new Error("Fresh protected request was not claimed"));
        const operation = yield* database.beginNativeRoot(root, { claim: acquisition.claim,
          chargeRetained: coreNativeTestBudget().chargeRetained });
        const payload = yield* operation.native(binding);
        const id = yield* payload.insert("posts", { title: "One native invocation", createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z" });
        const timestamp = yield* database.commit(yield* operation.finalize(), { claim: acquisition.claim, result: { id } });
        // Withdrawal invalidates the live grant. Historical recovery carries no
        // grant, and it does not restore the old authority after this change.
        yield* database.advanceAuthorityEpoch(1n);
        expect(yield* Effect.flip(database.claimRequest(request, root))).toMatchObject({ reason: "authorityRevoked" });
        expect(yield* historical.resolve(correlation)).toEqual({ kind: "committed", timestamp, result: { id } });
        yield* database.close();
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => tested.reopen()), options), owner => owner.close());
        const cold = yield* reopened.bindNativeRootRecovery(recoveryInput);
        expect(yield* cold.recover(correlation)).toEqual({ kind: "committed", timestamp, result: { id } });
        expect(yield* cold.resolve({ ...correlation, key: "genuinely-absent" })).toEqual({ kind: "missing" });
        expect(yield* Effect.flip(cold.resolve({ ...correlation, requestHash: "bob+normalized-request" }))).toMatchObject({ reason: "requestMismatch" });
        const foreign = yield* reopened.bindNativeRootRecovery({ ...recoveryInput,
          contract: { name: "protected-history", principal: "bob" } });
        expect(yield* Effect.flip(foreign.resolve(correlation))).toMatchObject({ reason: "requestMismatch" });
        // Forged source/bundle objects never acquire historical disclosure.
        expect(yield* Effect.flip(reopened.bindNativeRootRecovery({ ...recoveryInput,
          bundle: { ...bundle } }))).toMatchObject({ reason: "unsupportedCapability" });
        expect(yield* reopened.readAuthorityEpoch).toBe(1n);
        expect(yield* reopened.publishedTimestamp).toBeGreaterThan(timestamp);
      }))); } finally { await tested.close(); }
    }, 90_000);
  });
}
