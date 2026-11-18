import { and, count, eq, sql } from "drizzle-orm";
import { Cause, Data, Deferred, Duration, Effect, Exit, Result, Scope } from "effect";
import {
  inspectVerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { describe, expect, it, vi } from "vitest";
import {
  createPostgresPersistence,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
} from "../../persistence-postgres/src/database/postgres";
import {
  createFileScopedPostgresFixture,
  createActivationServingFileScopedPostgresFixture,
  postgresUrl,
} from "../../persistence-postgres/test/support/postgresHelpers";
import {
  createApplicationNativeMutationPostgresFixture,
} from "../../persistence-postgres/test/application/applicationNativeMutationTestFixture";
import {
  applicationMutationActivationEvidenceFixture,
} from "../../persistence-postgres/test/application/applicationMutationActivationFixture";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "../../persistence-postgres/test/execution/session/support/activationEvidence";
import {
  preparedHostTestRuntime,
} from "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import {
  retainPreparedHost,
} from "../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import {
  prepareProtectedMetadata,
} from "../../persistence-postgres/src/execution/preparation/preparedMetadataEpoch";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/session-kernel";
import {
  prepareFiniteApplicationMutationAdmission,
  readPreparedFiniteApplicationMutationInputs,
} from "../../persistence-postgres/src/application/applicationMutationAdmission";
import {
  createSessionJournalStorePersistence,
} from "../../persistence-postgres/src/execution/sessionJournalStore";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "@flarex/persistence-postgres/internal/session-construction";
import {
  PointMutationSessionActivationV1Error,
} from "@flarex/persistence-postgres/internal/session";
import {
  FiniteMetadataError,
  prepareFiniteMetadataEntryComparison,
  type FiniteMetadataComparisonExpected,
} from "../../persistence-postgres/src/execution/finiteMetadataDependencies";
import {
  inspectPreparedFiniteSessionJournalEntry,
} from "@flarex/persistence-postgres/internal/system-test/session-journal-inspection";
import * as finiteEntryActivation from "../../persistence-postgres/src/execution/journal/finiteEntryActivation";
import * as finiteSession from "../../persistence-postgres/src/execution/session/finiteSession";
import { fxAppRowRevisions, fxSystemCommits, fxSystemMetadataContractObservations, fxSystemPreparedMetadataEpoch,
  fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxSystemSnapshotLeases, fxSystemTransactionExecutionClaims, fxSystemTransactionJournals,
  fxSystemTransactionSessions } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import {
  createMixedMutationProductFixture,
  type MixedMutationFinalEntryTestContext,
} from "./support/mixedMutationWorkerdFixture";

type EntryContext = Parameters<typeof finiteSession.acceptFiniteEntryForContinuationInTransactionEffect>[1];
type EntryProjection = NonNullable<Parameters<typeof finiteSession.acceptFiniteEntryForContinuationInTransactionEffect>[3]>;
type Owner = Awaited<ReturnType<typeof createPostgresPersistence>>;

class EntryOrderTestResourceError extends Data.TaggedError("EntryOrderTestResourceError")<{
  operation: string;
  cause: unknown;
}> {}

function testResource<A>(operation: string, acquire: () => PromiseLike<A>) {
  return Effect.tryPromise({ try: acquire, catch: cause => new EntryOrderTestResourceError({ operation, cause }) });
}

async function inventory(database: Owner["drizzle"]) {
  return Promise.all([fxSystemTransactionSessions, fxSystemSnapshotLeases, fxSystemTransactionJournals,
    fxSystemTransactionExecutionClaims, fxAppRowRevisions, fxSystemCommits, fxSystemCommitEvents].map(async table =>
    (await database.select({ count: count() }).from(table))[0]?.count ?? 0));
}

function typedMetadataFailure(exit: Exit.Exit<unknown, unknown>, selected: FiniteMetadataComparisonExpected) {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected actual metadata refusal");
  expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
  const found = Cause.findError(exit.cause);
  if (Result.isFailure(found)) throw new Error("Missing typed entry refusal");
  let nested: unknown = found.success;
  while (nested !== null && typeof nested === "object" && !(nested instanceof FiniteMetadataError) && "cause" in nested)
    nested = nested.cause;
  expect(nested).toBeInstanceOf(FiniteMetadataError);
  expect(nested).toMatchObject({ reason: "projectionMissing", dependency: {
    namespace: selected.namespace, ownerKey: selected.ownerKey, contractKey: selected.contractKey,
  }, currentObservation: null });
}

const fullArtifactFixture = Effect.fn("EntryOrderTest.fullArtifactFixture")(function* () {
  const scope = yield* Scope.make();
  return yield* Effect.gen(function* () {
    const control = yield* Effect.acquireRelease(testResource("acquire control fixture", createFileScopedPostgresFixture),
      value => testResource("dispose control fixture", () => value.dispose()).pipe(Effect.orDie));
    const dataOwner = yield* Effect.acquireRelease(testResource("acquire data fixture", createFileScopedPostgresFixture),
      value => testResource("dispose data fixture", () => value.dispose()).pipe(Effect.orDie));
    const dual = yield* Effect.acquireRelease(testResource("acquire protected target", () => createActivationServingFileScopedPostgresFixture(dataOwner)),
      value => testResource("dispose protected target", () => value.dispose()).pipe(Effect.orDie));
    const target = dual.serving;
    const physicalLocator = { kind: "database_per_scope", databaseKey: "entry-order-full-artifact", schemaName: target.schemaName } as const;
    const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(dual.activation.persistence,
      physicalLocator, { directInstallation: dual.activation.installation });
    if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) return yield* Effect.die("Missing actual installed activation runner");
    // Keep this named serving witness on its genuine full-artifact proof;
    // only activation selects the separately admitted installation principal.
    const protectedMetadata = yield* prepareProtectedMetadata(target.persistence.drizzle);
    const application = yield* testResource("prepare application fixture", () => createApplicationNativeMutationPostgresFixture({ runtimeHostIdentity: "flarex.test/entry-order-full-artifact",
      compatibilityDate: "2026-09-20", includeTask: false,
      physicalLocator, activationProfile: { kind: "installed", installation: dual.pair, target: activationTarget },
      protectedMetadata: { database: target.persistence.drizzle, token: protectedMetadata },
    }, { control: control.persistence, target: target.persistence }));
    const context = { deploymentId: application.deploymentId, controlDb: control.persistence.drizzle,
      authority: application.authorityPorts, schema: application.schema };
    const retained = yield* Effect.acquireRelease(retainPreparedHost(preparedHostTestRuntime(target.persistence.drizzle),
      prepareFiniteApplicationMutationAdmission(application.activation, "users:create", context).pipe(Effect.map(preparation => ({ preparation })))),
      value => value.close);
    const inputs = yield* retained.use(value => Effect.fromResult(readPreparedFiniteApplicationMutationInputs(value.preparation, context)));
    const store = createSessionJournalStorePersistence(application.sessionAuthority, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(application.deploymentId);
    return { application, deploymentId, context, retained, inputs, store, target, dataOwner,
      closeEffect: Scope.close(scope, Exit.succeed(undefined)),
      close: () => Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))) };
  }).pipe(Scope.provide(scope), Effect.onExit(exit => Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void));
});

/** Faults change actual data-namespace rows through their schema owner. The
 * entry keeps its original restricted login, genuine capture and comparison. */
const invalidateActualEntry = Effect.fn("EntryOrderTest.invalidateActualEntry")(function* (owner: Owner, context: EntryContext,
  projection: EntryProjection, mode: "changed" | "busy") {
  const selected = Result.getOrThrow(prepareFiniteMetadataEntryComparison(projection)).find(value => value.present);
  if (selected === undefined) throw new Error("Missing positive expected metadata key");
  const predicate = and(eq(fxSystemMetadataContractObservations.scopeId, context.anchor.scopeId),
    eq(fxSystemMetadataContractObservations.namespace, selected.namespace),
    eq(fxSystemMetadataContractObservations.ownerKey, selected.ownerKey),
    eq(fxSystemMetadataContractObservations.contractKey, selected.contractKey));
  const deleted = yield* testResource("delete selected metadata observation", () => owner.drizzle.delete(fxSystemMetadataContractObservations).where(predicate).returning());
  expect(deleted).toHaveLength(1);
  if (mode === "changed") {
    const updated = yield* testResource("change actual data epoch", () => owner.drizzle.update(fxSystemPreparedMetadataEpoch).set({
      generation: sql`${fxSystemPreparedMetadataEpoch.generation} + 1`,
    }).where(eq(fxSystemPreparedMetadataEpoch.singletonId, 1)).returning());
    expect(updated).toHaveLength(1);
    return { selected, releaseEffect: Effect.void, release: async () => {} };
  }
  const scope = yield* Scope.make();
  return yield* Effect.gen(function* () {
    const busyOwner = yield* Effect.acquireRelease(testResource("acquire busy epoch owner", () => createPostgresPersistence({
      poolConfig: { ...owner.pool.options, max: 1, query_timeout: 5_000, connectionTimeoutMillis: 5_000 },
    })), value => testResource("close busy epoch owner", () => value.close()).pipe(Effect.orDie));
    const client = yield* Effect.acquireRelease(testResource("acquire busy epoch client", () => busyOwner.pool.connect()),
      value => testResource("rollback busy epoch transaction", () => value.query("rollback")).pipe(
        Effect.matchCauseEffect({
          // A timeout does not acknowledge rollback. Destroy the connection so
          // neither an outstanding query nor an open transaction returns to the pool.
          onFailure: cause => Effect.failCause(cause).pipe(Effect.ensuring(Effect.sync(() => value.release(true)))),
          onSuccess: () => Effect.sync(() => value.release()),
        }), Effect.orDie));
    yield* testResource("begin busy epoch transaction", () => client.query("begin"));
    // Native row lock is held through the entire metadata-refusal observation;
    // evaluating the real final guard here would fail FOR SHARE NOWAIT.
    const lock = owner.drizzle.select({ singletonId: fxSystemPreparedMetadataEpoch.singletonId })
      .from(fxSystemPreparedMetadataEpoch).where(eq(fxSystemPreparedMetadataEpoch.singletonId, 1)).for("update").toSQL();
    yield* testResource("lock actual data epoch", () => client.query(lock.sql, lock.params));
    const probe = yield* Effect.result(testResource("probe actual epoch NOWAIT refusal", () => owner.pool.query("select * from fx_lock_prepared_metadata_epoch()")));
    expect(Result.isFailure(probe)).toBe(true);
    if (Result.isSuccess(probe)) throw new Error("Expected actual epoch NOWAIT refusal");
    expect(probe.failure.cause).toMatchObject({ code: "55P03" });
    return { selected, releaseEffect: Scope.close(scope, Exit.succeed(undefined)),
      release: () => Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))) };
  }).pipe(Scope.provide(scope), Effect.onExit(exit => Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void));
});

describe.skipIf(postgresUrl === null)("finite entry ordered actual refusals", () => {
  for (const mode of ["changed", "busy"] as const) {
    it(`retains metadata refusal before ${mode} data epoch on installed entry`, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const testScope = yield* Effect.scope;
      let context: MixedMutationFinalEntryTestContext | undefined;
      let owner: Owner | undefined;
      let fault: Effect.Success<ReturnType<typeof invalidateActualEntry>> | undefined;
      let runSpy: ReturnType<typeof vi.spyOn> | undefined;
      let baseline: readonly number[] = [];
      let observed = false;
      yield* Effect.addFinalizer(() => Effect.sync(() => { runSpy?.mockRestore(); }));
        const failure = yield* testResource("exercise installed entry refusal", () => createMixedMutationProductFixture({ driver: "postgres", suffix: `entry-order-installed-${mode}`, hooks: {
          beforeFinalEntry: async value => {
            context = value;
            const schema = (await value.currency.persistence.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
            if (schema === undefined || !/^[a-z_][a-z0-9_]*$/i.test(schema) || postgresUrl === null) throw new Error("Missing actual data schema owner");
            const connectionString = postgresUrl;
            owner = await Effect.runPromise(Effect.acquireRelease(
              testResource("acquire installed data owner", () => createPostgresPersistence({ connectionString, poolConfig: { options: `-c search_path=${schema}` } })),
              value => testResource("close installed data owner", () => value.close()).pipe(Effect.orDie)).pipe(Scope.provide(testScope)));
            if (value.currency.resource.kind !== "postgres") throw new Error("Expected actual PostgreSQL entry");
            baseline = await inventory(value.currency.resource.target.drizzle);
          },
          onFiniteEntryPrepared: preparation => {
            if (inspectPreparedFiniteSessionJournalEntry(preparation) === undefined) throw new Error("Missing original entry preparation");
            const original = finiteSession.acceptFiniteEntryForContinuationInTransactionEffect;
            runSpy = vi.spyOn(finiteSession, "acceptFiniteEntryForContinuationInTransactionEffect").mockImplementation((...args) =>
              Effect.gen(function* () {
                if (owner === undefined) throw new Error("Missing data owner");
                if (args[3] === undefined) throw new Error("Missing authentic complete entry projection");
                // Harness setup failures are defects at this injection boundary;
                // the original entry keeps its exact typed runtime failures.
                fault = yield* Effect.acquireRelease(invalidateActualEntry(owner, args[1], args[3], mode).pipe(Effect.orDie), value => value.releaseEffect).pipe(Scope.provide(testScope));
                return yield* original(...args);
              }));
          },
          beforeNative: () => Effect.die("Refused entry must not invoke business callbacks"),
          onFinalEntryFailure: async (value, exit) => {
            if (fault === undefined) throw new Error("Missing actual combined failure");
            typedMetadataFailure(exit, fault.selected);
            if (value.currency.resource.kind !== "postgres") throw new Error("Expected PostgreSQL failure context");
            expect(await inventory(value.currency.resource.target.drizzle)).toEqual(baseline);
            observed = true;
            // Keep a busy lock held until the genuine runtime refusal is known.
            await fault.release();
            fault = undefined;
          },
        } }).then(async fixture => { await fixture.close(); throw new Error("Expected combined entry refusal"); }, cause => cause));
        expect(context).toBeDefined();
        expect(observed, String(failure)).toBe(true);
    }))), 180_000);

    it(`retains metadata refusal before ${mode} data epoch on full artifact entry`, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const testScope = yield* Effect.scope;
      const fixture = yield* Effect.acquireRelease(fullArtifactFixture(), value => value.closeEffect);
      const { application, deploymentId, context, retained, inputs, store, target, dataOwner } = fixture;
      let fault: Effect.Success<ReturnType<typeof invalidateActualEntry>> | undefined;
      let runSpy: ReturnType<typeof vi.spyOn> | undefined;
      yield* Effect.addFinalizer(() => Effect.sync(() => { runSpy?.mockRestore(); }));
        const evidence = yield* testResource("prepare signed application evidence", () => applicationMutationActivationEvidenceFixture({ deploymentId: application.deploymentId, executionAuthority: inputs.executionAuthority,
          requestKey: `entry-order-full-${mode}`, grantId: `entry-order-full-${mode}` }));
        const baseline = yield* testResource("read full artifact baseline", () => inventory(target.persistence.drizzle));
        const exit = yield* Effect.exit(Effect.scoped(Effect.gen(function* () {
          const preparation = yield* store.prepareFiniteEntryEffect([]);
          if (inspectPreparedFiniteSessionJournalEntry(preparation) === undefined) return yield* Effect.die("Missing full-artifact entry preparation");
          const original = finiteSession.acceptFiniteEntryForContinuationInTransactionEffect;
          runSpy = vi.spyOn(finiteSession, "acceptFiniteEntryForContinuationInTransactionEffect").mockImplementation((...args) =>
            Effect.gen(function* () {
              if (args[3] === undefined) throw new Error("Missing authentic complete entry projection");
              fault = yield* Effect.acquireRelease(invalidateActualEntry(dataOwner.persistence, args[1], args[3], mode).pipe(Effect.orDie), value => value.releaseEffect).pipe(Scope.provide(testScope));
              return yield* original(...args);
            }));
          return yield* retained.use(value => createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority,
            { leaseDurationMilliseconds: 60_000 }).activateFiniteEffect({ deploymentId, scopeId: evidence.scopeId,
            preparedAdmission: value.preparation, admissionContext: context, evidence: evidence.evidence }, preparation));
        })));
        if (fault === undefined) throw new Error(`Missing actual full-artifact combined failure: ${String(exit)}`);
        typedMetadataFailure(exit, fault.selected);
        expect(yield* testResource("read refused full artifact inventory", () => inventory(target.persistence.drizzle))).toEqual(baseline);
    }))), 180_000);
  }

  for (const refusal of ["grantExpiry", "storageFence"] as const) {
  it(`refuses ${refusal} as typed failure after its actual ordered authority or sequencer wait before provisional entry`, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* Effect.acquireRelease(fullArtifactFixture(), value => value.closeEffect);
    const { application, deploymentId, context, retained, inputs, store, target, dataOwner } = fixture;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let holding: Promise<void> | undefined;
    let admission: Promise<Exit.Exit<unknown, unknown>> | undefined;
    let admissionSettled: Exit.Exit<unknown, unknown> | undefined;
    let holderPid: number | undefined;
    let admissionObserved = false;
    let changeFence: (() => Promise<void>) | undefined;
    let runSpy: ReturnType<typeof vi.spyOn> | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => { runSpy?.mockRestore(); }));
    return yield* Effect.gen(function* () {
      const evidence = yield* testResource("prepare ordered wait evidence", () => applicationMutationActivationEvidenceFixture({ deploymentId: application.deploymentId,
        executionAuthority: inputs.executionAuthority, requestKey: "entry-before-provisional-expiry", grantId: "entry-before-provisional-expiry",
        // Leave room for actual signed expiry before the native 30s statement bound.
        grantLifetimeMilliseconds: refusal === "grantExpiry" ? 10_000 : 30_000 }));
      const originalDeadline = Date.parse(inspectVerifiedApplicationMutationGrantV1(evidence.evidence.verifiedGrant).payload.expiresAt);
      const baseline = yield* testResource("read ordered wait baseline", () => inventory(target.persistence.drizzle));
      holding = dataOwner.persistence.drizzle.transaction(async tx => {
        // Authority writers take the authority row before the sequencer. The
        // arriving entry therefore cannot hold SHARE authority while this owner
        // changes its fence, and the writer never inverts the native lock order.
        if (refusal === "storageFence") await tx.select().from(fxSystemScopeExecutionAuthorities)
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, evidence.scopeId)).for("update");
        await tx.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, evidence.scopeId)).for("update");
        holderPid = (await tx.select({ pid: sql<number>`pg_backend_pid()::int` }).from(fxSystemScopeClocks)
          .where(eq(fxSystemScopeClocks.scopeId, evidence.scopeId)))[0]?.pid;
        if (holderPid === undefined) throw new Error("Missing actual ordered-lock holder backend");
        changeFence = async () => { await tx.update(fxSystemScopeExecutionAuthorities).set({
          storageGenerationFence: sql`${fxSystemScopeExecutionAuthorities.storageGenerationFence} + 1`,
        }).where(eq(fxSystemScopeExecutionAuthorities.scopeId, evidence.scopeId)); };
        await Effect.runPromise(Deferred.succeed(entered, undefined));
        await Effect.runPromise(Deferred.await(release));
      });
      // A failing holder cannot signal readiness. Its native transaction still
      // belongs to the drain below, including when this readiness race ends.
      const holder = holding;
      yield* Effect.raceFirst(Deferred.await(entered), testResource("wait for native holder setup", () => holder)
        .pipe(Effect.andThen(Effect.die("Native holder completed before releasing its ordered locks"))));
      admission = Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
        const preparation = yield* store.prepareFiniteEntryEffect([]);
        if (inspectPreparedFiniteSessionJournalEntry(preparation) === undefined) return yield* Effect.die("Missing actual entry preparation");
        runSpy = vi.spyOn(finiteEntryActivation, "runPreparedFiniteSessionJournalEntryEffect");
        return yield* retained.use(value => createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority,
          { leaseDurationMilliseconds: 60_000 }).activateFiniteEffect({ deploymentId, scopeId: evidence.scopeId,
          preparedAdmission: value.preparation, admissionContext: context, evidence: evidence.evidence }, preparation));
      }))).then(exit => { admissionSettled = exit; return exit; });
      if (holderPid === undefined) throw new Error("Missing actual lock holder identity");
      let waited = false;
      let blockedBackends: readonly { pid: number; blockers: number[] }[] = [];
      const observeUntil = Math.min(originalDeadline - 1, Date.now() + 10_000);
      while (Date.now() < observeUntil) {
        // Cross-role activity details are not granted to this ordinary owner.
        // Actual blocking PIDs prove the wait without those visibility assumptions.
        const result = yield* testResource("observe exact ordered holder blocker", () => dataOwner.persistence.pool.query<{ pid: number; blockers: number[] }>(`select pid, pg_blocking_pids(pid) as blockers
          from pg_stat_activity where datname = current_database()
            and $1::int = any(pg_blocking_pids(pid))`, [holderPid]));
        blockedBackends = result.rows;
        if (blockedBackends.length > 0) { waited = true; break; }
        if (admissionSettled !== undefined) break;
        yield* Effect.sleep(Duration.millis(25));
      }
      const admissionDiagnostic = admissionSettled === undefined ? "pending" : Exit.isFailure(admissionSettled)
        ? `failed: ${Cause.pretty(admissionSettled.cause)}` : "settled successfully";
      expect(waited, `Actual holder PID=${holderPid}; visible blocked backends=${JSON.stringify(blockedBackends)}; admission=${admissionDiagnostic}`).toBe(true);
      if (refusal === "grantExpiry") {
        // Wait the actual signed grant bound; no invented timer grants expiry.
        yield* Effect.sleep(Duration.millis(Math.max(1, originalDeadline - Date.now() + 100)));
      } else {
        if (changeFence === undefined) throw new Error("Missing actual locked authority owner");
        const writeFence = changeFence;
        yield* testResource("write fence through real ordered holder", writeFence);
      }
      yield* Deferred.succeed(release, undefined);
      const held = holding;
      yield* testResource("settle ordered holder transaction", () => held);
      const pendingAdmission = admission;
      const exit = yield* testResource("observe ordered admission Exit", () => pendingAdmission);
      admissionObserved = true;
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) throw new Error("Expired entry unexpectedly admitted");
      expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
      const found = Cause.findError(exit.cause);
      if (Result.isFailure(found)) throw new Error("Missing typed expiry refusal");
      let nested: unknown = found.success;
      while (nested !== null && typeof nested === "object" && !(nested instanceof PointMutationSessionActivationV1Error) && "cause" in nested)
        nested = nested.cause;
      expect(nested).toBeInstanceOf(PointMutationSessionActivationV1Error);
      expect(nested).toMatchObject({ issue: { reason: refusal === "grantExpiry" ? "authorizationGrantExpired" : "storageGenerationFenceChanged" } });
      expect(runSpy).not.toHaveBeenCalled();
      expect(yield* testResource("read ordered refusal inventory", () => inventory(target.persistence.drizzle))).toEqual(baseline);
    }).pipe(Effect.onExit(() => Deferred.succeed(release, undefined).pipe(
      // Both native operations must settle before the scoped fixture is closed.
      // Each drain runs even if the preceding drain fails, preserving Causes.
      Effect.onExit(() => {
        const pending = holding;
        return pending === undefined ? Effect.void : testResource("drain native ordered holder", () => pending);
      }),
      Effect.onExit(() => {
        const pending = admission;
        return pending === undefined ? Effect.void : testResource("drain native ordered admission", () => pending).pipe(
          Effect.flatMap(exit => !admissionObserved && Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.void));
      }),
      Effect.asVoid,
      Effect.uninterruptible,
    )));
  }))), 180_000);
  }
});
