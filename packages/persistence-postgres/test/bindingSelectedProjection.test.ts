import { eq } from "drizzle-orm";
import { Effect, Exit, Option, Result, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema } from "flarex-protocol/catalog";
import { APP_BY_ID_PHYSICAL_SPEC_V1 } from "flarex-protocol/ordered-index";
import { ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { captureBindingValue, isDataBindingSetFrame } from "../src/frameworkSchema/binding/canonical";
import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../src/frameworkSchema/binding/model";
import { prepareBindingSelectedStructure, readBindingSelectedEvidence, storeBindingCandidate, writeBindingActivation,
  retainBindingSelectedStructure,
  type PreparedBindingSelectedStructure } from "../src/frameworkSchema/binding/repository";
import { fxSystemDataBindingHeads } from "../src/frameworkSchema/binding/schema";
import type { StrongReferenceActivationProjection } from "../src/frameworkSchema/binding/strongReferenceProjection";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { captureHostPreparationLifetime, makePreparedHostRuntime, retainPreparedHost } from "../src/preparedHostRuntime";
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
      `select_${suffix}`, candidate.sha256Hex, null), references, { projection: null, owners: [], withdrawsPermission: false });
  })));
  return { frame, location: { scopeId: application.scopeId, storageGeneration: application.storageGeneration } };
}

function required<A>(value: Option.Option<A>): A {
  if (Option.isNone(value)) throw new Error("Missing selected repository evidence");
  return value.value;
}

describe("full selected binding evidence and preparation", () => {
  it("keeps the explicit no-role profile fully authenticated and detached", async () => {
    const persistence = await createMigratedPGlitePersistence();
      const selected = await seed(persistence, 1, 1, "control");
      await persistence.drizzle.transaction(tx => runEffect(Effect.sync(() => {
        // SAFETY: nominal forgery witness. The repository must refuse without
        // inspecting caller properties or reading unprotected metadata.
        const forged = new Proxy({} as PreparedBindingSelectedStructure, {
          get() { throw new Error("Forged selected structure inspected"); },
        });
        expect(retainBindingSelectedStructure(tx, forged, forged, { sequence: "1", sha256: "a".repeat(64) }))
          .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      })));
      const read = () => persistence.drizzle.transaction(tx => runEffect(readBindingSelectedEvidence(tx, selected.location)));
      const first = required(await read());
      Reflect.set(first.candidate.frame.application.physicalLocator, "schemaName", "mutated");
      expect(required(await read()).candidate.frame.application).toEqual(selected.frame.application);
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
        const chargedSizes: number[] = [];
        for (const selected of selections) {
          const protection = { token: fixture.protectedMetadata, database: persistence.drizzle, epoch };
          // Full proof permits an explicit unbounded preparation. Sharing must
          // refuse allocating retained state without a donor and recipient lease.
          const unboundedDonor = prepareBindingSelectedStructure(selected.location, protection, undefined);
          const unboundedRecipient = prepareBindingSelectedStructure(selected.location, protection, undefined);
          const host = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
            const lifetime = yield* captureHostPreparationLifetime();
            return { prepared: prepareBindingSelectedStructure(selected.location, protection, lifetime),
              empty: prepareBindingSelectedStructure(selected.location, protection, lifetime),
              unopened: prepareBindingSelectedStructure(selected.location, protection, lifetime) };
          })));
          const recipient = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
            const lifetime = yield* captureHostPreparationLifetime();
            return {
              prepared: prepareBindingSelectedStructure(selected.location, protection, lifetime),
              empty: prepareBindingSelectedStructure(selected.location, protection, lifetime),
              otherLocation: prepareBindingSelectedStructure({ ...selected.location, scopeId: `${selected.location.scopeId}_other` }, protection, lifetime),
              otherStorage: prepareBindingSelectedStructure({ ...selected.location, storageGeneration: "other" }, protection, lifetime),
              otherToken: prepareBindingSelectedStructure(selected.location, { ...protection, token: new Proxy(protection.token, {}) }, lifetime),
              otherDatabase: prepareBindingSelectedStructure(selected.location, { ...protection, database: new Proxy(protection.database, {}) }, lifetime),
              otherEpoch: prepareBindingSelectedStructure(selected.location, { ...protection, epoch: { ...epoch } }, lifetime),
            };
          })));
          const tiny = await runEffect(Effect.gen(function* () {
            const scope = yield* Scope.make();
            const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1 }).pipe(Scope.provide(scope));
            const access = yield* retainPreparedHost(runtime, Effect.gen(function* () {
              return prepareBindingSelectedStructure(selected.location, protection, yield* captureHostPreparationLifetime());
            }));
            return { scope, access };
          }));
          const tokens = await runEffect(host.use(value => Effect.succeed(value)));
          const received = await runEffect(recipient.use(value => Effect.succeed(value)));
          const tinyToken = await runEffect(tiny.access.use(value => Effect.succeed(value)));
          let checkedHead: DataBindingHeadToken | undefined;
          try {
            try {
              await guarded(tx => Effect.gen(function* () {
                const before = vi.spyOn(tx, "select");
                try {
                  // SAFETY: forged token deliberately witnesses private issuer refusal.
                  const forged = new Proxy({} as PreparedBindingSelectedStructure, { get() { throw new Error("Foreign token inspected"); } });
                  expect(yield* readBindingSelectedEvidence(tx, selected.location, forged).pipe(Effect.result))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  expect(before).not.toHaveBeenCalled();
                } finally { before.mockRestore(); }
                // A genuine unfilled preparation acquires and retains its full
                // canonical evidence under this transaction's protected guard.
                expect(required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.empty)).candidate.frame)
                  .toEqual(selected.frame);
                const full = required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared));
                expect(full.candidate.frame).toEqual(selected.frame);
                const head = { sequence: full.head.frame.sequence, sha256: full.head.sha256 };
                checkedHead = head;
                required(yield* readBindingSelectedEvidence(tx, selected.location, unboundedDonor));
                const select = vi.spyOn(tx, "select");
                try {
                  for (const invalid of [received.otherLocation, received.otherStorage, received.otherToken,
                    received.otherDatabase, received.otherEpoch]) {
                    expect(retainBindingSelectedStructure(tx, invalid, received.prepared, head))
                      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                    expect(retainBindingSelectedStructure(tx, tokens.prepared, invalid, head))
                      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  }
                  expect(retainBindingSelectedStructure(tx, unboundedDonor, received.empty, head))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  expect(retainBindingSelectedStructure(tx, tokens.prepared, unboundedRecipient, head))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  expect(retainBindingSelectedStructure(tx, tokens.unopened, received.prepared, head))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  for (const invalidHead of [{ ...head, sequence: "999" }, { ...head, sha256: "f".repeat(64) }])
                    expect(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, invalidHead))
                      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  expect(retainBindingSelectedStructure(tx, tokens.prepared, tinyToken, head))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "capacityExceeded" } } });
                  yield* tiny.access.close;
                  expect(retainBindingSelectedStructure(tx, tokens.prepared, tinyToken, head))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "closed" } } });
                  const before = Result.getOrThrow(recipient.readUsage()).chargedBytes;
                  expect(Result.isSuccess(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, head))).toBe(true);
                  const retained = Result.getOrThrow(recipient.readUsage()).chargedBytes;
                  expect(retained).toBeGreaterThan(before);
                  expect(Result.isSuccess(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, head))).toBe(true);
                  expect(Result.getOrThrow(recipient.readUsage()).chargedBytes).toBe(retained);
                  expect(select).not.toHaveBeenCalled();
                } finally { select.mockRestore(); }
                Reflect.set(full.candidate.frame.application.physicalLocator, "schemaName", "mutated-entry-result");
              }));
              if (checkedHead === undefined) throw new Error("Missing fully checked donor head");
              const head = checkedHead;
              await persistence.drizzle.transaction(tx => runEffect(Effect.sync(() => {
                expect(retainBindingSelectedStructure(tx, tokens.prepared, received.empty, head))
                  .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                const before = Result.getOrThrow(recipient.readUsage()).chargedBytes;
                expect(Result.isSuccess(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, head))).toBe(true);
                expect(Result.getOrThrow(recipient.readUsage()).chargedBytes).toBe(before);
              })));
              const receivedEvidence = required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, received.prepared)));
              expect(receivedEvidence.candidate.frame).toEqual(selected.frame);
              Reflect.set(receivedEvidence.candidate.frame.application.physicalLocator, "schemaName", "mutated-recipient-result");
              expect(required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, received.prepared)))
                .candidate.frame).toEqual(selected.frame);
              const scopedRecipient = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
                return prepareBindingSelectedStructure(selected.location, protection, yield* captureHostPreparationLifetime());
              })));
              const scopedToken = await runEffect(scopedRecipient.use(value => Effect.succeed(value)));
              try {
                await guarded(tx => Effect.gen(function* () {
                  const donor = required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared));
                  yield* Effect.fromResult(retainBindingSelectedStructure(tx, tokens.prepared, scopedToken,
                    { sequence: donor.head.frame.sequence, sha256: donor.head.sha256 }));
                  const borrowed = required(yield* readBindingSelectedEvidence(tx, selected.location, scopedToken));
                  expect(borrowed.candidate.frame).toEqual(selected.frame);
                  Reflect.set(borrowed.candidate.frame.application.physicalLocator, "schemaName", "mutated-borrowed-result");
                  expect(required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared)).candidate.frame)
                    .toEqual(selected.frame);
                  yield* scopedRecipient.close;
                  const select = vi.spyOn(tx, "select");
                  try {
                    expect(yield* readBindingSelectedEvidence(tx, selected.location, scopedToken).pipe(Effect.result))
                      .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "closed" } } });
                    expect(select).not.toHaveBeenCalled();
                  } finally { select.mockRestore(); }
                  expect(required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared)).candidate.frame)
                    .toEqual(selected.frame);
                }));
              } finally { await runEffect(scopedRecipient.close); }
              const usage = Result.getOrThrow(host.readUsage()).chargedBytes;
              chargedSizes.push(usage);
              const detached = required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, tokens.prepared)));
              expect(detached.candidate.frame).toEqual(selected.frame);
              Reflect.set(detached.candidate.frame.application.physicalLocator, "schemaName", "mutated-read-result");
              expect(required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, tokens.prepared))).candidate.frame)
                .toEqual(selected.frame);
              expect(Result.getOrThrow(host.readUsage()).chargedBytes).toBe(usage);
              const row = (await persistence.drizzle.select().from(fxSystemDataBindingHeads)
                .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId)))[0];
              if (row === undefined) throw new Error("Missing protected head witness");
              const corrupt = Uint8Array.from(row.canonicalBytes); corrupt[0] = 32;
              await persistence.drizzle.update(fxSystemDataBindingHeads).set({ canonicalBytes: corrupt })
                .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId));
              try {
                await expect(guarded(tx => readBindingSelectedEvidence(tx, selected.location, tokens.prepared)))
                  .rejects.toMatchObject({ reason: "storedCorruption" });
              } finally {
                await persistence.drizzle.update(fxSystemDataBindingHeads).set({ canonicalBytes: row.canonicalBytes })
                  .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId));
              }
            } finally {
              await runEffect(host.close);
              await runEffect(Scope.close(tiny.scope, Exit.succeed(undefined)));
            }
            {
              expect(required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, received.prepared)))
                .candidate.frame).toEqual(selected.frame);
              if (checkedHead === undefined) throw new Error("Missing checked head after donor close");
              const head = checkedHead;
              await guarded(tx => Effect.sync(() => {
                expect(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, head))
                  .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "closed" } } });
              }));
            }
            await guarded(tx => Effect.gen(function* () {
              const select = vi.spyOn(tx, "select");
              try {
                expect(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared).pipe(Effect.result))
                  .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: { reason: "closed" } } });
                expect(select).not.toHaveBeenCalled();
              } finally { select.mockRestore(); }
            }));
          } finally { await runEffect(recipient.close); }
        }
        expect(chargedSizes[1]).toBeGreaterThan(chargedSizes[0] ?? 0);
      } finally { await fixture.dispose(); }
    }, 180_000,
  );
});
