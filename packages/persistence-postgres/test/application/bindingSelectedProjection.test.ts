import { eq, sql } from "drizzle-orm";
import { Effect, Exit, Option, Result, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CatalogIndexDefinitionIdSchema, CatalogTableIdSchema } from "flarex-protocol/catalog";
import { APP_BY_ID_PHYSICAL_SPEC_V1 } from "flarex-protocol/ordered-index";
import { ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { captureBindingValue, isDataBindingSetFrame } from "../../src/installation/frameworkSchema/binding/canonical";
import { dataBindingActivationRequest } from "../../src/installation/frameworkSchema/binding/host";
import type { DataBindingHeadToken, DataBindingSetFrame } from "../../src/installation/frameworkSchema/binding/model";
import { prepareBindingSelectedStructure, readBindingSelectedEvidence, storeBindingCandidate, writeBindingActivation,
  readBindingHead, readPreparedBindingCandidate,
  retainBindingSelectedStructure,
  withBindingSelectionInTransaction, closeBindingSelectionCaptureInTransaction, readBindingCoverageSelectedEvidence,
  bindingStatement,
  type PreparedBindingSelectedStructure } from "../../src/installation/frameworkSchema/binding/repository";
import { fxSystemDataBindingHeads } from "../../src/installation/frameworkSchema/binding/schema";
import type { StrongReferenceActivationProjection } from "../../src/installation/frameworkSchema/binding/strongReferenceProjection";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import type { PGliteFlarexPersistence } from "../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import { captureHostPreparationLifetime, makePreparedHostRuntime, retainPreparedHost } from "../../src/execution/preparation/preparedHostRuntime";
import { captureProtectedMetadataEpoch, closeProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope } from "../../src/execution/preparation/preparedMetadataEpoch";
import { insertInitialScopeClockInTransactionResult } from "../../src/scope/scopeClockInitialization";
import { runEffect } from "../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, postgresUrl } from "../support/postgresHelpers";
import { useFileScopedPersistence } from "../support/fileScopedPersistenceFixture";
import { preparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";

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
      `select_${suffix}`, candidate.sha256Hex, null), references, { projection: null, owners: [], withdrawsPermission: false,
        maintenance: { outgoing: null, incoming: { deploymentId: application.deploymentId, schemaVersionId: null,
          manifestSha256: null, indexes: [], unique: [] } } });
  })));
  return { frame, location: { scopeId: application.scopeId, storageGeneration: application.storageGeneration } };
}

function required<A>(value: Option.Option<A>): A {
  if (Option.isNone(value)) throw new Error("Missing selected repository evidence");
  return value.value;
}

describe("full selected binding evidence and preparation", () => {
  it("selects a replacement candidate after the earlier NONE head observation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const selected = await seed(persistence, 1, 1, "replacement");
    await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const early = required(yield* readBindingHead(tx, selected.location, "none"));
      const content = selected.frame.payloadContent;
      if (content === null) throw new Error("Missing replacement content grammar");
      const nextFrame = { ...selected.frame, payloadContent: { ...content, tables: [
        ...content.tables, { tableId: "policy_replacement", writePolicySha256: "d".repeat(64) },
      ] } };
      const candidate = yield* captureBindingValue(nextFrame, isDataBindingSetFrame);
      yield* storeBindingCandidate(tx, candidate, []);
      yield* writeBindingActivation(tx, dataBindingActivationRequest(selected.location.scopeId,
        selected.location.storageGeneration, "replacement_after_none", candidate.sha256Hex,
        { sequence: early.frame.sequence, sha256: early.sha256 }), [],
        { projection: null, owners: [], withdrawsPermission: false, maintenance: {
          outgoing: { deploymentId: selected.frame.application.deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] },
          incoming: { deploymentId: selected.frame.application.deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] } } });
      const current = required(yield* readBindingSelectedEvidence(tx, selected.location));
      expect(current.head.sha256).not.toBe(early.sha256);
      expect(current.candidate.sha256).toBe(candidate.sha256Hex);
      expect(current.candidate.sha256).not.toBe(early.frame.candidateSha256);
      expect(current.candidate.frame).toEqual(nextFrame);
    })));
  }, 180_000);

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
      await persistence.drizzle.transaction(tx => runEffect(withBindingSelectionInTransaction(tx, selected.location,
        () => Effect.gen(function* () {
          yield* readBindingSelectedEvidence(tx, selected.location);
          closeBindingSelectionCaptureInTransaction(tx);
          const select = vi.spyOn(tx, "select");
          try {
            // PGlite's explicit unprotected profile cannot lend immutable
            // metadata just because a transaction selection scope exists.
            expect(required(yield* readBindingCoverageSelectedEvidence(tx, selected.location)).candidate.frame).toEqual(selected.frame);
            expect(select).toHaveBeenCalledTimes(2);
          } finally { select.mockRestore(); }
        }))));
      const first = required(await read());
      expect(Object.isFrozen(first.candidate.frame.application.physicalLocator)).toBe(true);
      expect(Object.isFrozen(first.activation.frame.strongReferences)).toBe(true);
      expect(Object.isFrozen(first.activation.frame.strongReferences[0]?.targetIdentity)).toBe(true);
      expect(Reflect.set(first.candidate.frame.application.physicalLocator, "schemaName", "mutated")).toBe(false);
      expect(required(await read()).candidate.frame.application).toEqual(selected.frame.application);
      const row = (await persistence.drizzle.select().from(fxSystemDataBindingHeads)
        .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId)))[0];
      if (row === undefined) throw new Error("Missing head witness");
      const corrupt = Uint8Array.from(row.canonicalBytes); corrupt[0] = 32;
      await persistence.drizzle.update(fxSystemDataBindingHeads).set({ canonicalBytes: corrupt })
        .where(eq(fxSystemDataBindingHeads.scopeId, selected.location.scopeId));
      await expect(read()).rejects.toMatchObject({ reason: "storedCorruption" });
  }, 180_000);

  describe("PostgreSQL", { concurrent: false }, () => {
    const withOwner = useFileScopedPersistence(async () => {
      const owner = await createFileScopedPostgresFixture();
      return { persistence: owner, reset: owner.reset, dispose: owner.dispose };
    }, postgresUrl !== null && Boolean(process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL));

    it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
      "holds the selected head through publication and accepts the next activation only in a fresh transaction", async () => withOwner(async owner => {
        const fixture = await createProtectedFileScopedPostgresFixture("fullProof", owner);
        const persistence = fixture.persistence;
        let pending: Promise<void> | undefined;
        try {
          const selected = await seed(persistence, 1, 1, "reuse_concurrent");
          const epoch = await persistence.drizzle.transaction(tx => runEffect(
            captureProtectedMetadataEpoch(fixture.protectedMetadata, persistence.drizzle, tx)));
          const host = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
            const lifetime = yield* captureHostPreparationLifetime();
            if (lifetime === undefined) throw new Error("Missing concurrent selection lifetime");
            return Result.getOrThrow(prepareBindingSelectedStructure(selected.location,
              { token: fixture.protectedMetadata, database: persistence.drizzle, epoch }, lifetime));
          })));
          try {
            const prepared = await runEffect(host.use(value => Effect.succeed(value)));
            await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
              openProtectedMetadataFinalGuardScope(tx);
              yield* withBindingSelectionInTransaction(tx, selected.location, () => Effect.gen(function* () {
                const first = required(yield* readBindingSelectedEvidence(tx, selected.location, prepared));
                closeBindingSelectionCaptureInTransaction(tx);
                const [backend] = yield* bindingStatement(tx.select({ pid: sql<number>`pg_backend_pid()` })
                  .from(sql`(values(1)) as backend`));
                if (backend === undefined) throw new Error("Missing reader backend");
                // Activation's actual owner locks the current head before it
                // inserts history or changes protected metadata.
                pending = persistence.drizzle.transaction(writer => runEffect(Effect.gen(function* () {
                  const head = required(yield* readBindingHead(writer, selected.location, "update"));
                  yield* writeBindingActivation(writer, dataBindingActivationRequest(selected.location.scopeId,
                    selected.location.storageGeneration, "reuse_concurrent_activation", first.candidate.sha256,
                    { sequence: head.frame.sequence, sha256: head.sha256 }), [],
                    { projection: null, owners: [], withdrawsPermission: false, maintenance: {
                      outgoing: { deploymentId: selected.frame.application.deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] },
                      incoming: { deploymentId: selected.frame.application.deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] } } });
                })));
                // Observe the server lock, rather than infer exclusion from an
                // arbitrary delay or a still-pending JavaScript promise.
                yield* Effect.promise(async () => {
                  const deadline = Date.now() + 5_000;
                  while (Date.now() < deadline) {
                    const row = (await persistence.query<{ blocked: boolean }>(`select exists(
                      select 1 from pg_catalog.pg_stat_activity where $1::int=any(pg_blocking_pids(pid))
                      and wait_event_type='Lock') as blocked`, [backend.pid])).rows[0];
                    if (row?.blocked === true) return;
                    await new Promise<void>(resolve => { setTimeout(resolve, 5); });
                  }
                  throw new Error("Concurrent activation did not wait on the selected head");
                });
                const select = vi.spyOn(tx, "select");
                try {
                  expect(required(yield* readBindingCoverageSelectedEvidence(tx, selected.location))).toBe(first);
                  expect(select).not.toHaveBeenCalled();
                } finally { select.mockRestore(); }
              }));
              yield* flushProtectedMetadataFinalGuards(tx);
            }).pipe(Effect.ensuring(Effect.sync(() => closeProtectedMetadataFinalGuardScope(tx))))));
            await pending;
            const next = required(await persistence.drizzle.transaction(tx => runEffect(
              readBindingCoverageSelectedEvidence(tx, selected.location))));
            expect(next.head.frame.sequence).toBe("2");
            expect(next.activation.frame.request.requestId).toBe("reuse_concurrent_activation");
          } finally { await runEffect(host.close); }
        } finally {
          await Promise.allSettled([pending]);
          await fixture.dispose();
        }
      }), 180_000,
    );
    it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
      "lends only pre-business guarded selections and revokes them on replacement, rollback and lease closure", async () => withOwner(async owner => {
        const fixture = await createProtectedFileScopedPostgresFixture("fullProof", owner);
        const persistence = fixture.persistence;
        try {
          const selected = await seed(persistence, 1, 1, "transaction_reuse");
          const epoch = await persistence.drizzle.transaction(tx => runEffect(
            captureProtectedMetadataEpoch(fixture.protectedMetadata, persistence.drizzle, tx)));
          const host = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
            const lifetime = yield* captureHostPreparationLifetime();
            if (lifetime === undefined) throw new Error("Missing selection lifetime");
            return Result.getOrThrow(prepareBindingSelectedStructure(selected.location,
              { token: fixture.protectedMetadata, database: persistence.drizzle, epoch }, lifetime));
          })));
          const prepared = await runEffect(host.use(value => Effect.succeed(value)));
          const guarded = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
            persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
              openProtectedMetadataFinalGuardScope(tx);
              const value = yield* work(tx);
              yield* flushProtectedMetadataFinalGuards(tx);
              return value;
            }).pipe(Effect.ensuring(Effect.sync(() => closeProtectedMetadataFinalGuardScope(tx))))));
          try {
            await guarded(tx => withBindingSelectionInTransaction(tx, selected.location, () => Effect.gen(function* () {
              closeBindingSelectionCaptureInTransaction(tx);
              yield* bindingStatement(tx.execute(sql`savepoint binding_reuse_late_capture`));
              yield* readBindingSelectedEvidence(tx, selected.location, prepared);
              yield* bindingStatement(tx.execute(sql`rollback to savepoint binding_reuse_late_capture`));
              yield* bindingStatement(tx.execute(sql`release savepoint binding_reuse_late_capture`));
              const select = vi.spyOn(tx, "select");
              try {
                yield* readBindingCoverageSelectedEvidence(tx, selected.location);
                expect(select).toHaveBeenCalledTimes(2);
              } finally { select.mockRestore(); }
            })));
            await guarded(tx =>
              withBindingSelectionInTransaction(tx, selected.location, () => Effect.gen(function* () {
                const first = required(yield* readBindingSelectedEvidence(tx, selected.location, prepared));
                closeBindingSelectionCaptureInTransaction(tx);
                const select = vi.spyOn(tx, "select");
                try {
                  for (let phase = 0; phase < 3; phase++)
                    expect(required(yield* readBindingCoverageSelectedEvidence(tx, selected.location))).toBe(first);
                  expect(select).not.toHaveBeenCalled();
                  expect(Option.isNone(yield* readBindingCoverageSelectedEvidence(tx,
                    { ...selected.location, scopeId: `${selected.location.scopeId}_missing` }))).toBe(true);
                  expect(select).toHaveBeenCalledTimes(1);
                } finally { select.mockRestore(); }
                yield* bindingStatement(tx.execute(sql`savepoint binding_reuse_business`));
                yield* writeBindingActivation(tx, dataBindingActivationRequest(selected.location.scopeId,
                  selected.location.storageGeneration, "transaction_reuse_replacement", first.candidate.sha256,
                  { sequence: first.head.frame.sequence, sha256: first.head.sha256 }), [],
                  { projection: null, owners: [], withdrawsPermission: false, maintenance: {
                    outgoing: { deploymentId: selected.frame.application.deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] },
                    incoming: { deploymentId: selected.frame.application.deploymentId, schemaVersionId: null, manifestSha256: null, indexes: [], unique: [] } } });
                expect(required(yield* readBindingCoverageSelectedEvidence(tx, selected.location)).head.frame.sequence).toBe("2");
                yield* bindingStatement(tx.execute(sql`rollback to savepoint binding_reuse_business`));
                yield* bindingStatement(tx.execute(sql`release savepoint binding_reuse_business`));
                const afterRollback = vi.spyOn(tx, "select");
                try {
                  expect(required(yield* readBindingCoverageSelectedEvidence(tx, selected.location)).head.frame.sequence).toBe("1");
                  expect(afterRollback).toHaveBeenCalledTimes(2);
                } finally { afterRollback.mockRestore(); }
              })));
            {
              await expect(guarded(tx => withBindingSelectionInTransaction(tx, selected.location, () =>
                readBindingSelectedEvidence(tx, selected.location, prepared).pipe(Effect.andThen(Effect.fail("rollback witness"))))))
                .rejects.toBeDefined();
              await guarded(tx => Effect.gen(function* () {
                // A new transaction must authenticate its head, even though the
                // prepared immutable candidate survived the previous rollback.
                const select = vi.spyOn(tx, "select");
                try {
                  expect(required(yield* readBindingCoverageSelectedEvidence(tx, selected.location)).head.frame.sequence).toBe("1");
                  expect(select).toHaveBeenCalledTimes(2);
                } finally { select.mockRestore(); }
              }));
              await guarded(tx => Effect.gen(function* () {
                const interrupted = yield* withBindingSelectionInTransaction(tx, selected.location, () =>
                  readBindingSelectedEvidence(tx, selected.location, prepared).pipe(Effect.andThen(Effect.interrupt))).pipe(Effect.exit);
                expect(Exit.isFailure(interrupted)).toBe(true);
                const select = vi.spyOn(tx, "select");
                try {
                  yield* readBindingCoverageSelectedEvidence(tx, selected.location);
                  expect(select).toHaveBeenCalledTimes(2);
                } finally { select.mockRestore(); }
              }));
            }
            await guarded(tx =>
              withBindingSelectionInTransaction(tx, selected.location, () => Effect.gen(function* () {
                yield* readBindingSelectedEvidence(tx, selected.location, prepared);
                closeBindingSelectionCaptureInTransaction(tx);
                yield* host.close;
                const select = vi.spyOn(tx, "select");
                try {
                  expect(yield* readBindingCoverageSelectedEvidence(tx, selected.location).pipe(Effect.result))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  expect(select).not.toHaveBeenCalled();
                } finally { select.mockRestore(); }
              })));
          } finally { await runEffect(host.close); }
        } finally { await fixture.dispose(); }
      }), 180_000,
    );
    it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
      "retains policy/reference growth once and refuses invalid preparation, head and lease", async () => withOwner(async owner => {
        // Full-proof restricted-login fixture isolates repository authentication.
        // The connected mixed benchmark covers the managed installation profile.
        const fixture = await createProtectedFileScopedPostgresFixture("fullProof", owner);
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
            const unboundedDonor = Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, undefined));
            const unboundedRecipient = Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, undefined));
            const host = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
              const lifetime = yield* captureHostPreparationLifetime();
              if (lifetime === undefined) throw new Error("Missing donor fixture preparation lifetime");
              return { lifetime, prepared: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)),
                prelude: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)),
                empty: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)),
                unopened: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)) };
            })));
            const recipient = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
              const lifetime = yield* captureHostPreparationLifetime();
              return {
                prepared: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)),
                empty: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)),
                otherLocation: Result.getOrThrow(prepareBindingSelectedStructure({ ...selected.location, scopeId: `${selected.location.scopeId}_other` }, protection, lifetime)),
                otherStorage: Result.getOrThrow(prepareBindingSelectedStructure({ ...selected.location, storageGeneration: "other" }, protection, lifetime)),
                otherToken: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, { ...protection, token: new Proxy(protection.token, {}) }, lifetime)),
                otherDatabase: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, { ...protection, database: new Proxy(protection.database, {}) }, lifetime)),
                otherEpoch: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, { ...protection, epoch: { ...epoch } }, lifetime)),
              };
            })));
            const tiny = await runEffect(Effect.gen(function* () {
              const scope = yield* Scope.make();
              const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1 }).pipe(Scope.provide(scope));
              const access = yield* retainPreparedHost(runtime, Effect.gen(function* () {
                const lifetime = yield* captureHostPreparationLifetime();
                if (lifetime === undefined) throw new Error("Missing bounded fixture preparation lifetime");
                return { lifetime, prepared: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)) };
              }));
              return { scope, access };
            }));
            const tokens = await runEffect(host.use(value => Effect.succeed(value)));
            const received = await runEffect(recipient.use(value => Effect.succeed(value)));
            const tinyPreparation = await runEffect(tiny.access.use(value => Effect.succeed(value)));
            const tinyToken = tinyPreparation.prepared;
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
                  const warm = vi.spyOn(tx, "select");
                  try {
                    const earlyHead = required(yield* readBindingHead(tx, selected.location, "none", tokens.prepared));
                    expect(required(yield* readPreparedBindingCandidate(tx, selected.location, earlyHead, tokens.prepared)))
                      .toBe(full.candidate);
                    // Immutable history is lent, but both original head cuts
                    // still execute their actual NONE and SHARE statements.
                    expect(warm).toHaveBeenCalledTimes(1);
                    const locked = required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared));
                    expect(warm).toHaveBeenCalledTimes(2);
                    expect(locked.head).not.toBe(earlyHead);
                    expect(locked.candidate).toBe(full.candidate);
                    expect(locked.activation).toBe(full.activation);
                    expect(Reflect.set(locked.activation.frame.strongReferences[0]?.targetIdentity ?? {}, "logicalTableName", "foreign"))
                      .toBe(false);
                  } finally { warm.mockRestore(); }
                  // CMS-style separate head and candidate observations issue
                  // the same complete private structure without another full
                  // activation/candidate load at the later selected frontier.
                  const early = required(yield* readBindingHead(tx, selected.location, "none", tokens.prelude));
                  const earlyCandidate = required(yield* readPreparedBindingCandidate(tx, selected.location, early, tokens.prelude));
                  const partial = vi.spyOn(tx, "select");
                  try {
                    const locked = required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prelude));
                    expect(partial).toHaveBeenCalledTimes(1);
                    expect(locked.candidate).toBe(earlyCandidate);
                    expect(locked.activation.frame).toEqual(full.activation.frame);
                  } finally { partial.mockRestore(); }
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
                    expect(tinyPreparation.lifetime.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
                    // Disposal revokes issuer membership before repository lease
                    // classification; escaped tokens are refused without SQL.
                    expect(retainBindingSelectedStructure(tx, tokens.prepared, tinyToken, head))
                      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                    const before = Result.getOrThrow(recipient.readUsage()).chargedBytes;
                    expect(Result.isSuccess(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, head))).toBe(true);
                    const retained = Result.getOrThrow(recipient.readUsage()).chargedBytes;
                    expect(retained).toBeGreaterThan(before);
                    expect(Result.isSuccess(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, head))).toBe(true);
                    expect(Result.getOrThrow(recipient.readUsage()).chargedBytes).toBe(retained);
                    expect(select).not.toHaveBeenCalled();
                  } finally { select.mockRestore(); }
                  expect(Reflect.set(full.candidate.frame.application.physicalLocator, "schemaName", "mutated-entry-result")).toBe(false);
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
                expect(Reflect.set(receivedEvidence.candidate.frame.application.physicalLocator, "schemaName", "mutated-recipient-result")).toBe(false);
                expect(required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, received.prepared)))
                  .candidate.frame).toEqual(selected.frame);
                const scopedRecipient = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle), Effect.gen(function* () {
                  const lifetime = yield* captureHostPreparationLifetime();
                  if (lifetime === undefined) throw new Error("Missing scoped recipient fixture preparation lifetime");
                  return { lifetime, prepared: Result.getOrThrow(prepareBindingSelectedStructure(selected.location, protection, lifetime)) };
                })));
                const scopedPreparation = await runEffect(scopedRecipient.use(value => Effect.succeed(value)));
                const scopedToken = scopedPreparation.prepared;
                try {
                  await guarded(tx => Effect.gen(function* () {
                    const donor = required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared));
                    yield* Effect.fromResult(retainBindingSelectedStructure(tx, tokens.prepared, scopedToken,
                      { sequence: donor.head.frame.sequence, sha256: donor.head.sha256 }));
                    const borrowed = required(yield* readBindingSelectedEvidence(tx, selected.location, scopedToken));
                    expect(borrowed.candidate.frame).toEqual(selected.frame);
                    expect(Reflect.set(borrowed.candidate.frame.application.physicalLocator, "schemaName", "mutated-borrowed-result")).toBe(false);
                    expect(required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared)).candidate.frame)
                      .toEqual(selected.frame);
                    yield* scopedRecipient.close;
                    expect(scopedPreparation.lifetime.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
                    const select = vi.spyOn(tx, "select");
                    try {
                      expect(yield* readBindingSelectedEvidence(tx, selected.location, scopedToken).pipe(Effect.result))
                        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                      expect(select).not.toHaveBeenCalled();
                    } finally { select.mockRestore(); }
                    expect(required(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared)).candidate.frame)
                      .toEqual(selected.frame);
                  }));
                } finally { await runEffect(scopedRecipient.close); }
                const usage = Result.getOrThrow(host.readUsage()).chargedBytes;
                chargedSizes.push(usage);
                const immutable = required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, tokens.prepared)));
                expect(immutable.candidate.frame).toEqual(selected.frame);
                expect(Reflect.set(immutable.candidate.frame.application.physicalLocator, "schemaName", "mutated-read-result")).toBe(false);
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
                expect(tokens.lifetime.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
                expect(required(await guarded(tx => readBindingSelectedEvidence(tx, selected.location, received.prepared)))
                  .candidate.frame).toEqual(selected.frame);
                if (checkedHead === undefined) throw new Error("Missing checked head after donor close");
                const head = checkedHead;
                await guarded(tx => Effect.sync(() => {
                  expect(retainBindingSelectedStructure(tx, tokens.prepared, received.prepared, head))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                }));
              }
              await guarded(tx => Effect.gen(function* () {
                const select = vi.spyOn(tx, "select");
                try {
                  expect(yield* readBindingSelectedEvidence(tx, selected.location, tokens.prepared).pipe(Effect.result))
                    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
                  expect(select).not.toHaveBeenCalled();
                } finally { select.mockRestore(); }
              }));
            } finally { await runEffect(recipient.close); }
          }
          expect(chargedSizes[1]).toBeGreaterThan(chargedSizes[0] ?? 0);
        } finally { await fixture.dispose(); }
      }), 180_000,
    );
  });
});
