import { eq } from "drizzle-orm";
import { Effect, Exit, Fiber, Random, Result, Schema } from "effect";
import { Client } from "pg";
import { appRowIdHexV1ToBytes } from
  "flarex-protocol/app-document-id";
import {
  CommitEnvelopeV1Schema,
  CommitSyscallSequenceV1Schema,
  SESSION_JOURNAL_FORMAT_V1,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  decodeActivePointMutationTargetMetadataV1,
  preparePointMutationStartEvidenceV1,
} from "flarex-protocol/point-mutation-start";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
} from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueV1,
} from "flarex-protocol/value";
import { describe, expect, it, vi } from "vitest";

import {
  createPointMutationSessionAttemptTerminalizationV1,
  createPointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../../executor/src/pointMutationSessionActivation";
import { createPointMutationJournalV1 } from "../../executor/src/pointMutationJournal";
import {
  createStoredAttemptAuthenticationV1,
  InvalidAuthorizedPointMutationOccRerunV1Error,
  PointMutationOccUserCodeV1Error,
  PointMutationOccRerunOwnershipLostV1Error,
  type PointMutationOccRuntimeNeutralRunnerV1,
} from "../../executor/src/storedAttemptAuthentication";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "../../executor/src/transactionGrant";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1,
  type PointCommitTransactionCommandV1,
  type PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  createSessionJournalStorePersistenceV1,
  type SessionJournalAttemptV1,
} from "../src/sessionJournalStore";
import {
  createStoredCommitAuthorityEvidenceLoaderV1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceLoaderOptionsV1,
  type StoredCommitAuthorityEvidenceQueryV1,
} from "../src/storedCommitAuthorityEvidence";
import { createStoredOccExecutionEvidenceLoaderV1 } from "../src/storedOccExecution";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptEvidenceLoadResultV1,
  type StoredAttemptEvidenceLoaderOptionsV1,
  type StoredAttemptEvidenceQueryV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptLoadLockStepV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

describePostgres("real Postgres stored-attempt authority", () => {
  it("closes repeatable read before hashing and binds one complete sealed snapshot", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const observedQueries = new Map<
        StoredAttemptEvidenceQueryV1["name"],
        StoredAttemptEvidenceQueryV1
      >();
      const current = await scenario(persistence, "closed_before_hash", {
        observeQuery: (query) => {
          observedQueries.set(query.name, query);
        },
      });
      const prepared = await prepareSeal(current.store, current.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ ok: true }),
      );
      const envelope = await completeSeal(current.store,
        prepared.preparation,
        journal,
        result,
      );
      const loadedAttempt = await runEffect(current.loading.load(selectorWire(
        current.anchor,
      )));
      const authentication = createStoredAttemptAuthenticationV1(
        current.loader,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const before = await attemptTimestamps(
        persistence,
        current.anchor.sessionId,
      );

      const digestEntered = deferredSignal();
      const releaseDigest = deferredSignal();
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      let gatedDigest = false;
      const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (algorithm, data) => {
          if (!gatedDigest) {
            gatedDigest = true;
            digestEntered.resolve();
            await releaseDigest.promise;
          }
          return originalDigest(algorithm, data);
        },
      );
      const authenticationPromise = runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      await digestEntered.promise;

      const locker = await persistence.pool.connect();
      let lockTransactionOpen = false;
      try {
        await locker.query("begin");
        lockTransactionOpen = true;
        await locker.query("set local lock_timeout = '2s'");
        await locker.query(`
          lock table
            fx_system_tx_session,
            fx_system_snapshot_lease,
            fx_system_tx_journal,
            fx_system_tx_journal_point
          in access exclusive mode nowait
        `);
        await locker.query("rollback");
        lockTransactionOpen = false;
      } finally {
        if (lockTransactionOpen) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
        releaseDigest.resolve();
      }
      let authenticated: Awaited<typeof authenticationPromise>;
      try {
        authenticated = await authenticationPromise;
      } finally {
        releaseDigest.resolve();
        digestSpy.mockRestore();
      }

      expect(authentication.isAuthenticated(authenticated)).toBe(true);
      expect(await attemptTimestamps(
        persistence,
        current.anchor.sessionId,
      )).toEqual(before);
      const plans = await lookupPlans(persistence, observedQueries);
      expect(plans.session).toContain("Index Scan");
      expect(plans.session).toContain("session_id");
      expect(plans.sessionPrimaryKey).toContain("scope_uuid, session_id");
      expect(plans.lease).toContain(
        "fx_system_snapshot_lease_scope_uuid_session_id_pk",
      );
      expect(plans.root).toContain("fx_system_tx_journal_pk");
      expect(plans.points).toContain("fx_system_tx_journal_point_pk");
    });
  }, 120_000);

  it("bootstraps finishing recovery through the same bounded indexed snapshot", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "finishing_recovery");
      await sealScenario(current);
      const running = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      if (running.kind !== "loaded") {
        throw new Error(`Expected running evidence, received ${running.kind}.`);
      }
      await runEffect(
        createPointCommitFinishingTransitionPortV1(
          resolutionPorts(persistence),
        ).enterFinishing(
          await pointCommitFinishingCommandFromStoredAttemptV1(
            current.authority,
            running.evidence,
          ),
        ),
      );

      const observedQueries = new Map<
        StoredAttemptEvidenceQueryV1["name"],
        StoredAttemptEvidenceQueryV1
      >();
      const recoveryLoader = createStoredAttemptEvidenceLoaderV1(
        resolutionPorts(persistence),
        { observeQuery: (query) => observedQueries.set(query.name, query) },
      );
      const recovered = await runEffect(recoveryLoader.loadFinishingEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        sessionId: current.anchor.sessionId,
        attemptFence: current.anchor.attemptFence,
      }));
      expect(recovered).toMatchObject({
        kind: "loaded",
        evidence: { session: { lifecycle: "finishing" } },
      });
      expect([...observedQueries.keys()]).toEqual([
        "clock",
        "databaseTime",
        "session",
        "lease",
        "root",
        "points",
      ]);
      const plans = await lookupPlans(persistence, observedQueries);
      expect(plans.session).toContain("Index Scan");
      expect(plans.lease).toContain(
        "fx_system_snapshot_lease_scope_uuid_session_id_pk",
      );
      expect(plans.root).toContain("fx_system_tx_journal_pk");
      expect(plans.points).toContain("fx_system_tx_journal_point_pk");
    });
  }, 120_000);

  it("holds interruption until the finishing-recovery snapshot settles", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "finishing_recovery_interrupt");
      await sealScenario(current);
      const running = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      if (running.kind !== "loaded") {
        throw new Error(`Expected running evidence, received ${running.kind}.`);
      }
      await runEffect(
        createPointCommitFinishingTransitionPortV1(
          resolutionPorts(persistence),
        ).enterFinishing(
          await pointCommitFinishingCommandFromStoredAttemptV1(
            current.authority,
            running.evidence,
          ),
        ),
      );

      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptionSettled = false;
      const loader = createStoredAttemptEvidenceLoaderV1(
        resolutionPorts(persistence),
        {
          beforeRepeatableReadClose: async () => {
            entered.resolve();
            await release.promise;
          },
        },
      );
      const fiber = Effect.runFork(loader.loadFinishingEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        sessionId: current.anchor.sessionId,
        attemptFence: current.anchor.attemptFence,
      }));
      await entered.promise;
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        expect(interruptionSettled).toBe(false);
      } finally {
        release.resolve();
      }
      await interruption;
      expect(interruptionSettled).toBe(true);
      expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(true);
    });
  }, 120_000);

  it("linearizes seal/load and treats detached success as non-authoritative", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const racing = await scenario(persistence, "seal_load_race");
      const prepared = await prepareSeal(racing.store, racing.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect(null),
      );
      const [loadResult, envelope] = await Promise.all([
        runEffect(racing.loader.loadEffect(racing.authority)),
        completeSeal(racing.store, prepared.preparation, journal, result),
      ]);
      expect(["loaded", "notPlannable"]).toContain(loadResult.kind);
      if (loadResult.kind === "loaded") {
        expect(loadResult.evidence.root.sealedFinalSyscallSequence).toBe(0n);
      } else {
        expect(loadResult).toMatchObject({
          kind: "notPlannable",
          reason: "rootNotSealed",
        });
      }

      const loadedAttempt = await runEffect(racing.loading.load(selectorWire(
        racing.anchor,
      )));
      const authentication = createStoredAttemptAuthenticationV1(
        racing.loader,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const authenticated = await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      expect(authentication.isAuthenticated(authenticated)).toBe(true);

      await persistence.query(
        `
          update fx_system_tx_session
          set lifecycle = 'expired', updated_at = clock_timestamp()
          where session_id = $1
        `,
        [racing.anchor.sessionId],
      );
      expect(authentication.isAuthenticated(authenticated)).toBe(true);
      await expect(runEffect(
        racing.loader.loadEffect(racing.authority),
      )).resolves
        .toMatchObject({
          kind: "notPlannable",
          reason: "lifecycle",
          lifecycle: "expired",
        });
    });
  }, 120_000);

  it("captures C04B1 authority coherently and closes SQL before schema hashing", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await scenario(persistence, "commit_authority_rr");
      const prepared = await prepareSeal(current.store, current.attempt);
      const journal = await runEffect(
        canonicalizeSessionJournalV1Effect(prepared.journal),
      );
      const result = await runEffect(
        canonicalizeSuccessfulResultV1Effect({ ok: true }),
      );
      await completeSeal(current.store,
        prepared.preparation,
        journal,
        result,
      );
      const stored = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      if (stored.kind !== "loaded") throw new Error("Expected C04A evidence.");
      const authority = commitAuthorityFromStoredEvidence(
        current.authority,
        stored.evidence,
      );
      const observed = new Map<
        StoredCommitAuthorityEvidenceQueryV1["name"],
        StoredCommitAuthorityEvidenceQueryV1
      >();
      const loader = createStoredCommitAuthorityEvidenceLoaderV1(
        resolutionPorts(persistence),
        { observeQuery: (query) => observed.set(query.name, query) },
      );
      const digestEntered = deferredSignal();
      const releaseDigest = deferredSignal();
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      let gatedDigest = false;
      const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (algorithm, data) => {
          if (!gatedDigest) {
            gatedDigest = true;
            digestEntered.resolve();
            await releaseDigest.promise;
          }
          return originalDigest(algorithm, data);
        },
      );
      const loadPromise = runEffect(loader.loadEffect(authority));
      await digestEntered.promise;

      const locker = await persistence.pool.connect();
      let lockTransactionOpen = false;
      try {
        await locker.query("begin");
        lockTransactionOpen = true;
        await locker.query("set local lock_timeout = '2s'");
        await locker.query(`
          lock table
            fx_system_scope_clock,
            fx_system_tx_session,
            fx_system_snapshot_lease,
            fx_system_tx_journal,
            fx_control_schema_version,
            fx_control_table
          in access exclusive mode nowait
        `);
        await locker.query("rollback");
        lockTransactionOpen = false;
      } finally {
        if (lockTransactionOpen) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
        releaseDigest.resolve();
      }
      let loaded: Awaited<typeof loadPromise>;
      try {
        loaded = await loadPromise;
      } finally {
        releaseDigest.resolve();
        digestSpy.mockRestore();
      }
      expect(loaded).toMatchObject({ kind: "loaded" });
      expect([...observed.keys()]).toEqual([
        "clock",
        "authoritySizes",
        "lease",
        "root",
        "schemaSizes",
        "authorityPayload",
        "schemaPayload",
        "stableBindings",
      ]);
      const authorityPlan = await explainCommitAuthorityObserved(
        persistence,
        requireCommitObservedQuery(observed, "authoritySizes"),
      );
      const schemaPlan = await explainCommitAuthorityObserved(
        persistence,
        requireCommitObservedQuery(observed, "schemaSizes"),
      );
      expect(authorityPlan).toContain("fx_system_tx_session");
      expect(authorityPlan).toContain("Index Scan");
      expect(schemaPlan).toContain("fx_control_schema_version");
      expect(schemaPlan).toContain("Index Scan");
    });
  }, 120_000);

  it("keeps one coherent C04B1 snapshot across revocation and uses database-time expiry", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const racing = await scenario(persistence, "commit_authority_race");
      await sealScenario(racing);
      const racingStored = await runEffect(
        racing.loader.loadEffect(racing.authority),
      );
      if (racingStored.kind !== "loaded") {
        throw new Error("Expected C04A racing evidence.");
      }
      const racingAuthority = commitAuthorityFromStoredEvidence(
        racing.authority,
        racingStored.evidence,
      );
      if (postgresUrl === null) {
        throw new Error("Real Postgres URL disappeared during the test.");
      }
      const schemaResult = await persistence.pool.query<{
        schema_name: string;
      }>("select current_schema() as schema_name");
      const schemaName = schemaResult.rows[0]?.schema_name;
      if (schemaName === undefined) {
        throw new Error("Missing temporary Postgres schema.");
      }
      const revocationClient = new Client({ connectionString: postgresUrl });
      await revocationClient.connect();
      await revocationClient.query(
        "select set_config('search_path', $1, false)",
        [schemaName],
      );
      await revocationClient.query("set lock_timeout = '5s'");
      let revocationCommitted = false;
      const racingLoader = createStoredCommitAuthorityEvidenceLoaderV1(
        resolutionPorts(persistence),
        {
          afterSizeProjection: async () => {
            if (revocationCommitted) return;
            await revocationClient.query(
              `
                update fx_system_scope_clock
                set authorization_revocation_epoch =
                  authorization_revocation_epoch + 1
                where scope_id = $1
              `,
              [racing.anchor.scopeId],
            );
            revocationCommitted = true;
          },
        },
      );
      try {
        await expect(runEffect(racingLoader.loadEffect(racingAuthority))).resolves
          .toMatchObject({ kind: "loaded" });
        expect(revocationCommitted).toBe(true);
        await expect(runEffect(
          createStoredCommitAuthorityEvidenceLoaderV1(
            resolutionPorts(persistence),
          ).loadEffect(racingAuthority),
        )).resolves.toMatchObject({
          kind: "authorityMismatch",
          reason: "revocationEpochChanged",
        });
      } finally {
        await revocationClient.end();
      }

      const expired = await scenario(persistence, "commit_authority_expired");
      await sealScenario(expired);
      const expiredStored = await runEffect(
        expired.loader.loadEffect(expired.authority),
      );
      if (expiredStored.kind !== "loaded") {
        throw new Error("Expected C04A expiry evidence.");
      }
      const expiredAuthority = commitAuthorityFromStoredEvidence(
        expired.authority,
        expiredStored.evidence,
      );
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set lease_expires_at = clock_timestamp() - interval '1 millisecond'
          where session_id = $1
        `,
        [expired.anchor.sessionId],
      );
      await expect(runEffect(
        createStoredCommitAuthorityEvidenceLoaderV1(
          resolutionPorts(persistence),
        ).loadEffect(expiredAuthority),
      )).resolves.toMatchObject({ kind: "notPlannable", reason: "expired" });
    });
  }, 120_000);

  it("authorizes only one genuine O08-B1 replacement winner", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(persistence, "replacement_winner");
      const table = await runEffect(
        current.store.resolvePointTableEffect(current.attempt, "users"),
      );
      await expect(runPointOperation(current.store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        fields: { name: "conflicted" },
      })).resolves.toMatchObject({
        kind: "completed",
        outcome: { kind: "inserted" },
      });
      const envelope = await sealScenario(current);
      const loadedAttempt = await runEffect(current.loading.load(selectorWire(
        current.anchor,
      )));
      current.freshAttemptLoadLocks.length = 0;
      const observedOutcomeKinds: string[] = [];
      const authentication = createO08B1Authentication(
        persistence,
        current,
        observedOutcomeKinds,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const authenticated = await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      const commitAuthority = await runEffect(
        authentication.authenticateCommitAuthority(authenticated),
      );
      const verified = await runEffect(
        authentication.verifyCommitInput(commitAuthority),
      );
      const running = await runEffect(authentication.planPointCommit(verified));
      const finishing = await runEffect(
        authentication.enterPointCommitFinishing(running),
      );
      const finishingStored = await runEffect(
        current.loader.loadFinishingEffect({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
          sessionId: current.anchor.sessionId,
          attemptFence: current.anchor.attemptFence,
        }),
      );
      if (finishingStored.kind !== "loaded") {
        throw new Error("Expected finishing O08-B1 evidence.");
      }
      await commitCompetingPointRow(
        persistence,
        await pointCommitCommandFromStoredAttemptV1(
          current.authority,
          finishingStored.evidence,
        ),
      );
      const conflicts = await Promise.all([
        runFailure(authentication.publishPointCommit(finishing)),
        runFailure(authentication.publishPointCommit(finishing)),
      ]);
      expect(conflicts).toHaveLength(2);
      for (const conflict of conflicts) {
        expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      }

      const fixedRandom = Object.freeze({
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      });
      const results = await Promise.all(conflicts.map((conflict) =>
        runEffect(Effect.result(
          authentication.authorizePointMutationOccRerun(conflict).pipe(
            Effect.provideService(Random.Random, fixedRandom),
          ),
        ))
      ));
      const authorizedResult = results.find(Result.isSuccess);
      const rejectedResult = results.find(Result.isFailure);
      expect(authorizedResult).toBeDefined();
      expect(rejectedResult).toBeDefined();
      if (
        authorizedResult === undefined ||
        Result.isFailure(authorizedResult)
      ) {
        throw new Error("Expected one authorized O08-B1 replacement winner.");
      }
      if (rejectedResult === undefined || Result.isSuccess(rejectedResult)) {
        throw new Error("Expected one rejected O08-B1 replacement loser.");
      }
      expect(rejectedResult.failure).toBeInstanceOf(
        PointMutationOccRerunOwnershipLostV1Error,
      );
      expect(rejectedResult.failure).toMatchObject({
        reason: "alreadyReplaced",
      });
      expect(observedOutcomeKinds).toEqual(["missing", "missing"]);
      expect(current.freshAttemptLoadLocks).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
      ]);
      expect(authorizedResult.success).toMatchObject({
        kind: "authorized",
        backoffUpperBoundMilliseconds: 100,
        backoffMilliseconds: 0,
      });
      if (authorizedResult.success.kind !== "authorized") {
        throw new Error("Expected an O08-B1 rerun capability.");
      }
      const inspection =
        authentication.consumeAuthorizedPointMutationOccRerunForTest(
          authorizedResult.success.rerun,
        );
      expect(inspection).toMatchObject({
        previousAttemptFence: current.anchor.attemptFence,
        attemptFence: current.anchor.attemptFence + 1n,
        previousSnapshotToken: current.anchor.snapshotToken,
        snapshotToken: {
          epoch: current.anchor.snapshotToken.epoch,
          commitSeq: 1n,
        },
        conflictingCommitSeq: 1n,
      });
      let secondConsumeFailure: unknown;
      try {
        authentication.consumeAuthorizedPointMutationOccRerunForTest(
          authorizedResult.success.rerun,
        );
      } catch (cause) {
        secondConsumeFailure = cause;
      }
      expect(secondConsumeFailure).toBeInstanceOf(
        InvalidAuthorizedPointMutationOccRerunV1Error,
      );
      expect(secondConsumeFailure).toMatchObject({
        reason: "alreadyConsumed",
      });
      await expectFreshO08B1Attempt(
        persistence,
        finishingStored.evidence.scopeUuid,
        current.anchor.sessionId,
      );
    });
  }, 120_000);

  it("runs B2a after open evidence closes SQL and publishes through the sole point publisher", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(persistence, "b2a_execution");
      const table = await runEffect(
        current.store.resolvePointTableEffect(current.attempt, "users"),
      );
      await runPointOperation(current.store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        fields: { name: "conflicted" },
      });
      const envelope = await sealScenario(current);
      const loadedAttempt = await runEffect(
        current.loading.load(selectorWire(current.anchor)),
      );
      let repeatableReadClosed = false;
      let runnerCalls = 0;
      const observedQueries = new Map<
        StoredCommitAuthorityEvidenceQueryV1["name"],
        StoredCommitAuthorityEvidenceQueryV1
      >();
      const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
        run: (
          input: Parameters<PointMutationOccRuntimeNeutralRunnerV1["run"]>[0],
        ): ReturnType<PointMutationOccRuntimeNeutralRunnerV1["run"]> =>
          Effect.tryPromise({
            try: async () => {
              expect(repeatableReadClosed).toBe(true);
              runnerCalls += 1;
              expect(input.context).toMatchObject({
                executionId: "o08-b2a-postgres-1",
                logScopeId: "o08-b2a-postgres-log-1",
                attemptFence: 2n,
                snapshotToken: { commitSeq: 1n },
              });
              expect(input.context.executionTime).toBe(
                input.context.initialCreationTimeCursor,
              );
              await assertNoOpenExecutionEvidenceTransaction(persistence);
              return Object.freeze({ ok: true });
            },
            catch: (cause) => new PointMutationOccUserCodeV1Error({ cause }),
          }),
      });
      const authentication = createO08B2aAuthentication(
        persistence,
        current,
        runner,
        {
          afterRepeatableRead: () => {
            repeatableReadClosed = true;
          },
          observeQuery: (query) => observedQueries.set(query.name, query),
        },
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt),
      );
      const authenticated = await runEffect(
        authentication.authenticate(authority, encodeEnvelope(envelope)),
      );
      const commitAuthority = await runEffect(
        authentication.authenticateCommitAuthority(authenticated),
      );
      const verified = await runEffect(
        authentication.verifyCommitInput(commitAuthority),
      );
      const running = await runEffect(authentication.planPointCommit(verified));
      const finishing = await runEffect(
        authentication.enterPointCommitFinishing(running),
      );
      const finishingStored = await runEffect(
        current.loader.loadFinishingEffect({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
          sessionId: current.anchor.sessionId,
          attemptFence: current.anchor.attemptFence,
        }),
      );
      if (finishingStored.kind !== "loaded") {
        throw new Error("Expected finishing B2a PostgreSQL evidence.");
      }
      await commitCompetingPointRow(
        persistence,
        await pointCommitCommandFromStoredAttemptV1(
          current.authority,
          finishingStored.evidence,
        ),
      );
      const conflict = await runFailure(
        authentication.publishPointCommit(finishing),
      );
      if (!(conflict instanceof PointCommitConflictV1Error)) {
        throw new Error("Expected a genuine B2a PostgreSQL conflict.");
      }
      const authorized = await runEffect(
        authentication.authorizePointMutationOccRerun(conflict).pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
      );
      if (authorized.kind !== "authorized") {
        throw new Error("Expected the PostgreSQL B2a handoff to authorize.");
      }

      await expect(
        runEffect(
          authentication.executeAuthorizedPointMutationOccRerun(
            authorized.rerun,
          ),
        ),
      ).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 2n },
        successfulResult: { valueJson: { ok: true } },
      });
      expect(runnerCalls).toBe(1);
      const childQuery = requireCommitObservedQuery(
        observedQueries,
        "attemptChildren",
      );
      const childPlan = await explainCommitAuthorityObserved(
        persistence,
        childQuery,
      );
      expect(childPlan).toContain("fx_system_tx_journal_receipt_pk");
      expect(childPlan).toContain("fx_system_tx_journal_point_pk");
      expect(childPlan).toContain("fx_system_tx_journal_event_pk");
      await expect(
        persistence.query<{
          lifecycle: string;
          leases: string;
          journals: string;
          outcomes: string;
          headers: string;
        }>(
          `
          select session.lifecycle,
            (select count(*)::text from fx_system_snapshot_lease as lease
             where lease.scope_uuid = session.scope_uuid
               and lease.session_id = session.session_id) as leases,
            (select count(*)::text from fx_system_tx_journal as journal
             where journal.scope_uuid = session.scope_uuid
               and journal.session_id = session.session_id) as journals,
            (select count(*)::text from fx_system_idempotency as outcome
             where outcome.scope_uuid = session.scope_uuid) as outcomes,
            (select count(*)::text from fx_system_commit as header
             where header.scope_uuid = session.scope_uuid) as headers
          from fx_system_tx_session as session
          where session.scope_uuid = $1 and session.session_id = $2
        `,
          [finishingStored.evidence.scopeUuid, current.anchor.sessionId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            lifecycle: "committed",
            leases: "0",
            journals: "0",
            outcomes: "1",
            headers: "2",
          },
        ],
      });
    });
  }, 120_000);

  it("keeps B2a publication atomic when a late PostgreSQL invariant rolls back", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(persistence, "b2a_rollback");
      const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
        run: () => Effect.succeed(Object.freeze({ ok: true })),
      });
      const authentication = createO08B2aAuthentication(
        persistence,
        current,
        runner,
        {},
        {
          afterTransactionStep: (event) => {
            if (event.step === "wakeWritten") {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
            return Promise.resolve();
          },
        },
      );
      const prepared = await preparePostgresB2aConflict(
        persistence,
        current,
        authentication,
      );
      const authorized = await runEffect(
        authentication.authorizePointMutationOccRerun(prepared.conflict).pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
      );
      if (authorized.kind !== "authorized") {
        throw new Error("Expected the rollback B2a handoff to authorize.");
      }

      expect(
        await runFailure(
          authentication.executeAuthorizedPointMutationOccRerun(
            authorized.rerun,
          ),
        ),
      ).toBeInstanceOf(PointCommitCorruptionV1Error);
      await expect(
        persistence.query<{
          lifecycle: string;
          leases: string;
          journals: string;
          outcomes: string;
          wakes: string;
          headers: string;
          last_commit_seq: string;
        }>(
          `
          select session.lifecycle,
            (select count(*)::text from fx_system_snapshot_lease as lease
             where lease.scope_uuid = session.scope_uuid
               and lease.session_id = session.session_id) as leases,
            (select count(*)::text from fx_system_tx_journal as journal
             where journal.scope_uuid = session.scope_uuid
               and journal.session_id = session.session_id) as journals,
            (select count(*)::text from fx_system_idempotency as outcome
             where outcome.scope_uuid = session.scope_uuid) as outcomes,
            (select count(*)::text from fx_system_outbox as wake
             where wake.scope_uuid = session.scope_uuid) as wakes,
            (select count(*)::text from fx_system_commit as header
             where header.scope_uuid = session.scope_uuid) as headers,
            clock.last_commit_seq::text as last_commit_seq
          from fx_system_tx_session as session
          join fx_system_scope_clock as clock
            on clock.scope_uuid = session.scope_uuid
          where session.scope_uuid = $1 and session.session_id = $2
        `,
          [prepared.scopeUuid, current.anchor.sessionId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            lifecycle: "finishing",
            leases: "1",
            journals: "1",
            outcomes: "0",
            wakes: "0",
            headers: "1",
            last_commit_seq: "1",
          },
        ],
      });
    });
  }, 120_000);
});

interface Scenario {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly store: ReturnType<typeof createSessionJournalStorePersistenceV1>;
  readonly attempt: SessionJournalAttemptV1;
  readonly loader: ReturnType<typeof createStoredAttemptEvidenceLoaderV1>;
  readonly loading: ReturnType<
    typeof createPointMutationSessionAttemptLoadingV1
  >;
}

async function scenario(
  persistence: PostgresFlarexPersistence,
  label: string,
  loaderOptions: StoredAttemptEvidenceLoaderOptionsV1 = {},
): Promise<Scenario> {
  const randomUuid = uuidFactory("94000000");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_stored_attempt_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_stored_attempt_postgres_${label}`,
  );
  const locator = sharedLocator(`stored-attempt-${label}`);
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({
    deploymentId,
    projectId: `project_stored_attempt_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  const ports = resolutionPorts(persistence);
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      ports,
      { leaseDurationMilliseconds: 60_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      deploymentId,
      scopeId,
      { evidence: { schemaVersionId } },
    ),
  );
  const store = createSessionJournalStorePersistenceV1(ports, {
    randomUuid,
  });
  const attempt = await runEffect(
    store.openAttemptEffect({
      selector: {
        deploymentId,
        scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }),
  );
  return Object.freeze({
    anchor: activation.anchor,
    authority: Object.freeze({
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
      storageGeneration: activation.anchor.storageGeneration,
      storageGenerationFence: activation.anchor.storageGenerationFence,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }),
    store,
    attempt,
    loader: createStoredAttemptEvidenceLoaderV1(ports, loaderOptions),
    loading: createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(ports),
    ),
  });
}

async function o08B1Scenario(
  persistence: PostgresFlarexPersistence,
  label: string,
) {
  const randomUuid = uuidFactory("94700000");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_o08b1_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_o08b1_postgres_${label}`,
  );
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    {
      physicalLocator: sharedLocator(`o08b1-${label}`),
      randomUuid,
    },
  ).ensure({
    deploymentId,
    projectId: `project_o08b1_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  const usersTable = appTable("users");
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [usersTable],
    indexes: [],
  });
  const target = decodeActivePointMutationTargetMetadataV1({
    format: "flarex.point-mutation-target-metadata",
    version: 1,
    deploymentId,
    scopeId,
    packageId: "package_o08b1_postgres",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"8".repeat(32)}`,
    sourcePackageHash: "8".repeat(64),
    schemaVersionId,
    functions: [{
      path: "users:create",
      executionModule: "flarex/users.ts",
      kind: "mutation",
      visibility: "public",
      argsValidator: { type: "object", value: {} },
      returnsValidator: {
        type: "object",
        value: {
          ok: { optional: false, fieldType: { type: "boolean" } },
        },
      },
    }],
    schemaManifest: {
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: {
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [{
          tableId: 1,
          namespace: "app",
          logicalName: usersTable.logicalName,
          definition: usersTable.definition,
        }],
      },
      indexBindings: {
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: [],
      },
    },
  });
  const requestKey = TransactionRequestKeyV1Schema.make(`request:${label}`);
  const revocationEpoch = TransactionAuthorizationRevocationEpochSchema.make(
    0n,
  );
  const prepared = await preparePointMutationStartEvidenceV1(
    target,
    {
      deploymentId,
      functionPath: TransactionFunctionPathV1Schema.make("users:create"),
      args: {},
      requestKey,
    },
    revocationEpoch,
  );
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth: { kind: "anonymous" },
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const issuedAtMilliseconds = Date.now() - 1_000;
  const expiresAtMilliseconds = Date.now() + 300_000;
  const payload = await canonicalizeTransactionGrantPayloadV1({
    format: "flarex.transaction-grant",
    version: 1,
    grantId: `grant_${label}`,
    ...prepared.logicalPins,
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256: policy.sha256Hex,
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    auth: { kind: "anonymous" },
    issuedAt: new Date(issuedAtMilliseconds).toISOString(),
    expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    authorizationRevocationEpoch: revocationEpoch.toString(),
  });
  const kid = TransactionGrantKeyIdV1Schema.make(`key_${label}`);
  const header = canonicalizeTransactionGrantProtectedHeaderV1({
    alg: "Ed25519",
    kid,
    typ: "flarex-transaction-grant+jws",
  });
  const grant = await deriveInertTransactionGrantEvidenceV1({
    protected: header.base64url,
    payload: payload.base64url,
    signature: encodeTransactionGrantEd25519SignatureV1(new Uint8Array(64)),
  });
  const ports = resolutionPorts(persistence);
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      ports,
      { leaseDurationMilliseconds: 60_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(deploymentId, scopeId, {
      evidence: {
        packageId: prepared.logicalPins.packageId,
        artifactRuntime: prepared.logicalPins.artifactRuntime,
        artifactId: prepared.logicalPins.artifactId,
        sourcePackageHash: prepared.logicalPins.sourcePackageHash,
        executionModule: prepared.logicalPins.executionModule,
        functionPath: prepared.logicalPins.functionPath,
        functionKind: prepared.logicalPins.functionKind,
        schemaVersionId: prepared.logicalPins.schemaVersionId,
        policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
        identityAccessPolicySha256:
          transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
            policy.sha256Hex,
          ),
        validatedArgsJson: structuredClone(
          prepared.validatedArguments.valueJson,
        ),
        validatedArgsValueCodecVersion:
          prepared.logicalPins.validatedArgsValueCodecVersion,
        validatedArgsCanonicalBytes:
          prepared.validatedArguments.canonicalBytes,
        validatedArgsSha256: prepared.validatedArguments.sha256,
        authorizationGrantId: grant.authorizationGrantId,
        authorizationGrantJson: structuredClone(grant.authorizationGrantJson),
        authorizationGrantValueCodecVersion:
          grant.authorizationGrantValueCodecVersion,
        authorizationGrantCanonicalBytes:
          grant.authorizationGrantCanonicalBytes,
        authorizationGrantSha256: grant.authorizationGrantSha256,
        authorizationRevocationEpoch: revocationEpoch,
        authorizationGrantExpiresAt: new Date(expiresAtMilliseconds),
        requestKey,
        requestSha256: prepared.requestEvidence.sha256,
      },
    }),
  );
  const store = createSessionJournalStorePersistenceV1(ports, { randomUuid });
  const attempt = await runEffect(store.openAttemptEffect({
    selector: {
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    },
    snapshotToken: activation.anchor.snapshotToken,
    schemaVersionId,
  }));
  const functionMetadata = target.functions[0];
  if (functionMetadata === undefined) {
    throw new Error("Missing O08-B1 function metadata fixture.");
  }
  const freshAttemptLoadLocks: PointMutationSessionAttemptLoadLockStepV1[] = [];
  return Object.freeze({
    anchor: activation.anchor,
    authority: Object.freeze({
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
      storageGeneration: activation.anchor.storageGeneration,
      storageGenerationFence: activation.anchor.storageGenerationFence,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }),
    store,
    attempt,
    loader: createStoredAttemptEvidenceLoaderV1(ports),
    loading: createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(resolutionPorts(
        persistence,
        {
          afterLoadLock: (step) => {
            freshAttemptLoadLocks.push(step);
          },
        },
      )),
    ),
    freshAttemptLoadLocks,
    verifier: createTransactionGrantVerifierV1({
      clock: { now: () => new Date(0) },
      verificationKeyNamespace:
        createTransactionGrantVerificationKeyNamespaceV1({
          deploymentId,
          keys: [{
            state: "active",
            kid,
            purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
            issuedAtInclusiveEpochMilliseconds: issuedAtMilliseconds - 1_000,
            verificationEndsAtExclusiveEpochMilliseconds:
              expiresAtMilliseconds + 1_000,
            verify: async () => true,
          }],
        }),
      maximumGrantLifetimeMilliseconds: 600_000,
      maximumFutureIssuedAtSkewMilliseconds: 0,
    }),
    functionSnapshot: Object.freeze({
      deploymentId,
      scopeId,
      packageId: prepared.logicalPins.packageId,
      artifactRuntime: prepared.logicalPins.artifactRuntime,
      artifactId: prepared.logicalPins.artifactId,
      sourcePackageHash: prepared.logicalPins.sourcePackageHash,
      executionModule: prepared.logicalPins.executionModule,
      functionPath: prepared.logicalPins.functionPath,
      functionKind: prepared.logicalPins.functionKind,
      schemaVersionId,
      functionMetadata: structuredClone(functionMetadata),
    }),
  });
}

function createO08B1Authentication(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  observedOutcomeKinds: string[] = [],
) {
  const ports = resolutionPorts(persistence);
  const publisher = createPointCommitPublisherPortV1(ports);
  const observedPublisher = Object.freeze({
    ...publisher,
    [RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1]: (
      ...args: Parameters<
        typeof publisher[
          typeof RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1
        ]
      >
    ) => publisher[
      RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1
    ](...args).pipe(
      Effect.tap((outcome) => Effect.sync(() => {
        observedOutcomeKinds.push(outcome.kind);
      })),
    ),
  });
  return createStoredAttemptAuthenticationV1(current.loader, {
    evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
    transactionGrantVerifier: current.verifier,
    functionMetadata: {
      load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
    },
    pointCommit: observedPublisher,
    pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
    pointMutationAttemptReplacement:
      createPointMutationAttemptReplacementPortV1(ports, {
        leaseDurationMilliseconds: 60_000,
      }),
    pointMutationOccRerun: { attemptLoading: current.loading },
  });
}

function createO08B2aAuthentication(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  runner: PointMutationOccRuntimeNeutralRunnerV1,
  executionEvidenceOptions: StoredCommitAuthorityEvidenceLoaderOptionsV1 = {},
  publisherOptions: PointCommitTransactionProofOptionsV1 = {},
) {
  const ports = resolutionPorts(persistence);
  let executionSequence = 0;
  return createStoredAttemptAuthenticationV1(current.loader, {
    evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
    transactionGrantVerifier: current.verifier,
    functionMetadata: {
      load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
    },
    pointCommit: createPointCommitPublisherPortV1(ports, publisherOptions),
    pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
    pointMutationAttemptReplacement:
      createPointMutationAttemptReplacementPortV1(ports, {
        leaseDurationMilliseconds: 60_000,
      }),
    pointMutationOccRerun: {
      attemptLoading: current.loading,
      executionEvidence: createStoredOccExecutionEvidenceLoaderV1(
        ports,
        executionEvidenceOptions,
      ),
      journal: createPointMutationJournalV1(current.store),
      terminalization: createPointMutationSessionAttemptTerminalizationV1(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(ports),
      ),
      contextFactory: {
        make: () =>
          Effect.sync(() => {
            executionSequence += 1;
            return Object.freeze({
              executionId: `o08-b2a-postgres-${executionSequence}`,
              logScopeId: `o08-b2a-postgres-log-${executionSequence}`,
              randomSeed: new Uint8Array(32).fill(executionSequence),
            });
          }),
      },
      runner,
    },
  });
}

async function preparePostgresB2aConflict(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  authentication: ReturnType<typeof createO08B2aAuthentication>,
) {
  const table = await runEffect(
    current.store.resolvePointTableEffect(current.attempt, "users"),
  );
  await runPointOperation(current.store, table, {
    kind: "insert",
    syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
    fields: { name: "conflicted" },
  });
  const envelope = await sealScenario(current);
  const loadedAttempt = await runEffect(
    current.loading.load(selectorWire(current.anchor)),
  );
  const authority = await runEffect(
    authentication.deriveAuthority(loadedAttempt),
  );
  const authenticated = await runEffect(
    authentication.authenticate(authority, encodeEnvelope(envelope)),
  );
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(authenticated),
  );
  const verified = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  const running = await runEffect(authentication.planPointCommit(verified));
  const finishing = await runEffect(
    authentication.enterPointCommitFinishing(running),
  );
  const finishingStored = await runEffect(
    current.loader.loadFinishingEffect({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence,
    }),
  );
  if (finishingStored.kind !== "loaded") {
    throw new Error("Expected finishing PostgreSQL B2a evidence.");
  }
  await commitCompetingPointRow(
    persistence,
    await pointCommitCommandFromStoredAttemptV1(
      current.authority,
      finishingStored.evidence,
    ),
  );
  const conflict = await runFailure(
    authentication.publishPointCommit(finishing),
  );
  if (!(conflict instanceof PointCommitConflictV1Error)) {
    throw new Error("Expected a genuine PostgreSQL B2a conflict.");
  }
  return Object.freeze({
    conflict,
    scopeUuid: finishingStored.evidence.scopeUuid,
  });
}

async function assertNoOpenExecutionEvidenceTransaction(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const client = await persistence.pool.connect();
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;
    await client.query("set local lock_timeout = '2s'");
    await client.query(`
      lock table
        fx_system_scope_clock,
        fx_system_tx_session,
        fx_system_snapshot_lease,
        fx_system_tx_journal,
        fx_system_tx_journal_latest_receipt,
        fx_system_tx_journal_point,
        fx_system_tx_journal_write_event,
        fx_control_schema_version,
        fx_control_table
      in access exclusive mode nowait
    `);
    await client.query("rollback");
    transactionOpen = false;
  } finally {
    if (transactionOpen) {
      await client.query("rollback").catch(() => undefined);
    }
    client.release();
  }
}

async function sealScenario(current: Scenario) {
  const prepared = await prepareSeal(current.store, current.attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  return completeSeal(current.store, prepared.preparation, journal, result);
}

async function commitCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<void> {
  const intent = command.rowIntent;
  if (intent === null || intent.kind !== "live") {
    throw new Error("O08-B1 competing writer requires a live intent.");
  }
  const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
  if (clock === null) throw new Error("Missing O08-B1 scope clock.");
  const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
  const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
  const document = await canonicalizeFlarexValueV1(
    intent.value,
    "appDocument",
  );
  await persistence.drizzle.transaction(async (tx) => {
    await tx
      .select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
      .from(fxSystemScopeClocks)
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ))
      .limit(1)
      .for("update");
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: command.authorityPins.schemaVersionId,
      creationTime: intent.creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.insert(fxSystemCommits).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeCount: 1,
    });
    await tx.insert(fxSystemCommitAppRowChanges).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeOrdinal: 0,
      tableId: intent.tableId,
      rowId: appRowIdHexV1ToBytes(intent.rowId),
    });
    await tx
      .update(fxSystemScopeClocks)
      .set({ lastCommitSeq: commitSeq })
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ));
  });
}

async function expectFreshO08B1Attempt(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<void> {
  const state = await persistence.query<{
    lifecycle: string;
    attempt_fence: string;
    lease_count: string;
    root_state: string;
    last_syscall_sequence: string;
    receipt_count: string;
    point_count: string;
    event_count: string;
  }>(
    `
      select session.lifecycle,
        session.attempt_fence::text,
        (select count(*)::text from fx_system_snapshot_lease lease
          where lease.scope_uuid = session.scope_uuid
            and lease.session_id = session.session_id
            and lease.attempt_fence = session.attempt_fence) as lease_count,
        journal.state as root_state,
        journal.last_syscall_sequence::text,
        (select count(*)::text from fx_system_tx_journal_latest_receipt receipt
          where receipt.scope_uuid = session.scope_uuid
            and receipt.session_id = session.session_id
            and receipt.attempt_fence = session.attempt_fence)
          as receipt_count,
        (select count(*)::text from fx_system_tx_journal_point point
          where point.scope_uuid = session.scope_uuid
            and point.session_id = session.session_id
            and point.attempt_fence = session.attempt_fence) as point_count,
        (select count(*)::text from fx_system_tx_journal_write_event event
          where event.scope_uuid = session.scope_uuid
            and event.session_id = session.session_id
            and event.attempt_fence = session.attempt_fence) as event_count
      from fx_system_tx_session session
      join fx_system_tx_journal journal
        on journal.scope_uuid = session.scope_uuid
        and journal.session_id = session.session_id
        and journal.attempt_fence = session.attempt_fence
      where session.scope_uuid = $1 and session.session_id = $2
    `,
    [scopeUuid, sessionId],
  );
  expect(state.rows[0]).toEqual({
    lifecycle: "running",
    attempt_fence: "2",
    lease_count: "1",
    root_state: "open",
    last_syscall_sequence: "0",
    receipt_count: "0",
    point_count: "0",
    event_count: "0",
  });
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    for (const { table, index } of [
      {
        table: "fx_system_tx_journal_latest_receipt",
        index: "fx_system_tx_journal_receipt_pk",
      },
      {
        table: "fx_system_tx_journal_point",
        index: "fx_system_tx_journal_point_pk",
      },
      {
        table: "fx_system_tx_journal_write_event",
        index: "fx_system_tx_journal_event_pk",
      },
    ] as const) {
      const plan = await client.query<Record<"QUERY PLAN", string>>(
        `
          explain (format text)
          select 1 from ${table}
          where scope_uuid = $1
            and session_id = $2
            and attempt_fence = 2
          limit 1
        `,
        [scopeUuid, sessionId],
      );
      const rendered = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(rendered).toContain("Index");
      expect(rendered).toContain(index);
    }
  } finally {
    client.release();
  }
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        ),
    },
  };
}

function commitAuthorityFromStoredEvidence(
  authority: Scenario["authority"],
  evidence: Extract<
    StoredAttemptEvidenceLoadResultV1,
    { readonly kind: "loaded" }
  >["evidence"],
): StoredCommitAuthorityEvidenceAuthorityV1 {
  return Object.freeze({
    ...authority,
    session: Object.freeze(structuredClone(evidence.session)),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle: evidence.session.lifecycle,
      sessionUpdatedAtMilliseconds: evidence.session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: evidence.root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: evidence.root.updatedAtMilliseconds,
      sealedAtMilliseconds: evidence.root.sealedAtMilliseconds,
      finalSyscallSequence: evidence.root.sealedFinalSyscallSequence,
      creationTimeSeed: evidence.root.creationTimeSeed,
      nextCreationTime: evidence.root.nextCreationTime,
      journalFormat: SESSION_JOURNAL_FORMAT_V1,
      journalProtocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      journalValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      journalByteLength: evidence.root.journalBytes.byteLength,
      journalSha256: new Uint8Array(evidence.root.journalSha256),
      resultValueCodecVersion: evidence.root.resultValueCodecVersion,
      resultSemanticBytes: evidence.root.resultSemanticBytes,
      resultByteLength: evidence.root.resultBytes.byteLength,
      resultSha256: new Uint8Array(evidence.root.resultSha256),
      readDocuments: evidence.root.readDocuments,
      readSemanticBytes: evidence.root.readSemanticBytes,
      pointDependencyCount: evidence.root.pointDependencyCount,
      writeOperations: evidence.root.writeOperations,
      writeSemanticBytes: evidence.root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        evidence.root.materialWriteEventEvidenceBytes,
    }),
  });
}

function selectorWire(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorWireV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence.toString(),
  });
}

function sharedLocator(
  databaseKey: string,
): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

async function attemptTimestamps(
  persistence: PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
): Promise<Readonly<Record<string, string>>> {
  const result = await persistence.query<Readonly<Record<string, string>>>(
    `
      select
        (select updated_at::text from fx_system_tx_session
          where session_id = $1) as session_updated_at,
        (select updated_at::text from fx_system_tx_journal
          where session_id = $1) as root_updated_at
    `,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing attempt timestamps.");
  return row;
}

async function lookupPlans(
  persistence: PostgresFlarexPersistence,
  queries: ReadonlyMap<
    StoredAttemptEvidenceQueryV1["name"],
    StoredAttemptEvidenceQueryV1
  >,
): Promise<Readonly<Record<
  "session" | "sessionPrimaryKey" | "lease" | "root" | "points",
  string
>>> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const sessionPrimaryKey = await client.query<{ definition: string }>(`
      select pg_get_indexdef(indexrelid) as definition
      from pg_index
      where indrelid = 'fx_system_tx_session'::regclass
        and indisprimary
    `);
    const sessionPrimaryKeyDefinition =
      sessionPrimaryKey.rows[0]?.definition;
    if (sessionPrimaryKeyDefinition === undefined) {
      throw new Error("Missing transaction-session primary key.");
    }
    return Object.freeze({
      session: await explainObserved(
        client,
        requireObservedQuery(queries, "session"),
      ),
      sessionPrimaryKey: sessionPrimaryKeyDefinition,
      lease: await explainObserved(
        client,
        requireObservedQuery(queries, "lease"),
      ),
      root: await explainObserved(
        client,
        requireObservedQuery(queries, "root"),
      ),
      points: await explainObserved(
        client,
        requireObservedQuery(queries, "points"),
      ),
    });
  } finally {
    client.release();
  }
}

function requireCommitObservedQuery(
  queries: ReadonlyMap<
    StoredCommitAuthorityEvidenceQueryV1["name"],
    StoredCommitAuthorityEvidenceQueryV1
  >,
  name: StoredCommitAuthorityEvidenceQueryV1["name"],
): StoredCommitAuthorityEvidenceQueryV1 {
  const query = queries.get(name);
  if (query === undefined) {
    throw new Error(`C04B1 loader did not execute its ${name} query.`);
  }
  return query;
}

async function explainCommitAuthorityObserved(
  persistence: PostgresFlarexPersistence,
  query: StoredCommitAuthorityEvidenceQueryV1,
): Promise<string> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const result = await client.query(
      `explain (format json) ${query.sql}`,
      [...query.params],
    );
    return JSON.stringify(result.rows);
  } finally {
    client.release();
  }
}

function requireObservedQuery(
  queries: ReadonlyMap<
    StoredAttemptEvidenceQueryV1["name"],
    StoredAttemptEvidenceQueryV1
  >,
  name: StoredAttemptEvidenceQueryV1["name"],
): StoredAttemptEvidenceQueryV1 {
  const query = queries.get(name);
  if (query === undefined) {
    throw new Error(`Loader did not execute its ${name} query.`);
  }
  return query;
}

async function explainObserved(
  client: {
    query(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  },
  query: StoredAttemptEvidenceQueryV1,
): Promise<string> {
  const result = await client.query(
    `explain (format json) ${query.sql}`,
    query.params,
  );
  return JSON.stringify(result.rows);
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}
