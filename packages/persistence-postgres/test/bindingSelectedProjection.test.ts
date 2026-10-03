import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema } from "flarex-protocol/catalog";
import { APP_BY_ID_PHYSICAL_SPEC_V1 } from "flarex-protocol/ordered-index";
import { ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { captureBindingValue, isDataBindingSetFrame } from "../src/frameworkSchema/binding/canonical";
import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import type { DataBindingSetFrame } from "../src/frameworkSchema/binding/model";
import { prepareBindingSelectedStructure, readBindingSelectedEvidence, readBindingSelectedProjection,
  readUnprotectedBindingSelectedProjection, storeBindingCandidate, writeBindingActivation,
  type PreparedBindingSelectedStructure } from "../src/frameworkSchema/binding/repository";
import { fxSystemDataBindingHeads } from "../src/frameworkSchema/binding/schema";
import type { StrongReferenceActivationProjection } from "../src/frameworkSchema/binding/strongReferenceProjection";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { captureHostPreparationLifetime, retainPreparedHost } from "../src/preparedHostRuntime";
import { captureProtectedMetadataEpoch, closeProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope } from "../src/preparedMetadataEpoch";
import { insertInitialScopeClockInTransactionResult } from "../src/scopeClockInitialization";
import { runEffect } from "./effectTestRuntime";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createProtectedFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";
import { preparedHostTestRuntime } from "./preparedHostRuntimeTestSupport";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

/** Repository grammar witness: these policy/reference values carry no
 * executable framework grants. Framework admission is covered by its hosts. */
async function seed(persistence: Persistence, policyCount: number, referenceCount: number, suffix: string) {
  const application: DataBindingSetFrame["application"] = {
    deploymentId: "selected-projection", scopeId: `scope_selected_projection_${suffix}`,
    physicalLocator: { kind: "database_per_scope", databaseKey: "selected-projection", schemaName: "public" },
    storageGeneration: "flarexdb_v1", storageGenerationFence: "1", epoch: "epoch_selected_projection",
    authorizationRevocationEpoch: "0", activationSequence: "1", headSha256: "a".repeat(64),
    activationSha256: "b".repeat(64), revisionId: "selected-revision", schemaVersionId: "selected-schema",
    applicationSchemaSha256: "c".repeat(64), schemaManifestSha256: "d".repeat(64),
    readinessSha256: "e".repeat(64), readiness: { kind: "legacy", schemaBindingSha256: "f".repeat(64) },
  };
  const frame: DataBindingSetFrame = { format: "flarex.data-binding-set", application, logicalSchema: null,
    payloadContent: { application, configSha256: "a".repeat(64), provenanceSha256: "b".repeat(64),
      tables: Array.from({ length: policyCount }, (_, index) => ({ tableId: `policy_${index}`, writePolicySha256: "c".repeat(64) })) },
    payloadLifecycle: null, commerce: [], crossDomainReferences: [] };
  const references: StrongReferenceActivationProjection[] = Array.from({ length: referenceCount }, (_, index) => ({
    name: `unrelated_${index}`, sourceTableId: CatalogTableIdSchema.make(index + 1), sourceField: "id",
    sourceLiveness: { kind: "current" }, reverseIndex: { indexDefinitionId: CatalogIndexDefinitionIdSchema.make(index + 1),
      physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1, physicalSpecSha256Hex: "d".repeat(64) },
    targetTableId: CatalogTableIdSchema.make(1000 + index), targetField: "id", targetLiveness: { kind: "current" },
    targetIdentity: { kind: "documentId", logicalTableName: `unrelated_${index}` }, onTargetDelete: "restrict",
  }));
  await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    yield* Effect.fromResult(yield* Effect.promise(() => insertInitialScopeClockInTransactionResult(tx, {
      scopeId: ScopeIdSchema.make(application.scopeId), initialEpoch: ScopeEpochSchema.make(application.epoch),
    })));
    const candidate = yield* captureBindingValue(frame, isDataBindingSetFrame);
    yield* storeBindingCandidate(tx, candidate, []);
    yield* writeBindingActivation(tx, dataBindingActivationRequest(application.scopeId, application.storageGeneration,
      `select_${suffix}`, candidate.sha256Hex, null), references);
  })));
  return { frame, location: { scopeId: application.scopeId, storageGeneration: application.storageGeneration } };
}

function required<A>(value: Option.Option<A>): A {
  if (Option.isNone(value)) throw new Error("Missing selected repository evidence");
  return value.value;
}

describe("finite selected binding projection", () => {
  it("keeps the explicit no-role profile fully authenticated and detached", async () => {
    const persistence = await createMigratedPGlitePersistence();
      const selected = await seed(persistence, 1, 1, "control");
      const read = () => persistence.drizzle.transaction(tx => runEffect(readUnprotectedBindingSelectedProjection(tx, selected.location)));
      const first = required(await read());
      Reflect.set(first.reference.application.physicalLocator, "schemaName", "mutated");
      expect(required(await read()).reference.application).toEqual(selected.frame.application);
      const row = (await persistence.drizzle.select().from(fxSystemDataBindingHeads)
        .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId)))[0];
      if (row === undefined) throw new Error("Missing head witness");
      const corrupt = Uint8Array.from(row.canonicalBytes); corrupt[0] = 32;
      await persistence.drizzle.update(fxSystemDataBindingHeads).set({ canonicalBytes: corrupt })
        .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId));
      await expect(read()).rejects.toMatchObject({ reason: "storedCorruption" });
  }, 180_000);

  it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "retains policy/reference growth once and refuses invalid preparation, head and lease", async () => {
      // Full-proof restricted-login fixture isolates repository authentication.
      // The connected mixed benchmark covers the managed installation profile.
      const fixture = await createProtectedFileScopedPostgresFixture();
      const persistence = fixture.persistence;
      const guarded = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
        persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
          openProtectedMetadataFinalGuardScope(tx);
          const result = yield* work(tx);
          yield* flushProtectedMetadataFinalGuards(tx);
          return result;
        }).pipe(Effect.ensuring(Effect.sync(() => closeProtectedMetadataFinalGuardScope(tx))))));
      try {
        // Payload policy grammar caps each candidate at64. The activation's
        // independent reference projection grows to100 actual endpoints.
        const selections = [await seed(persistence, 1, 1, "small"), await seed(persistence, 64, 100, "large")];
        const epoch = await persistence.drizzle.transaction(tx => runEffect(
          captureProtectedMetadataEpoch(fixture.protectedMetadata, persistence.drizzle, tx)));
        const projectionSizes: number[] = [];
        const chargedSizes: number[] = [];
        for (const selected of selections) {
          const host = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
            const lifetime = yield* captureHostPreparationLifetime();
            const protection = { token: fixture.protectedMetadata, database: persistence.drizzle, epoch };
            return { prepared: prepareBindingSelectedStructure(selected.location, protection, lifetime),
              empty: prepareBindingSelectedStructure(selected.location, protection, lifetime) };
          })));
          const tokens = await runEffect(host.use(value => Effect.succeed(value)));
          try {
            await guarded(tx => Effect.gen(function* () {
              const before = vi.spyOn(tx, "select");
              try {
                // SAFETY: forged token deliberately witnesses private issuer refusal.
                const forged = new Proxy({} as PreparedBindingSelectedStructure, { get() { throw new Error("Foreign token inspected"); } });
                expect(yield* readBindingSelectedProjection(tx, selected.location, forged).pipe(Effect.result))
                  .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                expect(yield* readBindingSelectedProjection(tx, selected.location, tokens.empty).pipe(Effect.result))
                  .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                expect(before).not.toHaveBeenCalled();
              } finally { before.mockRestore(); }
              const full = required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared));
              expect(full.candidate.frame).toEqual(selected.frame);
              Reflect.set(full.candidate.frame.application.physicalLocator, "schemaName", "mutated-entry-result");
            }));
            const usage = Result.getOrThrow(host.readUsage()).chargedBytes;
            chargedSizes.push(usage);
            const clone = vi.spyOn(globalThis, "structuredClone");
            try {
              for (let iteration = 0; iteration < 10; iteration++) {
                const projection = required(await guarded(tx => readBindingSelectedProjection(tx, selected.location, tokens.prepared)));
                expect(projection.reference).toEqual({ application: selected.frame.application, logicalSchema: null });
                expect(projection.hasPayloadContent).toBe(true);
                expect(projection.hasPayloadLifecycle).toBe(false);
                expect(Object.keys(projection).sort()).toEqual(["hasPayloadContent", "hasPayloadLifecycle", "head", "reference"]);
                if (iteration === 0) projectionSizes.push(JSON.stringify(projection.reference).length);
                Reflect.set(projection.reference.application.physicalLocator, "schemaName", "mutated-demand-result");
                expect(Result.getOrThrow(host.readUsage()).chargedBytes).toBe(usage);
              }
              expect(clone.mock.calls.some(([value]) => typeof value === "object" && value !== null &&
                ("candidate" in value || "activation" in value || "strongReferences" in value))).toBe(false);
            } finally { clone.mockRestore(); }
            const row = (await persistence.drizzle.select().from(fxSystemDataBindingHeads)
              .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId)))[0];
            if (row === undefined) throw new Error("Missing protected head witness");
            const corrupt = Uint8Array.from(row.canonicalBytes); corrupt[0] = 32;
            await persistence.drizzle.update(fxSystemDataBindingHeads).set({ canonicalBytes: corrupt })
              .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId));
            await expect(guarded(tx => readBindingSelectedProjection(tx, selected.location, tokens.prepared)))
              .rejects.toMatchObject({ reason: "storedCorruption" });
          } finally { await runEffect(host.close); }
          await guarded(tx => Effect.gen(function* () {
            const select = vi.spyOn(tx, "select");
            try {
              expect(yield* readBindingSelectedProjection(tx, selected.location, tokens.prepared).pipe(Effect.result))
                .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "closed" } } });
              expect(select).not.toHaveBeenCalled();
            } finally { select.mockRestore(); }
          }));
        }
        expect(chargedSizes[1]).toBeGreaterThan(chargedSizes[0] ?? 0);
        expect(projectionSizes[1]).toBe(projectionSizes[0]);
      } finally { await fixture.dispose(); }
    }, 180_000,
  );
});
