import { Cause, Deferred, Effect, Exit, Fiber, Result, Tracer } from "effect";
import { expect, it } from "vitest";
import {
  isPreparedApplicationBinding,
  readApplicationBindingTargetProtection,
} from "../../src/application/activation/selectionIdentity";
import {
  prepareCurrentApplicationBinding,
} from "../../src/application/activation/currentBinding";
import {
  type ApplicationBindingInput,
  type CurrentApplicationPreparationRefresh,
} from "../../src/application/activation/contracts";
import {
  type CurrentApplicationPreparationFailure,
} from "../../src/application/activation/errors";
import {
  captureApplicationReadinessInTransaction,
  prepareCapturedApplicationReadiness,
} from "../../src/application/readiness/preparation";
import {
  withStoredApplicationReadinessForBindingInTransaction,
} from "../../src/application/readiness/acceptance";
import { prepareInstalledPairAuthority } from "../../src/scope/scopeAuthorityControlRead";
import { runDrizzleStatementEffect } from "../../src/database/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import {
  withApplicationBindingEvidenceInTransaction,
} from "../../src/application/applicationBindingProjection";
import { makeApplicationAnalysisRepository } from "../../src/application/applicationAnalysisRegistration";
import {
  getCoLocatedReadInstallationReferencesResult,
  isManagedInstallationTransaction,
} from "../../src/installation/installationLifecycle";
import { prepareProtectedMetadata, hasProtectedMetadataFinalGuardScope,
  openProtectedMetadataFinalGuardScope } from "../../src/execution/preparation/preparedMetadataEpoch";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../../src/database/postgres";
import { withInstallationMaintenance } from "../../src/database/postgresInstallationMaintenance";
import { retainPreparedHost } from "../../src/execution/preparation/preparedHostRuntime";
import {
  makePostgresRelationalSession,
  runRelationalSession,
} from "../../src/database/relationalTransaction/session";
import {
  lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  exactScopeWriteClockObservationIdentity,
  readExactScopeWriteClockObservation,
  requireScopeAuthorizationRevocationEpochInTransactionEffect,
} from "../../src/scope/scopeClock";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { isLocatedReadCommittedAttemptTargetV1 } from "../../src/execution/transactionSessionAttemptKernel";
import {
  createApplicationNativeMutationPGliteFixtureWithPersistence,
  createApplicationNativeMutationPostgresFixture,
} from "./applicationNativeMutationTestFixture";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import {
  createActivationServingFileScopedPostgresFixture,
  createCoLocatedReadInstallationFixture,
  createFileScopedPostgresFixture,
  createProtectedFileScopedPostgresFixture,
  postgresUrl,
} from "../support/postgresHelpers";
import { preparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { runEffect } from "../support/effectTestRuntime";
import { prepareActivatedCoverageProof } from "../commit/publicationActivatedCoverageProof";
import { runEffectTransaction } from "../../src/database/effectTransaction";
import { ExecutionDiagnostics } from "../../src/execution/diagnostics/operation";
import {
  readCheckedApplicationActiveHead,
} from "../../src/application/activeHead/identity";
import { eq, sql } from "drizzle-orm";
import { fxControlScopes, fxControlSchemaVersions, fxControlIndexDefinitions,
  fxControlSchemaVersionUniqueConstraintSets } from "../../src/database/schema";

const verifyUpdateClockObservation = (tx: FlarexMetadataTransaction, scopeId: ScopeId) => Effect.gen(function* () {
  yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId);
  expect(readExactScopeWriteClockObservation(tx, scopeId)).toBeUndefined();
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
  const first = exactScopeWriteClockObservationIdentity(tx, scopeId);
  expect(typeof first).toBe("symbol");
  expect(readExactScopeWriteClockObservation(tx, scopeId)).toEqual(clock);
  const before = yield* requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId);
  const changed = yield* advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId);
  expect(changed.previous).toBe(before);
  expect(changed.current).toBe(before + 1n);
  expect(exactScopeWriteClockObservationIdentity(tx, scopeId)).toBeUndefined();
  expect(readExactScopeWriteClockObservation(tx, scopeId)).toBeUndefined();
  yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
  const next = exactScopeWriteClockObservationIdentity(tx, scopeId);
  expect(typeof next).toBe("symbol");
  expect(next).not.toBe(first);
  expect(yield* requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId)).toBe(changed.current);
  return yield* Effect.fail(new Error("Clock observation witness rollback"));
});

it("retains fullProof construction while proving every actual command afresh", async () => {
  const control = await createMigratedPGlitePersistence();
  const target = await createMigratedPGlitePersistence();
  const application = await createApplicationNativeMutationPGliteFixtureWithPersistence({
    runtimeHostIdentity: "flarex.test/current-full-proof", compatibilityDate: "2026-09-28",
  }, { control, target });
  let constructions = 0;
  const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(target.drizzle),
    prepareCurrentApplicationBinding(application.activation, target.drizzle, () => Effect.sync(() => { constructions++; }), {})));
  try {
    const accept = (binding: ApplicationBindingInput) => target.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, application.authority.scopeId);
      return yield* withApplicationBindingEvidenceInTransaction(binding, tx, clock, () => Effect.succeed("accepted"));
    })));
    const clockModes: string[] = [];
    let businessCalls = 0;
    const clockTracer = Tracer.make({ span(options) {
      if (["ScopeClock.lockForSnapshotRead", "ScopeClock.lockForOrdinaryWrite", "ScopeClock.lockForUpdateInTransaction"].includes(options.name))
        clockModes.push(options.name);
      return new Tracer.NativeSpan(options);
    } });
    const commandEffect = (clockAccess: "snapshotRead" | "ordinaryWrite" | "update" = "snapshotRead") => retained.use(slot => slot.withEntry(({ binding }, enter) =>
      runEffectTransaction<Result.Result<ApplicationBindingInput, CurrentApplicationPreparationRefresh>,
        CurrentApplicationPreparationFailure, Error, FlarexMetadataTransaction>(work => target.drizzle.transaction(work), "Current full proof rollback", tx =>
        enter(tx, Effect.void, Effect.sync(() => { clockModes.length = 0; }), ({ clock, checked }) => Effect.gen(function* () {
          expect(clockModes).toEqual([clockAccess === "update" ? "ScopeClock.lockForUpdateInTransaction" :
            clockAccess === "ordinaryWrite" ? "ScopeClock.lockForOrdinaryWrite" : "ScopeClock.lockForSnapshotRead"]);
          // The sole entry's head-only loan cannot promise coherent acceptance.
          const beforeAcceptance = readCheckedApplicationActiveHead(checked, tx, clock);
          expect(Result.isFailure(beforeAcceptance)).toBe(true);
          return yield* withApplicationBindingEvidenceInTransaction(binding, tx, clock,
            () => Effect.sync(() => {
              businessCalls++;
              expect(Result.isSuccess(readCheckedApplicationActiveHead(checked, tx, clock))).toBe(true);
              expect(isPreparedApplicationBinding(binding)).toBe(true);
              return binding;
            }), checked);
        }), clockAccess),
        cause => new Error("Current full proof transaction failed", { cause })))).pipe(Effect.provideService(Tracer.Tracer, clockTracer));
    const command = (clockAccess: "snapshotRead" | "ordinaryWrite" | "update" = "snapshotRead") => runEffect(commandEffect(clockAccess));
    const first = await command();
    expect(isPreparedApplicationBinding(first)).toBe(true);
    const generationBytes = Result.getOrThrow(retained.readUsage()).chargedBytes;
    expect(generationBytes).toBeGreaterThan(0);
    // An unchanged authentic head does not make unprotected catalog contents
    // immutable. Corruption must refuse before business, then restoration may
    // reuse the exact original construction after complete fresh validation.
    const schema = (await control.drizzle.select().from(fxControlSchemaVersions).limit(1))[0];
    if (schema === undefined) throw new Error("Missing original fullProof schema");
    const index = (await control.drizzle.select().from(fxControlIndexDefinitions).limit(1))[0];
    if (index === undefined) throw new Error("Missing original fullProof index definition");
    const beforeCorruption = businessCalls;
    await control.drizzle.update(fxControlSchemaVersions).set({
      manifestJson: sql`jsonb_set(${fxControlSchemaVersions.manifestJson}, '{retained_proof_corruption}', 'true'::jsonb)`,
    }).where(eq(fxControlSchemaVersions.schemaVersionId, schema.schemaVersionId));
    await control.drizzle.update(fxControlIndexDefinitions).set({
      physicalSpecBytes: sql`set_byte(${fxControlIndexDefinitions.physicalSpecBytes}, 0,
        (get_byte(${fxControlIndexDefinitions.physicalSpecBytes}, 0) + 1) % 256)`,
    }).where(eq(fxControlIndexDefinitions.indexDefinitionId, index.indexDefinitionId));
    try {
      // Published schema refusal remains earlier than malformed physical
      // definitions when both facts are corrupt under the same original head.
      expect(await runEffect(Effect.result(commandEffect()))).toMatchObject({
        _tag: "Failure", failure: { reason: "schemaBinding" },
      });
      expect(businessCalls).toBe(beforeCorruption);
      expect(constructions).toBe(1);
      await control.drizzle.update(fxControlSchemaVersions).set({ manifestJson: schema.manifestJson })
        .where(eq(fxControlSchemaVersions.schemaVersionId, schema.schemaVersionId));
      expect(await runEffect(Effect.result(commandEffect()))).toMatchObject({
        _tag: "Failure", failure: { _tag: "AppIndexDefinitionCatalogCorruptionError" },
      });
      expect(businessCalls).toBe(beforeCorruption);
      expect(constructions).toBe(1);
    } finally {
      await control.drizzle.update(fxControlSchemaVersions).set({ manifestJson: schema.manifestJson })
        .where(eq(fxControlSchemaVersions.schemaVersionId, schema.schemaVersionId));
      await control.drizzle.update(fxControlIndexDefinitions).set({ physicalSpecBytes: index.physicalSpecBytes })
        .where(eq(fxControlIndexDefinitions.indexDefinitionId, index.indexDefinitionId));
    }
    const uniqueSet = (await control.drizzle.select().from(fxControlSchemaVersionUniqueConstraintSets)
      .where(eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, schema.schemaVersionId)).limit(1))[0];
    if (uniqueSet === undefined) throw new Error("Missing original fullProof unique closure");
    await control.drizzle.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionSetSha256: new Uint8Array(32) })
      .where(eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, schema.schemaVersionId));
    try {
      expect(await runEffect(Effect.result(commandEffect()))).toMatchObject({
        _tag: "Failure", failure: { _tag: "AppUniqueConstraintSetClosureCorruptionV1Error" },
      });
      expect(businessCalls).toBe(beforeCorruption);
      expect(constructions).toBe(1);
    } finally {
      await control.drizzle.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionSetSha256: uniqueSet.definitionSetSha256 })
        .where(eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, schema.schemaVersionId));
    }
    const second = await command("ordinaryWrite");
    expect(second).toBe(first);
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(generationBytes);
    expect(constructions).toBe(1);
    await application.moveHead();
    const fresh = await command("update");
    expect(fresh).not.toBe(second);
    expect(isPreparedApplicationBinding(fresh)).toBe(true);
    expect(isPreparedApplicationBinding(first)).toBe(false);
    await expect(accept(first)).rejects.toMatchObject({ reason: "invalidComposition" });
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBeGreaterThan(0);
    expect(constructions).toBe(2);
    await expect(target.drizzle.transaction(tx => runEffect(verifyUpdateClockObservation(tx, application.authority.scopeId))))
      .rejects.toThrow("Clock observation witness rollback");
    const defect = new Error("Original ordinary-entry defect");
    const mixed = Cause.combine(Cause.fail("original typed refusal"), Cause.die(defect));
    const failed = await runEffect(Effect.exit(retained.use(slot => slot.withEntry(() => Effect.failCause(mixed)))));
    if (Exit.isSuccess(failed)) throw new Error("Expected the original mixed Cause");
    expect(failed.cause).toBe(mixed);
    expect(constructions).toBe(2);
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBeGreaterThan(0);
    const order: string[] = [];
    const diagnostics = { observe: <A, E, R>(name: string, work: Effect.Effect<A, E, R>) =>
      name === "ApplicationActivation.observeCurrentPreparation" ? Effect.sync(() => { order.push("clock/head"); }).pipe(Effect.andThen(work)) : work };
    let planningConstructions = 0;
    const planning = await runEffect(retainPreparedHost(preparedHostTestRuntime(target.drizzle),
      prepareCurrentApplicationBinding(application.activation, target.drizzle, () => Effect.sync(() => { planningConstructions++; }),
        { candidateIssuer: application.sessionAuthority })));
    try {
      let movedPlanning = false;
      let callbacks = 0;
      const actual = await runEffect(planning.use(slot => slot.withEntry(({ binding }, enter) => {
        const moveBeforeEntry = movedPlanning ? Effect.void : Effect.gen(function* () {
          movedPlanning = true;
          // Valid planning progress independent of the active Application head.
          // Its exact decoded timestamp is part of the original candidate identity.
          yield* Effect.tryPromise({ try: () => target.drizzle.execute(sql`update fx_system_app_schema_candidate_validation
            set updated_at = updated_at + interval '1 second' where scope_id = ${application.authority.scopeId}`),
          catch: cause => new Error("Could not move genuine candidate planning identity", { cause }) });
        });
        return moveBeforeEntry.pipe(Effect.andThen(runEffectTransaction<Result.Result<ApplicationBindingInput, CurrentApplicationPreparationRefresh>,
          CurrentApplicationPreparationFailure, Error, FlarexMetadataTransaction>(work => target.drizzle.transaction(work), "Candidate entry rollback", tx =>
          enter(tx, Effect.void, Effect.sync(() => { order.push("settings/request"); }), ({ clock, checked }) =>
            withApplicationBindingEvidenceInTransaction(binding, tx, clock, () => Effect.sync(() => { callbacks++; return binding; }), checked)),
          cause => new Error("Candidate entry transaction failed", { cause }))));
      })).pipe(Effect.provideService(ExecutionDiagnostics, diagnostics)));
      expect(isPreparedApplicationBinding(actual)).toBe(true);
      expect(planningConstructions).toBe(2);
      expect(callbacks).toBe(1);
      // Each actual entry preserves setup/request exclusion before its sole
      // clock/head probe, including the entry that requested a drained refresh.
      expect(order.filter(value => value === "settings/request")).toHaveLength(2);
      for (let index = 0; index < order.length; index++) {
        if (order[index] === "settings/request") expect(order[index + 1]).toBe("clock/head");
      }
      const planningBytes = Result.getOrThrow(planning.readUsage()).chargedBytes;
      expect(planningBytes).toBeGreaterThan(0);
      const originalScope = await application.authorityPorts.scopeMetadata.getScopeMetadata(application.authority.scopeId);
      if (originalScope === null) throw new Error("Missing genuine control placement");
      let entryStages = 0;
      let refreshedEntries = 0;
      let movedForAuthority = false;
      let authorityCallbacks = 0;
      const stageTracer = Tracer.make({ span(options) {
        if (options.name === "ApplicationActivation.prepareLegacyBinding") entryStages++;
        return new Tracer.NativeSpan(options);
      } });
      const wrongPlacement = planning.use(slot => slot.withEntry((_graph, enter) => Effect.gen(function* () {
        if (!movedForAuthority) {
          movedForAuthority = true;
          yield* Effect.tryPromise({ try: () => target.drizzle.execute(sql`update fx_system_app_schema_candidate_validation
            set updated_at = updated_at + interval '1 second' where scope_id = ${application.authority.scopeId}`),
          catch: cause => new Error("Could not request the genuine planning refresh", { cause }) });
        }
        const result = yield* runEffectTransaction<Result.Result<void, CurrentApplicationPreparationRefresh>,
          CurrentApplicationPreparationFailure, Error, FlarexMetadataTransaction>(work => target.drizzle.transaction(work), "Authority refresh rollback", tx =>
          enter(tx, Effect.void, Effect.void, () => Effect.sync(() => { authorityCallbacks++; })),
          cause => new Error("Authority refresh transaction failed", { cause }));
        if (Result.isFailure(result)) {
          refreshedEntries++;
          // The accepting target transaction has drained. Move genuine control
          // placement before the next entry rather than forge a resolved target.
          yield* Effect.tryPromise({ try: () => control.drizzle.update(fxControlScopes).set({
            physicalLocator: { ...originalScope.physicalLocator, schemaName: "moved_full_proof_target" },
          }).where(eq(fxControlScopes.scopeId, application.authority.scopeId)),
          catch: cause => new Error("Could not move genuine control placement", { cause }) });
        }
        return result;
      })));
      try {
        await expect(runEffect(wrongPlacement.pipe(Effect.provideService(Tracer.Tracer, stageTracer)))).rejects.toMatchObject({
          failure: { reason: "splitProvisioningReceiptPlacementMismatch" },
        });
        expect(refreshedEntries).toBe(1);
        expect(authorityCallbacks).toBe(0);
        // The second entry must resolve authority before starting replacement
        // preparation, and cannot reinterpret that refusal as another refresh.
        expect(entryStages).toBe(0);
        expect(planningConstructions).toBe(2);
        expect(Result.getOrThrow(planning.readUsage()).chargedBytes).toBe(planningBytes);
      } finally {
        await control.drizzle.update(fxControlScopes).set({ physicalLocator: originalScope.physicalLocator })
          .where(eq(fxControlScopes.scopeId, application.authority.scopeId));
      }
    } finally { await runEffect(planning.close); }
    await runEffect(retained.close);
    expect(isPreparedApplicationBinding(fresh)).toBe(false);
    expect(Result.isFailure(retained.readUsage())).toBe(true);
  } finally { await runEffect(retained.close); }
}, 180_000);

it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "uses the original managed guard for activated publication after candidate failure", async () => {
    const controlOwner = await createFileScopedPostgresFixture();
    try {
      const control = await createProtectedFileScopedPostgresFixture("managed", controlOwner);
      try {
        const dual = await createActivationServingFileScopedPostgresFixture();
        try {
          const target = dual.serving;
          const pair = await createCoLocatedReadInstallationFixture({ target, control, controlOwner });
          const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, target.persistence.drizzle));
          const controlProtection = await runEffect(prepareProtectedMetadata(target.persistence.drizzle, refs.controlInstallation));
          const physicalLocator = { kind: "database_per_scope", databaseKey: "protected-publication-coverage", schemaName: target.schemaName } as const;
          const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(dual.activation.persistence,
            physicalLocator, { directInstallation: dual.activation.installation });
          if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) throw new Error("Missing genuine activation writer");
          const application = await createApplicationNativeMutationPostgresFixture({
            runtimeHostIdentity: "flarex.test/protected-publication-coverage", compatibilityDate: "2026-09-28", physicalLocator,
            activationProfile: { kind: "installed", installation: dual.pair, target: activationTarget },
            managedInstallation: { installation: pair.installation, controlProtection },
            protectedMetadata: { database: target.persistence.drizzle, token: target.protectedMetadata },
          }, { control: control.persistence, target: target.persistence });
          const proof = await prepareActivatedCoverageProof(application);
          const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(target.persistence.drizzle),
            prepareCurrentApplicationBinding(application.activation, target.persistence.drizzle, () => Effect.void,
              { installation: pair.installation })));
          try {
            const session = makePostgresRelationalSession(target.persistence, undefined,
              { kind: "managed", installation: target.installation, coLocated: pair.installation });
            const transact = (work: (tx: FlarexMetadataTransaction) => Promise<void>) => runEffect(retained.use(slot =>
              slot.withEntry(({ binding }, enter) => runRelationalSession(session, "command", {
                enter: (tx, installation) => enter(tx, installation, Effect.void, ({ clock, checked }) =>
                  withApplicationBindingEvidenceInTransaction(binding, tx, clock, () => Effect.tryPromise({
                    try: () => work(tx), catch: cause => cause instanceof Error ? cause : new Error("Protected publication proof failed", { cause }),
                  }), checked), "ordinaryWrite"),
              }))).pipe(Effect.asVoid));
            await proof({ transact });
          } finally { await runEffect(retained.close); }
        } finally { await dual.dispose(); }
      } finally { await control.dispose(); }
    } finally { await controlOwner.dispose(); }
  }, 180_000);

it.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "retains original current graphs and drains retired real borrowers", async () => {
    const controlOwner = await createFileScopedPostgresFixture();
    try {
      const control = await createProtectedFileScopedPostgresFixture("managed", controlOwner);
      try {
        const dual = await createActivationServingFileScopedPostgresFixture();
        try {
          const target = dual.serving;
          const pair = await createCoLocatedReadInstallationFixture({ target, control, controlOwner });
          const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, target.persistence.drizzle));
          const controlProtection = await runEffect(prepareProtectedMetadata(target.persistence.drizzle, refs.controlInstallation));
          const physicalLocator = { kind: "database_per_scope", databaseKey: "current-preparation", schemaName: target.schemaName } as const;
          const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(dual.activation.persistence,
            physicalLocator, { directInstallation: dual.activation.installation });
          if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) throw new Error("Missing genuine activation writer");
          const application = await createApplicationNativeMutationPostgresFixture({
            runtimeHostIdentity: "flarex.test/current-managed", compatibilityDate: "2026-09-28", physicalLocator,
            activationProfile: { kind: "installed", installation: dual.pair, target: activationTarget },
            managedInstallation: { installation: pair.installation, controlProtection },
            protectedMetadata: { database: target.persistence.drizzle, token: target.protectedMetadata },
          }, { control: control.persistence, target: target.persistence });
          const spans: string[] = [];
          let interruptReplacement: (() => void) | undefined;
          const tracer = Tracer.make({ span(options) {
            spans.push(options.name);
            if (options.name === "ApplicationActivation.currentBindingSchema") interruptReplacement?.();
            return new Tracer.NativeSpan(options);
          } });
          const diagnostics = { observe: <A, E, R>(name: string, work: Effect.Effect<A, E, R>) => work.pipe(Effect.withSpan(name)) };
          const run = <A, E>(work: Effect.Effect<A, E>) => runEffect(work.pipe(Effect.provideService(Tracer.Tracer, tracer),
            Effect.provideService(ExecutionDiagnostics, diagnostics)));
          const retained = await run(retainPreparedHost(preparedHostTestRuntime(target.persistence.drizzle),
            prepareCurrentApplicationBinding(application.activation, target.persistence.drizzle, () => Effect.void, { installation: pair.installation })));
          let borrowerRelease: Deferred.Deferred<void> | undefined;
          try {
            const session = makePostgresRelationalSession(target.persistence, undefined,
              { kind: "managed", installation: target.installation, coLocated: pair.installation });
            let businessCalls = 0;
            const business = () => retained.use(slot => slot.withEntry(({ binding }, enter) => runRelationalSession(session, "command", {
              enter: (tx, installation) => enter(tx, installation, Effect.void, ({ clock, checked }) =>
                withApplicationBindingEvidenceInTransaction(binding, tx, clock, () => Effect.sync(() => { businessCalls++; return binding; }), checked)),
            })));
            const first = await run(business());
            const bytes = Result.getOrThrow(retained.readUsage()).chargedBytes;
            const constructionCount = () => spans.filter(name => name === "ApplicationActivation.prepareLegacyBinding").length;
            expect(constructionCount()).toBe(1);
            expect(await run(business())).toBe(first);
            await application.seedUserDocument("current-preparation-clock-progress");
            expect(await run(business())).toBe(first);
            expect(constructionCount()).toBe(1);
            expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(bytes);

            const entered = await runEffect(Deferred.make<void>());
            const release = await runEffect(Deferred.make<void>());
            borrowerRelease = release;
            const borrower = Effect.runFork(retained.use(slot => slot.withEntry(({ binding }) =>
              Effect.sync(() => expect(binding).toBe(first)).pipe(Effect.andThen(Deferred.succeed(entered, undefined)),
                Effect.andThen(Deferred.await(release)), Effect.map(Result.succeed)))));
            // A failed borrower must retain its original Cause and wake this
            // witness; waiting only for its success signal hides that failure.
            await runEffect(Effect.raceFirst(Deferred.await(entered), Fiber.join(borrower)));
            const nextActive = await application.moveHead();
            const refreshed = await run(business());
            expect(refreshed).not.toBe(first);
            expect(isPreparedApplicationBinding(first)).toBe(true);
            expect(constructionCount()).toBe(2);
            expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBeGreaterThan(bytes);
            await runEffect(Deferred.succeed(release, undefined));
            await runEffect(Fiber.join(borrower));
            expect(isPreparedApplicationBinding(first)).toBe(false);
            expect(isPreparedApplicationBinding(refreshed)).toBe(true);
            const currentBytes = Result.getOrThrow(retained.readUsage()).chargedBytes;
            expect(currentBytes).toBeLessThan(bytes * 2);
            expect(await run(business())).toBe(refreshed);
            expect(constructionCount()).toBe(2);
            await runEffect(application.activation.activate({ revisionId: application.active.basis.revisionId,
              expectedActiveHead: nextActive.expectedActiveHead }));
            const aba = await run(business());
            expect(aba).not.toBe(first);
            expect(aba).not.toBe(refreshed);
            expect(constructionCount()).toBe(3);

            // A target metadata write with no row changes still advances its
            // protected epoch and replaces the immutable graph before business.
            await target.persistence.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
            const targetRefresh = await run(business());
            expect(targetRefresh).not.toBe(aba);
            expect(constructionCount()).toBe(4);
            const readinessTarget = await application.authorityPorts.scopeClockTargets.resolve(physicalLocator);
            if (!isLocatedReadCommittedAttemptTargetV1(readinessTarget)) throw new Error("Missing original readiness target");
            // Exercise the readiness issuer directly under this existing host:
            // its original cold proof must own its pair, before any acceptance.
            const anchoredReadiness = await run(retained.use(slot => slot.withEntry(({ binding }, enter) =>
              runRelationalSession(session, "command", {
                enter: (tx, installation) => enter(tx, installation, Effect.void, ({ authority, clock, checked }) =>
                  withApplicationBindingEvidenceInTransaction(binding, tx, clock, evidence => Effect.gen(function* () {
                    const { readinessProtection } = yield* Effect.fromResult(readApplicationBindingTargetProtection(binding));
                    if (readinessProtection === undefined) return yield* Effect.fail(new Error("Missing original generation pair"));
                    const capture = yield* captureApplicationReadinessInTransaction(application.readiness, authority,
                      evidence.projection.revisionId, readinessTarget, tx, clock, "retained");
                    return { capture, protection: readinessProtection };
                  }), checked)),
              })).pipe(Effect.flatMap(captured => prepareCapturedApplicationReadiness(application.readiness,
                captured.capture, "full", captured.protection).pipe(Effect.flatMap(prepared => "status" in prepared
                  ? Effect.fail(new Error("Original readiness preparation refused"))
                  : Effect.succeed({ readiness: prepared.readiness, protection: captured.protection })))))));
            const pairAuthority = Result.getOrThrow(prepareInstalledPairAuthority(pair.installation, target.persistence.drizzle));
            let directReadinessCalls = 0;
            const checkOriginalAnchor = (useFreshTokens: boolean, changedControl = false) => runRelationalSession(session, "command", tx => Effect.gen(function* () {
              yield* Effect.sync(() => { openProtectedMetadataFinalGuardScope(tx); });
              const rows = yield* runDrizzleStatementEffect(tx.select(pairAuthority.fields).from(pairAuthority.source).limit(1),
                cause => new Error("Readiness pair observation failed", { cause }));
              const row = rows[0];
              if (row === undefined) return yield* Effect.fail(new Error("Missing actual admitted pair"));
              const fresh = yield* pairAuthority.accept(tx, row);
              expect(fresh.target.token).not.toBe(anchoredReadiness.protection.target.token);
              expect(fresh.control.token).not.toBe(anchoredReadiness.protection.control.token);
              expect(fresh.target.epoch.generation).toBe(anchoredReadiness.protection.target.epoch.generation);
              if (changedControl) expect(fresh.control.epoch.generation).toBeGreaterThan(anchoredReadiness.protection.control.epoch.generation);
              const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, application.authority.scopeId);
              return yield* withStoredApplicationReadinessForBindingInTransaction(application.readiness, anchoredReadiness.readiness,
                tx, clock, undefined, () => Effect.sync(() => { directReadinessCalls++; }),
                useFreshTokens ? fresh : anchoredReadiness.protection);
            }));
            await run(checkOriginalAnchor(false));
            expect(directReadinessCalls).toBe(1);
            expect(await run(Effect.result(checkOriginalAnchor(true)))).toMatchObject({
              _tag: "Failure", failure: { reason: "invalidComposition" },
            });
            expect(directReadinessCalls).toBe(1);
            await controlOwner.persistence.query("update fx_control_schema_version set schema_version_id = schema_version_id where false");
            expect(await run(Effect.result(checkOriginalAnchor(true, true)))).toMatchObject({
              _tag: "Failure", failure: { reason: "invalidComposition" },
            });
            expect(await run(Effect.result(checkOriginalAnchor(false, true)))).toMatchObject({
              _tag: "Failure", failure: { reason: "authorityChanged" },
            });
            expect(directReadinessCalls).toBe(1);
            const beforeCancellation = Result.getOrThrow(retained.readUsage()).chargedBytes;
            const cancelledFiber = Effect.runFork(Effect.withFiber(fiber => {
              interruptReplacement = () => fiber.interruptUnsafe(fiber.id);
              return business().pipe(Effect.ensuring(Effect.sync(() => { interruptReplacement = undefined; })));
            }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.provideService(ExecutionDiagnostics, diagnostics)));
            const cancelled = await runEffect(Fiber.await(cancelledFiber));
            if (Exit.isSuccess(cancelled)) throw new Error("Expected interrupted replacement construction");
            expect(Cause.hasInterruptsOnly(cancelled.cause)).toBe(true);
            expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(beforeCancellation);
            const controlRefresh = await run(business());
            expect(controlRefresh).not.toBe(targetRefresh);
            expect(constructionCount()).toBe(6);
            await target.persistence.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
            const beforeConcurrent = constructionCount();
            const concurrent = await Promise.all([run(business()), run(business())]);
            expect(concurrent[0]).toBe(concurrent[1]);
            expect(constructionCount()).toBe(beforeConcurrent + 1);
            const callsBeforeRace = businessCalls;
            let changed = false;
            await run(retained.use(slot => slot.withEntry((_graph, enter) => Effect.promise(async () => {
              if (changed) return;
              changed = true;
              const activeHead = await runEffect(application.activation.readActive());
              await runEffect(application.activation.activate({ revisionId: nextActive.basis.revisionId,
                expectedActiveHead: activeHead.expectedActiveHead }));
            }).pipe(Effect.andThen(runRelationalSession(session, "command", {
              enter: (tx, installation) => enter(tx, installation, Effect.void, () => Effect.sync(() => { businessCalls++; })),
            }))))));
            expect(businessCalls).toBe(callsBeforeRace + 1);
            expect(await run(business())).not.toBe(targetRefresh);

            // The named compatibility profile still proves readiness afresh.
            // Immutable token-dependent plans retain the original host generation.
            const fullProof = await run(retainPreparedHost(preparedHostTestRuntime(target.persistence.drizzle),
              prepareCurrentApplicationBinding(application.activation, target.persistence.drizzle, () => Effect.void, {})));
            try {
              const fullProofSession = makePostgresRelationalSession(target.persistence, undefined, { kind: "fullProof" });
              const fullCommand = <A, E, R>(after: (binding: ApplicationBindingInput) => Effect.Effect<A, E, R>,
                clockAccess: "snapshotRead" | "ordinaryWrite" | "update" = "snapshotRead") =>
                fullProof.use(slot => slot.withEntry(({ binding }, enter) => runRelationalSession(fullProofSession, "command", {
                  enter: (tx, installation) => enter(tx, installation, Effect.void, ({ clock, checked }) =>
                    Effect.sync(() => {
                      expect(isManagedInstallationTransaction(tx, target.persistence.drizzle, target.installation)).toBe(true);
                      expect(hasProtectedMetadataFinalGuardScope(tx)).toBe(true);
                      expect(readExactScopeWriteClockObservation(tx, clock.scopeId)).toEqual(clockAccess === "snapshotRead" ? undefined : clock);
                    }).pipe(
                      Effect.andThen(withApplicationBindingEvidenceInTransaction(binding, tx, clock, () => Effect.succeed(binding), checked))), clockAccess),
                }).pipe(Effect.flatMap((result): Effect.Effect<Result.Result<A, CurrentApplicationPreparationRefresh>, E, R> =>
                  Result.isFailure(result) ? Effect.succeed(Result.fail(result.failure)) : after(result.success).pipe(Effect.map(Result.succeed))))));
              const firstFull = await run(fullCommand(Effect.succeed));
              expect(isPreparedApplicationBinding(firstFull)).toBe(true);
              const fullBytes = Result.getOrThrow(fullProof.readUsage()).chargedBytes;
              expect(fullBytes).toBeGreaterThan(0);
              const enteredFull = await runEffect(Deferred.make<ApplicationBindingInput>());
              const fullBorrow = Effect.runFork(fullCommand(binding => Deferred.succeed(enteredFull, binding).pipe(
                Effect.andThen(Effect.never))));
              const activeFull = await runEffect(Deferred.await(enteredFull));
              expect(isPreparedApplicationBinding(activeFull)).toBe(true);
              const borrowedBytes = Result.getOrThrow(fullProof.readUsage()).chargedBytes;
              expect(borrowedBytes).toBeGreaterThan(0);
              for (let command = 0; command < 3; command++) {
                const reused = await run(fullCommand(Effect.succeed,
                  command === 0 ? "ordinaryWrite" : command === 1 ? "update" : "snapshotRead"));
                expect(reused).toBe(activeFull);
                expect(isPreparedApplicationBinding(reused)).toBe(true);
                expect(isPreparedApplicationBinding(activeFull)).toBe(true);
                expect(Result.getOrThrow(fullProof.readUsage()).chargedBytes).toBe(borrowedBytes);
              }
              await runEffect(Fiber.interrupt(fullBorrow));
              const cancelledBorrow = await runEffect(Fiber.await(fullBorrow));
              if (Exit.isSuccess(cancelledBorrow)) throw new Error("Expected actual command borrower cancellation");
              expect(Cause.hasInterruptsOnly(cancelledBorrow.cause)).toBe(true);
              expect(isPreparedApplicationBinding(activeFull)).toBe(true);
              expect(Result.getOrThrow(fullProof.readUsage()).chargedBytes).toBe(fullBytes);
              await expect(run(runRelationalSession(session, "command", tx => verifyUpdateClockObservation(tx, application.authority.scopeId))))
                .rejects.toThrow("Clock observation witness rollback");
              await runEffect(fullProof.close);
              expect(isPreparedApplicationBinding(firstFull)).toBe(false);
              expect(Result.isFailure(fullProof.readUsage())).toBe(true);
            } finally { await runEffect(fullProof.close); }

            const analysis = await runEffect(makeApplicationAnalysisRepository(target.persistence.drizzle).inspect(
              application.authority, application.active.basis.candidateId));
            if (analysis.status !== "analyzed") throw new Error("Missing genuine original analyzed manifest");
            if (analysis.manifest.version !== 1) throw new Error("Expected the legacy fixture's genuine manifest");
            const original = await runEffect(application.activation.readActive());
            const manifest = { ...analysis.manifest, schema: { ...analysis.manifest.schema,
              tables: analysis.manifest.schema.tables.map(table => table.name !== "users" ? table : {
                ...table, validator: { type: "object" as const, value: {
                  name: { fieldType: { type: "string" as const }, optional: false },
                  padding: { fieldType: { type: "string" as const }, optional: true },
                  annotation: { fieldType: { type: "string" as const }, optional: true },
                } },
              }),
            } };
            const beforeIncompatible = Result.getOrThrow(retained.readUsage()).chargedBytes;
            await application.moveHead({ manifest, expectedActiveHead: original.expectedActiveHead });
            const callsBeforeIncompatible = businessCalls;
            await expect(run(business())).rejects.toMatchObject({ reason: "invalidComposition" });
            expect(businessCalls).toBe(callsBeforeIncompatible);
            expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(beforeIncompatible);
            await runEffect(withInstallationMaintenance(dual.owner.persistence.pool.options, dual.schemaName, () => Effect.void));
            await expect(run(business())).rejects.toMatchObject({ _tag: "ApplicationActivationError", reason: "resourceFailure" });
            expect(businessCalls).toBe(callsBeforeRace + 2);
            const slot = await run(retained.use(Effect.succeed));
            await run(retained.close);
            await expect(run(slot.withEntry(() => Effect.sync(() => { businessCalls++; return Result.succeed(undefined); })))).rejects.toMatchObject({ reason: "resourceFailure" });
            expect(businessCalls).toBe(callsBeforeRace + 2);
          } finally {
            if (borrowerRelease !== undefined) await runEffect(Deferred.succeed(borrowerRelease, undefined));
            await runEffect(retained.close);
          }
        } finally { await dual.dispose(); }
      } finally { await control.dispose(); }
    } finally { await controlOwner.dispose(); }
  }, 240_000);
