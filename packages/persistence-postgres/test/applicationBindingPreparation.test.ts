import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Result, Tracer } from "effect";
import { expect, it } from "vitest";
import { StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { CommitSeqSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { prepareApplicationBindingSelection, claimApplicationExecutableActiveSelection, type ApplicationBindingPreparation } from "../src/applicationActivation";
import { readApplicationBindingPreparationInputs, readAcceptedApplicationBinding, withAcceptedApplicationBinding,
  type AcceptedApplicationBinding } from "../src/applicationActivation";
import { readCheckedApplicationActiveHead, type CheckedApplicationActiveHead } from "../src/applicationActiveHeadRead";
import { readAcceptedApplicationBindingProjection } from "../src/applicationBindingProjection";
import { readApplicationBindingProjectionInTransaction, withApplicationBindingEvidenceInTransaction } from "../src/applicationBindingProjection";
import { borrowIndexCoverageContextInTransaction, matchIndexCoverageContextInTransaction,
  readIndexCoverageContextInTransactionEffect, readIndexCoverageTableFrontiersInTransactionEffect,
  readPreparedIndexCoverageTableFrontiers, type IndexCoverageContext } from "../src/indexBuildStates";
import { fxSystemScopeClocks, fxSystemUniqueConstraintBuilds } from "../src/schema";
import { fxSystemApplicationReadiness } from "../src/applicationRelationSchema";
import { fxSystemApplicationActiveHeads } from "../src/applicationActivationSchema";
import { lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { cmsHostFixture } from "./cmsHostFixture";
import { prepareAdditionalRelationRevision } from "./applicationRelationReadinessFixture";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";
import { prepareCmsApplication } from "../src/cmsTransaction/admission";

async function exercise(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const schema = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schema === undefined) throw new Error("Missing fixture schema");
  const controlPersistence = "pool" in persistence ? persistence : await createMigratedPGlitePersistence();
  const base = await cmsHostFixture(persistence, { controlPersistence,
    physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName: schema } });
  const spans: string[] = [];
  const scopeId = base.fixture.authority.scopeId;
  const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
  const prepare = () => runEffect(prepareApplicationBindingSelection(base.fixture.relationActivation)
    .pipe(Effect.provideService(Tracer.Tracer, tracer)));
  const prepared = await prepare();
  expect(Result.isFailure(claimApplicationExecutableActiveSelection(prepared))).toBe(true);
  expect(spans).not.toContain("ApplicationRelationReadinessFold.validatePreparedInTransaction");
  expect(spans).not.toContain("ScopeClock.lockForShareInTransaction");
  expect(spans).toContain("AppUniqueConstraintSetBuild.prepareCatalog");
  expect(spans).not.toContain("AppUniqueConstraintSetBuild.acceptPreparedCatalog");
  expect(spans.filter(name => name === "ApplicationRelationBinding.locateManifestBinding")).toHaveLength(1);
  const accept = (input = prepared) => persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    return yield* readApplicationBindingProjectionInTransaction(input, tx, clock);
  }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
  expect(await accept()).toEqual(base.reference);
  expect(spans.filter(name => name === "ApplicationRelationReadinessFold.validatePreparedInTransaction")).toHaveLength(1);
  let escapedCoverage: IndexCoverageContext | undefined;
  for (const ending of ["success", "failure", "interruption"] as const) {
    await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      let checked: CheckedApplicationActiveHead | undefined;
      const beforeAdmission = spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length;
      const outcome = yield* Effect.exit(withApplicationBindingEvidenceInTransaction(prepared, tx, clock,
        evidence => Effect.gen(function* () {
          checked = evidence.checkedActive;
          if (checked === undefined) throw new Error("Expected checked active head");
          expect(evidence.projection).toEqual(base.reference);
          const observed = readCheckedApplicationActiveHead(checked, tx, clock);
          expect(Result.isSuccess(observed)).toBe(true);
          if (Result.isFailure(observed) || observed.success === "refresh") throw new Error("Expected active head");
          const originalByte = observed.success.head.headSha256[0];
          observed.success.head.headSha256[0] = (originalByte ?? 0) ^ 0xff;
          const detached = readCheckedApplicationActiveHead(checked, tx, clock);
          if (Result.isFailure(detached) || detached.success === "refresh") throw new Error("Expected detached head");
          expect(detached.success.head.headSha256[0]).toBe(originalByte);
          expect(Result.isFailure(readCheckedApplicationActiveHead(checked, { ...tx } as typeof tx, clock))).toBe(true);
          expect(Result.isFailure(readCheckedApplicationActiveHead(checked, tx, { ...clock,
            scopeId: ScopeIdSchema.make("scope_53000000-0000-0000-0000-000000000099") }))).toBe(true);
          expect(Result.isFailure(readCheckedApplicationActiveHead(checked, tx, { ...clock,
            storageGenerationFence: StorageGenerationFenceSchema.make(clock.storageGenerationFence + 1n) }))).toBe(true);
          if (clock.lastCommitSeq > 0n) expect(Result.isFailure(readCheckedApplicationActiveHead(checked, tx, { ...clock,
            lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq - 1n) }))).toBe(true);
          expect(readCheckedApplicationActiveHead(checked, tx, { ...clock,
            lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq + 1n) })).toEqual(Result.succeed("refresh"));
          // Wall-clock timestamps are not monotonic authority: committed
          // sequence progress still requires refresh even if updatedAt moves back.
          expect(readCheckedApplicationActiveHead(checked, tx, { ...clock,
            lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq + 1n),
            updatedAt: new Date(clock.updatedAt.getTime() - 1_000) })).toEqual(Result.succeed("refresh"));
          if (ending === "success") {
            const beforeCoverage = spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length;
            const first = yield* readIndexCoverageContextInTransactionEffect(tx, clock, checked);
            expect(spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length)
              .toBe(beforeCoverage);
            const beforeSecondSchema = spans.filter(name => name === "ApplicationActiveHead.readSchemaForHead").length;
            expect(beforeSecondSchema).toBeGreaterThan(0);
            const second = yield* readIndexCoverageContextInTransactionEffect(tx, clock, checked);
            expect(spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length)
              .toBe(beforeCoverage);
            expect(spans.filter(name => name === "ApplicationActiveHead.readSchemaForHead").length)
              .toBe(beforeSecondSchema);
            expect(Result.isSuccess(matchIndexCoverageContextInTransaction(tx, clock, first))).toBe(true);
            const borrowed = borrowIndexCoverageContextInTransaction(tx, clock, first);
            if (Result.isFailure(borrowed) || borrowed.success === null) throw new Error("Expected borrowed coverage");
            expect(borrowed.success).toEqual(second);
            escapedCoverage = first;
            if (first.active !== null && borrowed.success.active !== null) {
              const originalCoverageByte = borrowed.success.active.head.headSha256[0];
              first.active.head.headSha256[0] = (originalCoverageByte ?? 0) ^ 0xff;
              const detachedCoverage = borrowIndexCoverageContextInTransaction(tx, clock, first);
              if (Result.isFailure(detachedCoverage) || detachedCoverage.success?.active === null ||
                detachedCoverage.success === null) throw new Error("Expected detached coverage");
              expect(detachedCoverage.success.active.head.headSha256[0]).toBe(originalCoverageByte);
            }
            const tableId = CatalogTableIdSchema.make(1);
            yield* readIndexCoverageTableFrontiersInTransactionEffect(tx, first, [tableId]);
            const selectedFrontiers = readPreparedIndexCoverageTableFrontiers(tx, clock, first, [tableId]);
            if (Result.isFailure(selectedFrontiers) || !(selectedFrontiers.success instanceof Map))
              throw new Error("Expected selected frontier map");
            const originalFrontier = selectedFrontiers.success.get(tableId);
            selectedFrontiers.success.set(tableId, Result.succeed(777n));
            const detachedFrontiers = readPreparedIndexCoverageTableFrontiers(tx, clock, first, [tableId]);
            if (Result.isFailure(detachedFrontiers) || detachedFrontiers.success === null)
              throw new Error("Expected detached frontier map");
            expect(detachedFrontiers.success.get(tableId)).toEqual(originalFrontier);
            expect(readPreparedIndexCoverageTableFrontiers(tx, clock, first, [CatalogTableIdSchema.make(2)]))
              .toEqual(Result.succeed(null));
            expect(Result.isFailure(matchIndexCoverageContextInTransaction({ ...tx } as typeof tx, clock, first))).toBe(true);
            expect(Result.isFailure(matchIndexCoverageContextInTransaction(tx, { ...clock,
              storageGenerationFence: StorageGenerationFenceSchema.make(clock.storageGenerationFence + 1n) }, first))).toBe(true);
            expect(matchIndexCoverageContextInTransaction(tx, { ...clock,
              lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq + 1n) }, first)).toEqual(Result.succeed(false));
            expect(matchIndexCoverageContextInTransaction(tx, { ...clock,
              lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq + 1n),
              updatedAt: new Date(clock.updatedAt.getTime() - 1_000) }, first)).toEqual(Result.succeed(false));
            const beforeRefreshHead = spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length;
            const beforeRefreshSchema = spans.filter(name => name === "ApplicationActiveHead.readSchemaForHead").length;
            yield* readIndexCoverageContextInTransactionEffect(tx, { ...clock,
              lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq + 1n) }, checked);
            expect(spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length)
              .toBeGreaterThan(beforeRefreshHead);
            expect(spans.filter(name => name === "ApplicationActiveHead.readSchemaForHead").length)
              .toBeGreaterThan(beforeRefreshSchema);
          }
          if (ending === "failure") return yield* Effect.fail("expected refusal");
          if (ending === "interruption") return yield* Effect.interrupt;
        })));
      if (ending === "success" && outcome._tag === "Failure")
        throw new Error(`Checked evidence success branch failed: ${Cause.pretty(outcome.cause)}`);
      expect(outcome._tag).toBe(ending === "success" ? "Success" : "Failure");
      if (checked === undefined) throw new Error("Expected checked callback handle");
      expect(Result.isFailure(readCheckedApplicationActiveHead(checked, tx, clock))).toBe(true);
      expect(spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length)
        .toBeGreaterThan(beforeAdmission);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
  }
  if (escapedCoverage === undefined) throw new Error("Expected escaped coverage context");
  const staleCoverage = escapedCoverage;
  await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    expect(Result.isFailure(matchIndexCoverageContextInTransaction(tx, clock, staleCoverage))).toBe(true);
  })));
  const planning = await runEffect(readApplicationBindingPreparationInputs(prepared, base.fixture.control.drizzle));
  expect(planning.schema.schemaVersionId).toBe(base.reference.schemaVersionId);
  // A detached manifest cannot rewrite the prepared authority's input snapshot.
  const manifestVersion = planning.manifest.version;
  Object.assign(planning.manifest, { version: 0 });
  expect((await runEffect(readApplicationBindingPreparationInputs(prepared, base.fixture.control.drizzle))).manifest.version).toBe(manifestVersion);
  const cms = await runEffect(prepareCmsApplication(base.fixture.relationActivation, base.fixture.authorityPorts,
    base.fixture.control.drizzle, base.fixture.deploymentId, base.fixture.authority.scopeId));
  const assertFrozen = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    expect(Object.isFrozen(value)).toBe(true);
    for (const nested of Object.values(value)) assertFrozen(nested);
  };
  assertFrozen(cms.configuration);
  expect(() => Object.assign(cms.configuration, { profile: "changed" })).toThrow(TypeError);
  const otherPreparation = await prepare();
  let escaped: AcceptedApplicationBinding | undefined;
  await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    for (const ending of ["success", "failure", "interruption"] as const) {
      const before = spans.filter(name => name === "ApplicationRelationReadinessFold.validatePreparedInTransaction").length;
      const result = yield* Effect.exit(withAcceptedApplicationBinding(prepared, tx, clock, binding => Effect.gen(function* () {
        escaped = binding;
        expect(Result.isFailure(claimApplicationExecutableActiveSelection(binding))).toBe(true);
        expect(yield* readAcceptedApplicationBindingProjection(binding, tx, clock)).toEqual(base.reference);
        expect(yield* readAcceptedApplicationBindingProjection(binding, tx, clock)).toEqual(base.reference);
        expect(yield* withAcceptedApplicationBinding(prepared, tx, clock,
          borrowed => readAcceptedApplicationBindingProjection(borrowed, tx, clock), binding)).toEqual(base.reference);
        expect(yield* Effect.flip(withAcceptedApplicationBinding(otherPreparation, tx, clock,
          () => Effect.void, binding))).toMatchObject({ reason: "invalidComposition" });
        expect(Result.isSuccess(readAcceptedApplicationBinding(binding, tx, clock))).toBe(true);
        // SAFETY: a lookalike transaction must not satisfy exact accepting identity.
        expect(Result.isFailure(readAcceptedApplicationBinding(binding, { ...tx } as typeof tx, clock))).toBe(true);
        expect(Result.isFailure(readAcceptedApplicationBinding(binding, tx, { ...clock,
          storageGenerationFence: StorageGenerationFenceSchema.make(clock.storageGenerationFence + 1n) }))).toBe(true);
        if (ending === "failure") return yield* Effect.fail("expected refusal");
        if (ending === "interruption") return yield* Effect.interrupt;
      })));
      expect(result._tag).toBe(ending === "success" ? "Success" : "Failure");
      if (escaped === undefined) throw new Error("Missing accepted fixture");
      expect(Result.isFailure(readAcceptedApplicationBinding(escaped, tx, clock))).toBe(true);
      expect(spans.filter(name => name === "ApplicationRelationReadinessFold.validatePreparedInTransaction").length - before).toBe(1);
    }
  }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
  // SAFETY: intentionally forged nominal input tests the registry refusal boundary.
  await expect(accept({} as ApplicationBindingPreparation)).rejects.toMatchObject({ reason: "invalidComposition" });
  await expect(persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
    return yield* readApplicationBindingProjectionInTransaction(prepared, tx, { ...clock, storageGenerationFence: StorageGenerationFenceSchema.make(clock.storageGenerationFence + 1n) });
  })))).rejects.toMatchObject({ reason: "scopeAuthority" });

  // Planning owns definitions; accepting authority must observe the current build.
  const buildWhere = eq(fxSystemUniqueConstraintBuilds.scopeId, scopeId);
  const builds = await persistence.drizzle.select().from(fxSystemUniqueConstraintBuilds).where(buildWhere);
  expect(builds.length).toBeGreaterThan(0);
  await persistence.drizzle.delete(fxSystemUniqueConstraintBuilds).where(buildWhere);
  try {
    const missingBuildPlan = await prepare();
    await expect(accept(missingBuildPlan)).rejects.toMatchObject({ reason: "authorityChanged" });
    await expect(accept(prepared)).rejects.toMatchObject({ reason: "authorityChanged" });
  } finally { await persistence.drizzle.insert(fxSystemUniqueConstraintBuilds).values(builds); }
  await persistence.drizzle.update(fxSystemUniqueConstraintBuilds).set({ lifecycle: "declared",
    coveredThroughCommitSeq: null, maintenanceActivationSequence: null, maintenanceBytes: null,
    maintenanceSha256: null }).where(buildWhere);
  try {
    await expect(accept(await prepare())).rejects.toMatchObject({ reason: "authorityChanged" });
  } finally {
    await persistence.drizzle.delete(fxSystemUniqueConstraintBuilds).where(buildWhere);
    await persistence.drizzle.insert(fxSystemUniqueConstraintBuilds).values(builds);
  }
  expect(await accept(prepared)).toEqual(base.reference);

  const readinessWhere = eq(fxSystemApplicationReadiness.scopeId, scopeId);
  const original = (await persistence.drizzle.select().from(fxSystemApplicationReadiness).where(readinessWhere))[0];
  if (original === undefined) throw new Error("Missing readiness fixture");
  const corrupt = Uint8Array.from(original.readinessBytes); corrupt[0] = 32;
  await persistence.drizzle.update(fxSystemApplicationReadiness).set({ readinessBytes: corrupt }).where(readinessWhere);
  await expect(accept()).rejects.toMatchObject({ _tag: "ApplicationRelationReadinessFoldError", reason: "storedState" });
  await persistence.drizzle.update(fxSystemApplicationReadiness).set({ readinessBytes: original.readinessBytes }).where(readinessWhere);
  expect(await accept()).toEqual(base.reference);

  const headWhere = eq(fxSystemApplicationActiveHeads.scopeId, scopeId);
  const heads = await persistence.drizzle.select().from(fxSystemApplicationActiveHeads).where(headWhere);
  await persistence.drizzle.delete(fxSystemApplicationActiveHeads).where(headWhere);
  try { await expect(accept()).rejects.toMatchObject({ reason: "concurrentHead" }); }
  finally { await persistence.drizzle.insert(fxSystemApplicationActiveHeads).values(heads); }
  expect(await accept(await prepare())).toEqual(base.reference);

  if ("pool" in persistence) {
    const clockWhere = eq(fxSystemScopeClocks.scopeId, scopeId);
    const originalClock = (await persistence.drizzle.select().from(fxSystemScopeClocks).where(clockWhere))[0];
    if (originalClock === undefined) throw new Error("Missing controlled scope clock");
    try {
      // Controlled clock progress, not a full publication: KEY SHARE permits
      // a separate NO KEY UPDATE writer under PostgreSQL READ COMMITTED.
      await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
        yield* withApplicationBindingEvidenceInTransaction(prepared, tx, clock, evidence => Effect.gen(function* () {
          const checked = evidence.checkedActive;
          if (checked === undefined) throw new Error("Missing checked active head");
          const first = yield* readIndexCoverageContextInTransactionEffect(tx, clock, checked);
          const tableId = CatalogTableIdSchema.make(1);
          yield* readIndexCoverageTableFrontiersInTransactionEffect(tx, first, [tableId]);
          yield* Effect.promise(() => persistence.drizzle.transaction(async writer => {
            await writer.execute(sql`set local lock_timeout = '2s'`);
            await writer.update(fxSystemScopeClocks).set({
              lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq + 1n),
              updatedAt: new Date(clock.updatedAt.getTime() - 1_000),
            }).where(clockWhere);
          }));
          const advanced = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
          expect(advanced.lastCommitSeq).toBe(clock.lastCommitSeq + 1n);
          expect(matchIndexCoverageContextInTransaction(tx, advanced, first)).toEqual(Result.succeed(false));
          expect(readPreparedIndexCoverageTableFrontiers(tx, advanced, first, [tableId]))
            .toEqual(Result.succeed(null));
          const beforeHead = spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length;
          const beforeSchema = spans.filter(name => name === "ApplicationActiveHead.readSchemaForHead").length;
          yield* readIndexCoverageContextInTransactionEffect(tx, advanced, checked);
          expect(spans.filter(name => name === "ApplicationActiveHead.readCoherentForShareInTransaction").length)
            .toBeGreaterThan(beforeHead);
          expect(spans.filter(name => name === "ApplicationActiveHead.readSchemaForHead").length)
            .toBeGreaterThan(beforeSchema);
        }));
      }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    } finally {
      await persistence.drizzle.update(fxSystemScopeClocks).set({
        lastCommitSeq: originalClock.lastCommitSeq,
        updatedAt: originalClock.updatedAt,
      }).where(clockWhere);
    }
    const client = await persistence.pool.connect();
    const update = "update fx_system_application_active_head set activation_sequence = activation_sequence where scope_id = $1";
    try {
      await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
        yield* readApplicationBindingProjectionInTransaction(prepared, tx, clock);
        yield* Effect.promise(async () => {
          await client.query("begin");
          try { await client.query("set local lock_timeout = '100ms'"); await expect(client.query(update, [base.reference.scopeId])).rejects.toMatchObject({ code: "55P03" }); }
          finally { await client.query("rollback"); }
        });
      })));
      expect((await client.query(update, [base.reference.scopeId])).rowCount).toBe(1);
    } finally { client.release(); }
  }
  const active = await runEffect(base.fixture.relationActivation.readActive());
  const next = await prepareAdditionalRelationRevision(base.fixture);
  await runEffect(base.fixture.relationActivation.activate({
    revisionId: next.readiness.revisionId, expectedActiveHead: active.expectedActiveHead,
  }));
  await expect(accept(prepared)).rejects.toMatchObject({ reason: "concurrentHead" });
  expect((await accept(await prepare())).revisionId).toBe(next.readiness.revisionId);
}

it("prepares inputs without readiness authority and validates once under accepting locks in PGlite", async () => {
  await exercise(await createMigratedPGlitePersistence());
}, 240_000);
it.skipIf(postgresUrl === null)("retains fresh readiness/head refusal and accepting lock lifetime on PostgreSQL", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try { await exercise(fixture.persistence); } finally { await fixture.dispose(); }
}, 240_000);
