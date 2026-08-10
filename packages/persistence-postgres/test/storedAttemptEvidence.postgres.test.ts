import { eq } from "drizzle-orm";
import { Effect, Exit, Fiber, Random, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { setTimeout as delay } from "node:timers/promises";
import { Client, type PoolClient } from "pg";
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
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
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
  projectScopeIdUuidV1,
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
  type PointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../../executor/src/pointMutationSessionActivation";
import { createPointMutationSessionAttemptDispositionV1 } from
  "../../executor/src/pointMutationSessionAttemptDisposition";
import { createPointMutationAttemptRedeliveryV1 } from
  "../../executor/src/pointMutationAttemptRedelivery";
import {
  createPointMutationMultiScopeRedeliveryV1,
  type PointMutationMultiScopeRedeliveryV1,
} from
  "../../executor/src/pointMutationMultiScopeRedelivery";
import {
  createPointMutationRedeliverySchedulerRunV1,
  type PointMutationRedeliverySchedulerCheckpointPortV1,
} from "../../executor/src/pointMutationRedeliverySchedulerRun";
import { decodePointMutationSessionAttemptSelectorV1 } from
  "../../executor/src/pointMutationSessionAttemptSelector";
import { createPointMutationJournalV1 } from "../../executor/src/pointMutationJournal";
import { SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1 } from
  "./applicationRevisionSyscallValidatorTestSupport";
import {
  createPointMutationExecutionClaimVaultV1,
  type PointMutationExecutionClaimVaultV1,
  type PointMutationExecutionScopeV1,
} from "../../executor/src/pointMutationExecutionClaim";
import {
  createPointMutationExecutionClaimDispatchAcquisitionV1,
  type PointMutationExecutionClaimDispatchAcquisitionV1,
} from "../../executor/src/pointMutationExecutionClaimAcquisition";
import {
  createStoredAttemptAuthenticationV1,
  createStoredPointCommitExecutorV1,
  createStoredPointMutationCrashRedispatchV1,
  createStoredPointMutationOccRerunAuthorizationV1,
  createStoredPointMutationOccRerunExecutionV1,
  InvalidAuthorizedPointMutationOccRerunV1Error,
  PointCommitKnownSettledSqlRetryExhaustedV1Error,
  PointCommitUncertainOutcomeUnresolvedV1Error,
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
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  type PointCommitPublicationCommandV1,
  type PointCommitOutcomeResolutionPortV1,
  type PointCommitPublisherPortV1,
  type PointCommitTransactionCommandV1,
  type PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../src/postgresLocatedReadCommitted";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { createPointMutationAttemptDiscoveryV1 } from
  "../src/pointMutationAttemptDiscovery";
import {
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfigurationV1Error,
  createPointMutationRedeliverySchedulerCheckpointV1,
  isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerCheckpointConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerReleaseConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error,
  type PointMutationRedeliverySchedulerAcquireV1Error,
  type PointMutationRedeliverySchedulerCheckpointV1,
  type PointMutationRedeliverySchedulerCheckpointV1Error,
  type PointMutationRedeliverySchedulerReleaseV1Error,
  type PointMutationRedeliverySchedulerRenewV1Error,
  type PointMutationRedeliverySchedulerRunV1,
} from "../src/pointMutationRedeliverySchedulerCheckpoint";
import { POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1 } from
  "../src/pointMutationRedeliverySchedulerModel";
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
  createLocatedPointMutationSessionActivationTargetV1,
  createPointMutationExecutionClaimAcquisitionV1,
  PointMutationExecutionClaimAcquisitionStaleV1Error,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptLoadLockStepV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  LocatedReadCommittedTransactionFailureV1,
  isLocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import {
  createPointMutationExecutionClaimLivenessV1,
  type PointMutationExecutionClaimLivenessV1,
} from
  "../src/transactionExecutionClaimLiveness";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
  withPostgresSequentialScansDisabled,
} from "./postgresHelpers";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgresPersistence = useFileScopedPostgresPersistence();
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

describePostgres("real Postgres stored-attempt authority", () => {
  it("closes repeatable read before hashing and binds one complete sealed snapshot", async () => {
    await withPostgresPersistence(async (persistence) => {
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
        current.executionClaims,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt, current.executionScope),
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
    await withPostgresPersistence(async (persistence) => {
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
        "executionClaim",
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
        racing.executionClaims,
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt, racing.executionScope),
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
        authentication.deriveAuthority(loadedAttempt, current.executionScope),
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
        "executionClaimLocked",
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
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(persistence, "b2a_execution");
      const table = await runEffect(
        current.store.resolvePointTableEffect(current.attempt, "users"),
      );
      await persistence.query(
        `
          with shortened_authority as (
            update fx_system_tx_session
            set hard_expires_at =
              authorization_grant_expires_at - interval '5 seconds'
            where session_id = $1
            returning scope_uuid, session_id, attempt_fence, hard_expires_at
          )
          update fx_system_snapshot_lease as lease
          set lease_expires_at =
            authority.hard_expires_at - interval '1 second'
          from shortened_authority as authority
          where lease.scope_uuid = authority.scope_uuid
            and lease.session_id = authority.session_id
            and lease.attempt_fence = authority.attempt_fence
        `,
        [current.anchor.sessionId],
      );
      await runPointOperation(current.store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        fields: { name: "conflicted" },
      });
      const envelope = await sealScenario(current);
      const promoted = await persistence.query<{
        authorization_grant_expires_at: Date;
        hard_expires_at: Date;
        lease_expires_at: Date;
      }>(
        `
          select
            session.authorization_grant_expires_at,
            session.hard_expires_at,
            lease.lease_expires_at
          from fx_system_tx_session as session
          join fx_system_snapshot_lease as lease
            on lease.scope_uuid = session.scope_uuid
           and lease.session_id = session.session_id
           and lease.attempt_fence = session.attempt_fence
          where session.session_id = $1
        `,
        [current.anchor.sessionId],
      );
      const promotedRow = promoted.rows[0];
      if (promotedRow === undefined) {
        throw new Error("Expected promoted B2a PostgreSQL seal authority.");
      }
      expect(promotedRow.lease_expires_at.getTime()).toBe(
        promotedRow.hard_expires_at.getTime(),
      );
      expect(promotedRow.authorization_grant_expires_at.getTime())
        .toBeGreaterThan(promotedRow.hard_expires_at.getTime());
      const loadedAttempt = await runEffect(
        current.loading.load(selectorWire(current.anchor)),
      );
      let repeatableReadClosed = false;
      let runnerCalls = 0;
      let livenessRenewals = 0;
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
              await delay(1_100);
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
        {},
        Object.freeze({
          heartbeatIntervalMilliseconds: 500,
          observeRenewal: () => {
            livenessRenewals += 1;
          },
        }),
      );
      const authority = await runEffect(
        authentication.deriveAuthority(loadedAttempt, current.executionScope),
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
      expect(livenessRenewals).toBeGreaterThanOrEqual(2);
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

  it("serializes fresh-process pristine redispatch and publishes exactly once", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(persistence, "b2b2a_redispatch");
      await persistence.query(
        `update fx_system_tx_execution_claim
         set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
         where session_id = $1`,
        [current.anchor.sessionId],
      );

      const runnerEntered = deferredSignal();
      const releaseRunner = deferredSignal();
      const observedQueries = new Map<
        StoredCommitAuthorityEvidenceQueryV1["name"],
        StoredCommitAuthorityEvidenceQueryV1
      >();
      let repeatableReadClosed = false;
      let runnerCalls = 0;
      const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
        run: () =>
          Effect.tryPromise({
            try: async () => {
              runnerCalls += 1;
              expect(repeatableReadClosed).toBe(true);
              await assertNoOpenExecutionEvidenceTransaction(persistence);
              runnerEntered.resolve();
              await releaseRunner.promise;
              return Object.freeze({ ok: true });
            },
            catch: (cause) => new PointMutationOccUserCodeV1Error({ cause }),
          }),
      });
      const first = createB2b2aRedispatchAuthentication(
        persistence,
        current,
        createPointMutationExecutionClaimVaultV1(),
        runner,
        () => "95000000-0000-4000-8000-000000000001",
        {
          afterRepeatableRead: () => {
            repeatableReadClosed = true;
          },
          observeQuery: (query) => observedQueries.set(query.name, query),
        },
      );
      const second = createB2b2aRedispatchAuthentication(
        persistence,
        current,
        createPointMutationExecutionClaimVaultV1(),
        runner,
        () => "95000000-0000-4000-8000-000000000002",
      );
      const selector = selectorWire(current.anchor);
      const firstPublication = runEffect(
        first.redispatchExactPointMutationAttempt(selector),
      );
      await runnerEntered.promise;

      await expect(runEffect(
        second.redispatchExactPointMutationAttempt(selector),
      )).resolves.toEqual({ kind: "busy" });
      await expect(prepareSeal(current.store, current.attempt)).rejects
        .toMatchObject({
          _tag: "SessionJournalAttemptUnavailableV1Error",
          issue: { reason: "executionClaimUnavailable" },
        });

      releaseRunner.resolve();
      await expect(firstPublication).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
        successfulResult: { valueJson: { ok: true } },
      });
      await expect(runEffect(
        second.redispatchExactPointMutationAttempt(selector),
      )).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(runnerCalls).toBe(1);

      const claimQuery = requireCommitObservedQuery(
        observedQueries,
        "executionClaim",
      );
      expect(
        await explainCommitAuthorityObserved(persistence, claimQuery),
      ).toContain("fx_system_tx_execution_claim_pk");
      await expect(persistence.query<{
        lifecycle: string;
        claims: string;
        leases: string;
        journals: string;
        headers: string;
        changes: string;
        outcomes: string;
        wakes: string;
        last_commit_seq: string;
        last_outbox_seq: string;
      }>(
        `select session.lifecycle,
          (select count(*)::text from fx_system_tx_execution_claim claim
           where claim.scope_uuid = session.scope_uuid
             and claim.session_id = session.session_id) as claims,
          (select count(*)::text from fx_system_snapshot_lease lease
           where lease.scope_uuid = session.scope_uuid
             and lease.session_id = session.session_id) as leases,
          (select count(*)::text from fx_system_tx_journal journal
           where journal.scope_uuid = session.scope_uuid
             and journal.session_id = session.session_id) as journals,
          (select count(*)::text from fx_system_commit header
           where header.scope_uuid = session.scope_uuid) as headers,
          (select count(*)::text from fx_system_commit_app_row_change change
           where change.scope_uuid = session.scope_uuid) as changes,
          (select count(*)::text from fx_system_idempotency outcome
           where outcome.scope_uuid = session.scope_uuid) as outcomes,
          (select count(*)::text from fx_system_outbox wake
           where wake.scope_uuid = session.scope_uuid) as wakes,
          clock.last_commit_seq::text,
          clock.last_outbox_seq::text
         from fx_system_tx_session session
         join fx_system_scope_clock clock
           on clock.scope_uuid = session.scope_uuid
         where session.session_id = $1`,
        [current.anchor.sessionId],
      )).resolves.toEqual({ rows: [{
        lifecycle: "committed",
        claims: "0",
        leases: "0",
        journals: "0",
        headers: "1",
        changes: "0",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      }] });
    });
  }, 120_000);

  it("discovers and redispatches one bounded page through the exact-selector composer", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2a_page",
      );
      await persistence.query(
        `update fx_system_tx_execution_claim
         set claimed_at = date_trunc(
             'milliseconds',
             clock_timestamp() - interval '2 minutes'
           ),
           claim_expires_at = date_trunc(
             'milliseconds',
             clock_timestamp() - interval '1 minute'
           )
         where session_id = $1`,
        [current.anchor.sessionId],
      );
      let runnerCalls = 0;
      const authentication = createB2b2aRedispatchAuthentication(
        persistence,
        current,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            runnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000003",
      );
      const redelivery = createPointMutationAttemptRedeliveryV1(
        pointMutationAttemptDiscovery(persistence),
        authentication,
      );

      const page = await runEffect(redelivery.sweepEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        limit: 100,
      }));
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        candidate: {
          selector: {
            deploymentId: current.anchor.deploymentId,
            scopeId: current.anchor.scopeId,
            sessionId: current.anchor.sessionId,
            attemptFence: current.anchor.attemptFence,
          },
          source: "expiredClaim",
        },
        disposition: {
          kind: "published",
          token: { commitSeq: 1n },
        },
      });
      expect(page.items[0]?.disposition)
        .not.toHaveProperty("successfulResult");
      expect(runnerCalls).toBe(1);

      await expect(runEffect(redelivery.sweepEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        limit: 100,
      }))).resolves.toMatchObject({ items: [], continuation: null });
      expect(runnerCalls).toBe(1);
    });
  }, 120_000);

  it("recovers a partially applied page without duplicate publication", async () => {
    await withPostgresPersistence(async (persistence) => {
      const first = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2a_partial_first",
      );
      const second = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2a_partial_second",
      );
      for (const current of [first, second]) {
        await persistence.query(
          `update fx_system_tx_execution_claim
           set claimed_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '2 minutes'
             ),
             claim_expires_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '1 minute'
             )
           where session_id = $1`,
          [current.anchor.sessionId],
        );
      }
      let firstRunnerCalls = 0;
      let secondRunnerCalls = 0;
      const firstAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        first,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            firstRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000004",
      );
      const secondAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        second,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            secondRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000005",
      );
      const candidates = Object.freeze([first, second].map((current) =>
        Object.freeze({
          selector: Object.freeze({
            deploymentId: current.anchor.deploymentId,
            scopeId: current.anchor.scopeId,
            sessionId: current.anchor.sessionId,
            attemptFence: current.anchor.attemptFence,
          }),
          source: "expiredClaim" as const,
          eligibleAt: "2026-07-21T00:00:00.000Z",
        })
      ));
      const injectedFailure =
        new PointMutationExecutionClaimAcquisitionStaleV1Error({
          reason: "attemptReplaced",
        });
      let failSecond = true;
      const redelivery = createPointMutationAttemptRedeliveryV1(
        Object.freeze({
          discoverEffect: () => Effect.succeed(Object.freeze({
            horizon: "2026-07-21T00:00:01.000Z",
            candidates,
            continuation: null,
          })),
        }),
        Object.freeze({
          redispatchExactPointMutationAttempt: (input: unknown) => {
            const selector = decodePointMutationSessionAttemptSelectorV1(
              input,
            );
            if (selector.sessionId === first.anchor.sessionId) {
              return firstAuthentication
                .redispatchExactPointMutationAttempt(input);
            }
            if (failSecond) return Effect.fail(injectedFailure);
            return secondAuthentication
              .redispatchExactPointMutationAttempt(input);
          },
        }),
      );

      await expect(runFailure(redelivery.sweepEffect({})))
        .resolves.toBe(injectedFailure);
      expect(firstRunnerCalls).toBe(1);
      expect(secondRunnerCalls).toBe(0);

      failSecond = false;
      const recovered = await runEffect(redelivery.sweepEffect({}));
      expect(recovered.items.map(({ disposition }) => disposition.kind))
        .toEqual(["replayed", "published"]);
      expect(firstRunnerCalls).toBe(1);
      expect(secondRunnerCalls).toBe(1);

      for (const current of [first, second]) {
        const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
        await expect(persistence.query<{
          last_commit_seq: string;
          last_outbox_seq: string;
          headers: string;
          outcomes: string;
          wakes: string;
        }>(
          `select clock.last_commit_seq::text,
             clock.last_outbox_seq::text,
             (select count(*)::text from fx_system_commit header
              where header.scope_uuid = clock.scope_uuid) as headers,
             (select count(*)::text from fx_system_idempotency outcome
              where outcome.scope_uuid = clock.scope_uuid) as outcomes,
             (select count(*)::text from fx_system_outbox wake
              where wake.scope_uuid = clock.scope_uuid) as wakes
           from fx_system_scope_clock clock
           where clock.scope_uuid = $1`,
          [scopeUuid],
        )).resolves.toEqual({ rows: [{
          last_commit_seq: "1",
          last_outbox_seq: "1",
          headers: "1",
          outcomes: "1",
          wakes: "1",
        }] });
      }
    });
  }, 120_000);

  it("continues independent scopes after a typed failure and a fresh sweep publishes without gaps", async () => {
    await withPostgresPersistence(async (persistence) => {
      const first = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2b2a_multi_first",
      );
      const second = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2b2a_multi_second",
      );
      for (const current of [first, second]) {
        await persistence.query(
          `update fx_system_tx_execution_claim
           set claimed_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '2 minutes'
             ),
             claim_expires_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '1 minute'
             )
           where session_id = $1`,
          [current.anchor.sessionId],
        );
      }
      let firstRunnerCalls = 0;
      let secondRunnerCalls = 0;
      const firstAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        first,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            firstRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000006",
      );
      const secondAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        second,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            secondRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000007",
      );
      const injectedFailure =
        new PointMutationExecutionClaimAcquisitionStaleV1Error({
          reason: "attemptReplaced",
        });
      let failSecond = true;
      const redelivery = createPointMutationAttemptRedeliveryV1(
        pointMutationAttemptDiscovery(persistence),
        Object.freeze({
          redispatchExactPointMutationAttempt: (input: unknown) => {
            const selector = decodePointMutationSessionAttemptSelectorV1(
              input,
            );
            if (selector.scopeId === first.anchor.scopeId) {
              return firstAuthentication.redispatchExactPointMutationAttempt(
                input,
              );
            }
            if (failSecond) return Effect.fail(injectedFailure);
            return secondAuthentication.redispatchExactPointMutationAttempt(
              input,
            );
          },
        }),
      );
      const scopeCandidates = Object.freeze([first, second].map((current) =>
        Object.freeze({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
        })
      ));
      const multiScope = createPointMutationMultiScopeRedeliveryV1(
        Object.freeze({
          discoverEffect: () => Effect.succeed(Object.freeze({
            candidates: scopeCandidates,
            continuation: null,
          })),
        }),
        redelivery,
      );
      const sweepInput = Object.freeze({
        scopeLimit: 100,
        maxAttemptPages: 2,
        maxCandidateAttempts: 2,
      });

      const partial = await runEffect(multiScope.sweepEffect(sweepInput));
      expect(partial.scopes.map((scope) => scope.kind)).toEqual([
        "processed",
        "failed",
      ]);
      expect(partial.scopes[1]).toMatchObject({
        kind: "failed",
        error: injectedFailure,
      });
      expect(firstRunnerCalls).toBe(1);
      expect(secondRunnerCalls).toBe(0);

      failSecond = false;
      const recovered = await runEffect(multiScope.sweepEffect(sweepInput));
      expect(recovered.scopes.map((scope) =>
        scope.kind === "processed"
          ? scope.page.items[0]?.disposition.kind
          : scope.kind
      )).toEqual([undefined, "published"]);
      expect(firstRunnerCalls).toBe(1);
      expect(secondRunnerCalls).toBe(1);

      for (const current of [first, second]) {
        const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
        await expect(persistence.query<{
          readonly last_commit_seq: string;
          readonly last_outbox_seq: string;
          readonly headers: string;
          readonly outcomes: string;
          readonly wakes: string;
        }>(
          `select clock.last_commit_seq::text,
             clock.last_outbox_seq::text,
             (select count(*)::text from fx_system_commit header
              where header.scope_uuid = clock.scope_uuid) as headers,
             (select count(*)::text from fx_system_idempotency outcome
              where outcome.scope_uuid = clock.scope_uuid) as outcomes,
             (select count(*)::text from fx_system_outbox wake
              where wake.scope_uuid = clock.scope_uuid) as wakes
           from fx_system_scope_clock clock
           where clock.scope_uuid = $1`,
          [scopeUuid],
        )).resolves.toEqual({ rows: [{
          last_commit_seq: "1",
          last_outbox_seq: "1",
          headers: "1",
          outcomes: "1",
          wakes: "1",
        }] });
      }
    });
  }, 120_000);

  it("serializes overlapping scheduler runs before dense multi-scope publication", async () => {
    await withPostgresPersistence(async (persistence) => {
      const first = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2b2a_concurrent_first",
      );
      const second = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2b2a_concurrent_second",
      );
      for (const current of [first, second]) {
        await persistence.query(
          `update fx_system_tx_execution_claim
           set claimed_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '2 minutes'
             ),
             claim_expires_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '1 minute'
             )
           where session_id = $1`,
          [current.anchor.sessionId],
        );
      }
      let firstRunnerCalls = 0;
      let secondRunnerCalls = 0;
      const firstAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        first,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            firstRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000008",
      );
      const secondAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        second,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            secondRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000009",
      );
      const redelivery = createPointMutationAttemptRedeliveryV1(
        pointMutationAttemptDiscovery(persistence),
        Object.freeze({
          redispatchExactPointMutationAttempt: (input: unknown) => {
            const selector = decodePointMutationSessionAttemptSelectorV1(
              input,
            );
            return selector.scopeId === first.anchor.scopeId
              ? firstAuthentication.redispatchExactPointMutationAttempt(input)
              : secondAuthentication.redispatchExactPointMutationAttempt(input);
          },
        }),
      );
      const scopes = Object.freeze([first, second].map((current) =>
        Object.freeze({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
        })
      ));
      const multiScope = createPointMutationMultiScopeRedeliveryV1(
        Object.freeze({
          discoverEffect: () => Effect.succeed(Object.freeze({
            candidates: scopes,
            continuation: null,
          })),
        }),
        redelivery,
      );
      const sweepInput = Object.freeze({
        scopeLimit: 100,
        maxAttemptPages: 2,
        maxCandidateAttempts: 2,
      });
      await installSchedulerSingleton(persistence);

      const [left, right] = await Promise.all([
        runEffect(schedulerRun(
          persistence,
          "97000000-0000-4000-8000-000000000001",
          multiScope,
          sweepInput,
        ).runEffect()),
        runEffect(schedulerRun(
          persistence,
          "97000000-0000-4000-8000-000000000002",
          multiScope,
          sweepInput,
        ).runEffect()),
      ]);
      expect([left.kind, right.kind].sort()).toEqual(["busy", "completed"]);
      const completed = left.kind === "completed"
        ? left
        : right.kind === "completed"
        ? right
        : undefined;
      if (completed === undefined) throw new Error("Expected one scheduler run.");
      expect(completed.batches.flatMap((result) => result.scopes).every((scope) =>
        scope.kind === "processed"
      )).toBe(true);
      expect(firstRunnerCalls).toBe(1);
      expect(secondRunnerCalls).toBe(1);
      for (const current of [first, second]) {
        const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
        const durable = await persistence.query<{
          readonly last_commit_seq: string;
          readonly last_outbox_seq: string;
          readonly headers: string;
          readonly outcomes: string;
          readonly wakes: string;
        }>(
          `select clock.last_commit_seq::text,
             clock.last_outbox_seq::text,
             (select count(*)::text from fx_system_commit header
              where header.scope_uuid = clock.scope_uuid) as headers,
             (select count(*)::text from fx_system_idempotency outcome
              where outcome.scope_uuid = clock.scope_uuid) as outcomes,
             (select count(*)::text from fx_system_outbox wake
              where wake.scope_uuid = clock.scope_uuid) as wakes
           from fx_system_scope_clock clock
           where clock.scope_uuid = $1`,
          [scopeUuid],
        );
        expect(durable.rows).toEqual([{
          last_commit_seq: "1",
          last_outbox_seq: "1",
          headers: "1",
          outcomes: "1",
          wakes: "1",
        }]);
      }
    });
  }, 120_000);

  it("keeps duplicate raw multi-scope orchestrators authority-safe under concurrency", async () => {
    await withPostgresPersistence(async (persistence) => {
      const first = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2b2a_raw_concurrent_first",
      );
      const second = await o08B1Scenario(
        persistence,
        "b2b2b2b1b2b2a_raw_concurrent_second",
      );
      for (const current of [first, second]) {
        await persistence.query(
          `update fx_system_tx_execution_claim
           set claimed_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '2 minutes'
             ),
             claim_expires_at = date_trunc(
               'milliseconds',
               clock_timestamp() - interval '1 minute'
             )
           where session_id = $1`,
          [current.anchor.sessionId],
        );
      }
      let firstRunnerCalls = 0;
      let secondRunnerCalls = 0;
      const firstAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        first,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            firstRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000010",
      );
      const secondAuthentication = createB2b2aRedispatchAuthentication(
        persistence,
        second,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => {
            secondRunnerCalls += 1;
            return Effect.succeed(Object.freeze({ ok: true }));
          },
        }),
        () => "95000000-0000-4000-8000-000000000011",
      );
      const redelivery = createPointMutationAttemptRedeliveryV1(
        pointMutationAttemptDiscovery(persistence),
        Object.freeze({
          redispatchExactPointMutationAttempt: (input: unknown) => {
            const selector = decodePointMutationSessionAttemptSelectorV1(
              input,
            );
            return selector.scopeId === first.anchor.scopeId
              ? firstAuthentication.redispatchExactPointMutationAttempt(input)
              : secondAuthentication.redispatchExactPointMutationAttempt(input);
          },
        }),
      );
      const scopes = Object.freeze([first, second].map((current) =>
        Object.freeze({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
        })
      ));
      const multiScope = createPointMutationMultiScopeRedeliveryV1(
        Object.freeze({
          discoverEffect: () => Effect.succeed(Object.freeze({
            candidates: scopes,
            continuation: null,
          })),
        }),
        redelivery,
      );
      const sweepInput = Object.freeze({
        scopeLimit: 100,
        maxAttemptPages: 2,
        maxCandidateAttempts: 2,
      });

      const [left, right] = await Promise.all([
        runEffect(multiScope.sweepEffect(sweepInput)),
        runEffect(multiScope.sweepEffect(sweepInput)),
      ]);
      expect([left, right].flatMap((result) => result.scopes).every((scope) =>
        scope.kind === "processed"
      )).toBe(true);
      expect(firstRunnerCalls).toBe(1);
      expect(secondRunnerCalls).toBe(1);
      for (const current of [first, second]) {
        const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
        const durable = await persistence.query<{
          readonly last_commit_seq: string;
          readonly last_outbox_seq: string;
          readonly headers: string;
          readonly outcomes: string;
          readonly wakes: string;
        }>(
          `select clock.last_commit_seq::text,
             clock.last_outbox_seq::text,
             (select count(*)::text from fx_system_commit header
              where header.scope_uuid = clock.scope_uuid) as headers,
             (select count(*)::text from fx_system_idempotency outcome
              where outcome.scope_uuid = clock.scope_uuid) as outcomes,
             (select count(*)::text from fx_system_outbox wake
              where wake.scope_uuid = clock.scope_uuid) as wakes
           from fx_system_scope_clock clock
           where clock.scope_uuid = $1`,
          [scopeUuid],
        );
        expect(durable.rows).toEqual([{
          last_commit_seq: "1",
          last_outbox_seq: "1",
          headers: "1",
          outcomes: "1",
          wakes: "1",
        }]);
      }
    });
  }, 120_000);

  it("serializes abort-only takeover and durably closes dirty or failed attempts", async () => {
    await withPostgresPersistence(async (persistence) => {
      let runnerCalls = 0;
      const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
        run: () => {
          runnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      });

      for (const reason of ["dirtyOpen", "failedRoot"] as const) {
        const current = await o08B1Scenario(
          persistence,
          `b2b2b2a_${reason}`,
        );
        const table = await runEffect(
          current.store.resolvePointTableEffect(current.attempt, "users"),
        );
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { reason },
        });
        if (reason === "failedRoot") {
          await persistence.query(
            `update fx_system_tx_journal
             set state = 'failed', failure_dimension = 'readDocuments',
               updated_at = clock_timestamp()
             where session_id = $1`,
            [current.anchor.sessionId],
          );
        }
        await persistence.query(
          `update fx_system_tx_execution_claim
           set claimed_at = clock_timestamp() - interval '2 minutes',
             claim_expires_at = clock_timestamp() - interval '1 minute'
           where session_id = $1`,
          [current.anchor.sessionId],
        );

        const firstClaims = createPointMutationExecutionClaimVaultV1();
        const loadEntered = deferredSignal();
        const releaseLoad = deferredSignal();
        const gatedLoading: PointMutationSessionAttemptLoadingV1 =
          Object.freeze({
            load: Effect.fn("Test.gateAbortOnlyAttemptLoad")((input) =>
              Effect.promise(async () => {
                loadEntered.resolve();
                await releaseLoad.promise;
              }).pipe(Effect.flatMap(() => current.loading.load(input)))
            ),
          });
        const first = createB2b2aRedispatchAuthentication(
          persistence,
          current,
          firstClaims,
          runner,
          () => reason === "dirtyOpen"
            ? "95000000-0000-4000-8000-000000000011"
            : "95000000-0000-4000-8000-000000000012",
          {},
          { attemptLoading: gatedLoading },
        );
        const second = createB2b2aRedispatchAuthentication(
          persistence,
          current,
          createPointMutationExecutionClaimVaultV1(),
          runner,
          () => "95000000-0000-4000-8000-000000000013",
        );
        const selector = selectorWire(current.anchor);
        const firstDisposition = runEffect(
          first.redispatchExactPointMutationAttempt(selector),
        );
        await loadEntered.promise;

        await expect(runEffect(
          second.redispatchExactPointMutationAttempt(selector),
        )).resolves.toEqual({ kind: "busy" });
        await expect(runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          fields: { stale: true },
        })).rejects.toMatchObject({
          _tag: "SessionJournalAttemptUnavailableV1Error",
          issue: { reason: "executionClaimUnavailable" },
        });
        await expect(prepareSeal(current.store, current.attempt)).rejects
          .toMatchObject({
            _tag: "SessionJournalAttemptUnavailableV1Error",
            issue: { reason: "executionClaimUnavailable" },
          });

        releaseLoad.resolve();
        await expect(firstDisposition).resolves.toMatchObject({
          kind: "closed",
          reason,
          lifecycle: "aborted",
        });
        const scopeUuid = projectScopeIdUuidV1(
          current.anchor.scopeId,
        ).scopeUuid;
        await expect(o08DispositionPostgresState(
          persistence,
          scopeUuid,
          current.anchor.sessionId,
        )).resolves.toEqual({
          lifecycle: "aborted",
          claims: "0",
          leases: "0",
          journals: "0",
          receipts: "0",
          points: "0",
          write_events: "0",
          headers: "0",
          changes: "0",
          outcomes: "0",
          wakes: "0",
          last_commit_seq: "0",
          last_outbox_seq: "0",
        });
        await expect(runFailure(
          second.redispatchExactPointMutationAttempt(selector),
        )).resolves.toMatchObject({
          _tag: "PointMutationExecutionClaimAcquisitionStaleV1Error",
          reason: "lifecycle",
        });
      }
      expect(runnerCalls).toBe(0);
    });
  }, 120_000);

  it("keeps B2a publication atomic when a late PostgreSQL invariant rolls back", async () => {
    await withPostgresPersistence(async (persistence) => {
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

  it("retries two genuine PostgreSQL 40001 rollbacks with fresh transaction facts", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(persistence, "o08c_40001_success");
      const commands: PointCommitPublicationCommandV1[] = [];
      const confirmed: PointCommitConfirmedPreDecisionRollbackV1Error[] = [];
      const authentication = createO08CAuthentication(
        persistence,
        current,
        commands,
        confirmed,
      );
      const running = await preparePostgresO08CRunningPlan(
        current,
        authentication,
        "o08c serialization success",
      );
      const finishing = await runEffect(
        authentication.enterPointCommitFinishing(running),
      );
      const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
      const trigger = await installO08CSerializationTriggerPostgres(
        persistence,
        scopeUuid,
        "success",
        2,
      );
      let randomCalls = 0;
      try {
        await expect(runEffect(
          authentication.publishPointCommit(finishing).pipe(
            Effect.provideService(Random.Random, {
              nextDoubleUnsafe: () => {
                randomCalls += 1;
                return 0.5;
              },
              nextIntUnsafe: () => 0,
            }),
          ),
        )).resolves.toMatchObject({
          kind: "published",
          token: { commitSeq: 1n },
        });
        expect(commands).toHaveLength(3);
        expect(commands[1]).toBe(commands[0]);
        expect(commands[2]).toBe(commands[0]);
        expect(confirmed.map((failure) => failure.sqlState)).toEqual([
          "40001",
          "40001",
        ]);
        expect(randomCalls).toBe(2);
        const observations = await trigger.observations();
        expect(observations.attempts).toBe("3");
        expect(new Set(observations.txids).size).toBe(3);
        expect(observations.publicationTimesMicros[0]).toBeLessThan(
          observations.publicationTimesMicros[1] ?? 0n,
        );
        expect(observations.publicationTimesMicros[1]).toBeLessThan(
          observations.publicationTimesMicros[2] ?? 0n,
        );
        const state = await o08CPublicationState(persistence, scopeUuid);
        expect(state).toMatchObject({
          revisions: "1",
          current_rows: "1",
          commit_headers: "1",
          commit_changes: "1",
          outcomes: "1",
          wakes: "1",
          last_commit_seq: "1",
          last_outbox_seq: "1",
        });
        expect(observations.txids).toContain(state.header_xmin);
        expect(state.committed_at_micros).toBe(
          observations.publicationTimesMicros[2]?.toString(),
        );

        await expect(runEffect(
          authentication.publishPointCommit(finishing),
        )).resolves.toMatchObject({
          kind: "replayed",
          token: { commitSeq: 1n },
        });
        expect((await trigger.observations()).attempts).toBe("3");
      } finally {
        await trigger.drop();
      }
    });
  }, 120_000);

  it("re-derives dense same-scope publication facts after a commit during retry backoff", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(
        persistence,
        "o08c_same_scope_interleaving",
      );
      const targetCommands: PointCommitPublicationCommandV1[] = [];
      const confirmed: PointCommitConfirmedPreDecisionRollbackV1Error[] = [];
      const firstRollback = deferredSignal();
      const retryBackoffStarted = deferredSignal();
      const authentication = createO08CAuthentication(
        persistence,
        current,
        targetCommands,
        confirmed,
        () => firstRollback.resolve(),
      );
      const running = await preparePostgresO08CRunningPlan(
        current,
        authentication,
        "o08c same-scope retry target",
      );
      const finishing = await runEffect(
        authentication.enterPointCommitFinishing(running),
      );
      const companion = await preparePostgresO08CCompanionPublication(
        persistence,
        current,
        "o08c_same_scope_companion",
      );
      const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
      expect(companion.publicationCommand.sealIdentity.scopeUuid).toBe(
        scopeUuid,
      );
      expect(companion.anchor.sessionId).not.toBe(current.anchor.sessionId);
      const trigger = await installO08CSerializationTriggerPostgres(
        persistence,
        scopeUuid,
        "interleaving",
        1,
      );
      const companionPublisher = createPointCommitPublisherPortV1(
        resolutionPorts(persistence),
      );
      let randomCalls = 0;
      try {
        const results = await runEffect(
          Effect.gen(function* () {
            const targetFiber = yield* authentication.publishPointCommit(
              finishing,
            ).pipe(
              Effect.provideService(Random.Random, {
                nextDoubleUnsafe: () => {
                  randomCalls += 1;
                  retryBackoffStarted.resolve();
                  return 0.5;
                },
                nextIntUnsafe: () => 0,
              }),
              Effect.forkChild,
            );
            yield* Effect.promise(() => firstRollback.promise);
            yield* Effect.promise(() => retryBackoffStarted.promise);
            expect(confirmed).toHaveLength(1);
            expect(confirmed[0]).toBeInstanceOf(
              PointCommitConfirmedPreDecisionRollbackV1Error,
            );
            expect(confirmed[0]).toMatchObject({
              operation: "writeCommitHeader",
              sqlState: "40001",
            });
            expect(randomCalls).toBe(1);
            expect(targetCommands).toHaveLength(1);

            yield* Effect.promise(() =>
              persistence.query("select pg_sleep(0.01)")
            );
            const companionResult = yield* companionPublisher.publish(
              companion.publicationCommand,
            );
            expect(companionResult).toMatchObject({
              kind: "published",
              token: { commitSeq: 1n },
              successfulResult: { valueJson: { ok: false } },
            });
            expect(targetCommands).toHaveLength(1);

            yield* Effect.promise(() =>
              persistence.query("select pg_sleep(0.01)")
            );
            yield* TestClock.adjust("4 millis");
            expect(targetCommands).toHaveLength(1);
            yield* TestClock.adjust("1 millis");
            const targetResult = yield* Fiber.join(targetFiber);
            return Object.freeze({ companionResult, targetResult });
          }).pipe(Effect.provide(TestClock.layer())),
        );

        expect(results.targetResult).toMatchObject({
          kind: "published",
          token: { commitSeq: 2n },
          successfulResult: { valueJson: { ok: true } },
        });
        expect(targetCommands).toHaveLength(2);
        expect(targetCommands[1]).toBe(targetCommands[0]);
        expect(targetCommands[0]).not.toBe(companion.publicationCommand);
        expect(randomCalls).toBe(1);

        const observations = await trigger.observations();
        expect(observations.attempts).toBe("3");
        expect(observations.commitSeqs).toEqual(["1", "1", "2"]);
        expect(new Set(observations.txids).size).toBe(3);
        expect(observations.publicationTimesMicros[0]).toBeLessThan(
          observations.publicationTimesMicros[1] ?? 0n,
        );
        expect(observations.publicationTimesMicros[1]).toBeLessThan(
          observations.publicationTimesMicros[2] ?? 0n,
        );

        const state = await o08CPublicationState(persistence, scopeUuid);
        expect(state).toMatchObject({
          revisions: "1",
          current_rows: "1",
          commit_headers: "2",
          commit_changes: "1",
          outcomes: "2",
          wakes: "2",
          last_commit_seq: "2",
          last_outbox_seq: "2",
          header_xmin: observations.txids[2],
          committed_at_micros:
            observations.publicationTimesMicros[2]?.toString(),
        });
        const targetCommand = targetCommands[0];
        if (targetCommand === undefined) {
          throw new Error("Missing captured O08-C target command.");
        }
        const durableRows = await o08CInterleavingPublicationRows(
          persistence,
          scopeUuid,
        );
        expect(durableRows).toEqual({
          headers: [
            {
              commit_seq: "1",
              transaction_id: observations.txids[1],
              committed_at_micros:
                observations.publicationTimesMicros[1]?.toString(),
              change_count: 0,
            },
            {
              commit_seq: "2",
              transaction_id: observations.txids[2],
              committed_at_micros:
                observations.publicationTimesMicros[2]?.toString(),
              change_count: 1,
            },
          ],
          changes: [{ commit_seq: "2", change_ordinal: 0 }],
          outcomes: [
            {
              request_key: companion.requestKey,
              commit_seq: "1",
              result_state: "available",
            },
            {
              request_key: targetCommand.authorityPins.requestKey,
              commit_seq: "2",
              result_state: "available",
            },
          ],
          wakes: [
            {
              outbox_seq: "1",
              commit_seq: "1",
              event_kind: "deployment_sync_commit_wake_v1",
              delivery_state: "pending",
            },
            {
              outbox_seq: "2",
              commit_seq: "2",
              event_kind: "deployment_sync_commit_wake_v1",
              delivery_state: "pending",
            },
          ],
        });

        await expect(runEffect(companionPublisher.publish(
          companion.publicationCommand,
        ))).resolves.toMatchObject({
          kind: "replayed",
          token: { commitSeq: 1n },
          successfulResult: { valueJson: { ok: false } },
        });
        await expect(runEffect(
          authentication.publishPointCommit(finishing),
        )).resolves.toMatchObject({
          kind: "replayed",
          token: { commitSeq: 2n },
          successfulResult: { valueJson: { ok: true } },
        });
        expect(targetCommands).toHaveLength(3);
        expect((await trigger.observations()).attempts).toBe("3");
        expect(await o08CPublicationState(persistence, scopeUuid)).toEqual(
          state,
        );
        expect(await o08CInterleavingPublicationRows(
          persistence,
          scopeUuid,
        )).toEqual(durableRows);
      } finally {
        await trigger.drop();
      }
    });
  }, 120_000);

  it("exhausts three genuine PostgreSQL 40001 rollbacks without publication residue", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(
        persistence,
        "o08c_40001_exhaustion",
      );
      const commands: PointCommitPublicationCommandV1[] = [];
      const confirmed: PointCommitConfirmedPreDecisionRollbackV1Error[] = [];
      const authentication = createO08CAuthentication(
        persistence,
        current,
        commands,
        confirmed,
      );
      const running = await preparePostgresO08CRunningPlan(
        current,
        authentication,
        "o08c serialization exhaustion",
      );
      const finishing = await runEffect(
        authentication.enterPointCommitFinishing(running),
      );
      const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
      const trigger = await installO08CSerializationTriggerPostgres(
        persistence,
        scopeUuid,
        "exhaustion",
        3,
      );
      let randomCalls = 0;
      try {
        const failure = await runFailure(
          authentication.publishPointCommit(finishing).pipe(
            Effect.provideService(Random.Random, {
              nextDoubleUnsafe: () => {
                randomCalls += 1;
                return 0;
              },
              nextIntUnsafe: () => 0,
            }),
          ),
        );
        expect(failure).toBeInstanceOf(
          PointCommitKnownSettledSqlRetryExhaustedV1Error,
        );
        expect(failure).toMatchObject({ attempts: 3, maximumAttempts: 3 });
        expect(commands).toHaveLength(3);
        expect(commands[1]).toBe(commands[0]);
        expect(commands[2]).toBe(commands[0]);
        expect(confirmed.map((entry) => entry.sqlState)).toEqual([
          "40001",
          "40001",
          "40001",
        ]);
        expect(randomCalls).toBe(2);
        const observations = await trigger.observations();
        expect(observations.attempts).toBe("3");
        expect(new Set(observations.txids).size).toBe(3);
        expect(await o08CPublicationState(persistence, scopeUuid)).toMatchObject({
          revisions: "0",
          current_rows: "0",
          commit_headers: "0",
          commit_changes: "0",
          outcomes: "0",
          wakes: "0",
          last_commit_seq: "0",
          last_outbox_seq: "0",
        });
        expect(await o08CAttemptState(
          persistence,
          scopeUuid,
          current.anchor.sessionId,
        )).toMatchObject({
          lifecycle: "finishing",
          leases: "1",
          journals: "1",
        });
      } finally {
        await trigger.drop();
      }
    });
  }, 120_000);

  it("retries the one genuine PostgreSQL 40P01 victim while an independent scope commits", async () => {
    await withPostgresPersistence(async (persistence) => {
      const first = await o08B1Scenario(persistence, "o08c_deadlock_a");
      const second = await o08B1Scenario(persistence, "o08c_deadlock_b");
      const firstCommands: PointCommitPublicationCommandV1[] = [];
      const secondCommands: PointCommitPublicationCommandV1[] = [];
      const firstConfirmed: PointCommitConfirmedPreDecisionRollbackV1Error[] =
        [];
      const secondConfirmed: PointCommitConfirmedPreDecisionRollbackV1Error[] =
        [];
      const firstAuthentication = createO08CAuthentication(
        persistence,
        first,
        firstCommands,
        firstConfirmed,
      );
      const secondAuthentication = createO08CAuthentication(
        persistence,
        second,
        secondCommands,
        secondConfirmed,
      );
      const firstRunning = await preparePostgresO08CRunningPlan(
        first,
        firstAuthentication,
        "o08c deadlock a",
      );
      const secondRunning = await preparePostgresO08CRunningPlan(
        second,
        secondAuthentication,
        "o08c deadlock b",
      );
      const firstFinishing = await runEffect(
        firstAuthentication.enterPointCommitFinishing(firstRunning),
      );
      const secondFinishing = await runEffect(
        secondAuthentication.enterPointCommitFinishing(secondRunning),
      );
      const firstScopeUuid = projectScopeIdUuidV1(first.anchor.scopeId).scopeUuid;
      const secondScopeUuid = projectScopeIdUuidV1(
        second.anchor.scopeId,
      ).scopeUuid;
      const trigger = await installO08CDeadlockTriggerPostgres(
        persistence,
        firstScopeUuid,
        secondScopeUuid,
      );
      const zeroRandom = Object.freeze({
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      });
      try {
        const [firstResult, secondResult] = await Promise.all([
          runEffect(firstAuthentication.publishPointCommit(firstFinishing).pipe(
            Effect.provideService(Random.Random, zeroRandom),
          )),
          runEffect(secondAuthentication.publishPointCommit(secondFinishing).pipe(
            Effect.provideService(Random.Random, zeroRandom),
          )),
        ]);
        expect(firstResult).toMatchObject({
          kind: "published",
          token: { commitSeq: 1n },
        });
        expect(secondResult).toMatchObject({
          kind: "published",
          token: { commitSeq: 1n },
        });
        expect([firstCommands.length, secondCommands.length].sort()).toEqual([
          1,
          2,
        ]);
        expect([...firstConfirmed, ...secondConfirmed]).toHaveLength(1);
        expect([...firstConfirmed, ...secondConfirmed][0]).toMatchObject({
          sqlState: "40P01",
        });
        const retriedCommands = firstCommands.length === 2
          ? firstCommands
          : secondCommands;
        expect(retriedCommands[1]).toBe(retriedCommands[0]);
        expect(await trigger.attempts()).toBe("3");
        for (const scopeUuid of [firstScopeUuid, secondScopeUuid]) {
          expect(await o08CPublicationState(persistence, scopeUuid)).toMatchObject({
            revisions: "1",
            commit_headers: "1",
            outcomes: "1",
            wakes: "1",
            last_commit_seq: "1",
            last_outbox_seq: "1",
          });
        }
      } finally {
        await trigger.drop();
      }
    });
  }, 120_000);

  it("exhausts three genuine PostgreSQL 40P01 victims without a sequence gap", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(
        persistence,
        "o08c_deadlock_exhaustion",
      );
      const commands: PointCommitPublicationCommandV1[] = [];
      const confirmed: PointCommitConfirmedPreDecisionRollbackV1Error[] = [];
      const authentication = createO08CAuthentication(
        persistence,
        current,
        commands,
        confirmed,
      );
      const running = await preparePostgresO08CRunningPlan(
        current,
        authentication,
        "o08c deadlock exhaustion",
      );
      const finishing = await runEffect(
        authentication.enterPointCommitFinishing(running),
      );
      const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
      const trigger = await installO08CDeadlockExhaustionTriggerPostgres(
        persistence,
        scopeUuid,
      );
      try {
        const [publication, companions] = await Promise.allSettled([
          runFailure(authentication.publishPointCommit(finishing).pipe(
            Effect.provideService(Random.Random, {
              nextDoubleUnsafe: () => 0,
              nextIntUnsafe: () => 0,
            }),
          )),
          driveO08CDeadlockCompanions(persistence, trigger, 3),
        ]);
        expect(companions.status).toBe("fulfilled");
        if (companions.status === "rejected") throw companions.reason;
        expect(publication.status).toBe("fulfilled");
        if (publication.status === "rejected") throw publication.reason;
        expect(publication.value).toBeInstanceOf(
          PointCommitKnownSettledSqlRetryExhaustedV1Error,
        );
        expect(publication.value).toMatchObject({
          attempts: 3,
          maximumAttempts: 3,
        });
        expect(commands).toHaveLength(3);
        expect(commands[1]).toBe(commands[0]);
        expect(commands[2]).toBe(commands[0]);
        expect(confirmed.map((failure) => failure.sqlState)).toEqual([
          "40P01",
          "40P01",
          "40P01",
        ]);
        expect(await trigger.attempts()).toBe("3");
        expect(await o08CPublicationState(persistence, scopeUuid)).toMatchObject({
          revisions: "0",
          commit_headers: "0",
          outcomes: "0",
          wakes: "0",
          last_commit_seq: "0",
          last_outbox_seq: "0",
        });
        expect(await o08CAttemptState(
          persistence,
          scopeUuid,
          current.anchor.sessionId,
        )).toMatchObject({
          lifecycle: "finishing",
          leases: "1",
          journals: "1",
        });
      } finally {
        await trigger.drop();
      }
    });
  }, 120_000);

  it("distinguishes a forwarded lost COMMIT response from one not forwarded and publishes at most once", async () => {
    await withPostgresPersistence(async (persistence) => {
      const forwardedCurrent = await o08B1Scenario(
        persistence,
        "o08d_forwarded_commit",
      );
      let forwardedAcquisitions = 0;
      const forwardedAuthentication = createO08DAuthentication(
        persistence,
        forwardedCurrent,
        resolutionPortsWithRunner(persistence, {
          afterAcquire: (client) => {
            forwardedAcquisitions += 1;
            if (forwardedAcquisitions !== 1) return;
            installClientQueryFault(
              client,
              (statement, forward) => statement === "commit"
                ? Promise.resolve(forward()).then(() => {
                    throw new Error("O08-D forwarded COMMIT response lost");
                  })
                : forward(),
            );
          },
        }),
      );
      const forwardedRunning = await preparePostgresO08CRunningPlan(
        forwardedCurrent,
        forwardedAuthentication,
        "o08d forwarded commit",
      );
      await expect(runEffect(
        forwardedAuthentication.finishPointCommit(forwardedRunning),
      )).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(forwardedAcquisitions).toBe(1);
      const forwardedScope = projectScopeIdUuidV1(
        forwardedCurrent.anchor.scopeId,
      ).scopeUuid;
      expect(await o08CPublicationState(
        persistence,
        forwardedScope,
      )).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const missingCurrent = await o08B1Scenario(
        persistence,
        "o08d_not_forwarded_commit",
      );
      let missingAcquisitions = 0;
      const missingAuthentication = createO08DAuthentication(
        persistence,
        missingCurrent,
        resolutionPortsWithRunner(persistence, {
          afterAcquire: (client) => {
            missingAcquisitions += 1;
            if (missingAcquisitions !== 1) return;
            installClientQueryFault(
              client,
              (statement, forward) => statement === "commit"
                ? Promise.reject(new Error("O08-D COMMIT not forwarded"))
                : forward(),
            );
          },
        }),
      );
      const missingRunning = await preparePostgresO08CRunningPlan(
        missingCurrent,
        missingAuthentication,
        "o08d not-forwarded commit",
      );
      await expect(runEffect(
        missingAuthentication.finishPointCommit(missingRunning),
      )).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      expect(missingAcquisitions).toBe(2);
      const missingScope = projectScopeIdUuidV1(
        missingCurrent.anchor.scopeId,
      ).scopeUuid;
      expect(await o08CPublicationState(
        persistence,
        missingScope,
      )).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
    });
  }, 120_000);

  it("converges a guarded publication with a same-scope recovery and stops after a second lost response", async () => {
    await withPostgresPersistence(async (persistence) => {
      const concurrentCurrent = await o08B1Scenario(
        persistence,
        "o08d_concurrent_recovery",
      );
      let concurrentAcquisitions = 0;
      let competitorKind: string | undefined;
      const concurrentAuthentication = createO08DAuthentication(
        persistence,
        concurrentCurrent,
        resolutionPortsWithRunner(persistence, {
          afterAcquire: async (client) => {
            concurrentAcquisitions += 1;
            if (concurrentAcquisitions === 1) {
              installClientQueryFault(
                client,
                (statement, forward) => statement === "commit"
                  ? Promise.reject(
                      new Error("O08-D first COMMIT not forwarded"),
                    )
                  : forward(),
              );
              return;
            }
            if (concurrentAcquisitions !== 2) return;
            const competitor = createO08DAuthentication(
              persistence,
              concurrentCurrent,
              resolutionPorts(persistence),
            );
            const result = await runEffect(competitor.resumePointCommit(
              selectorWire(concurrentCurrent.anchor),
            ));
            competitorKind = result.kind;
          },
        }),
      );
      const concurrentRunning = await preparePostgresO08CRunningPlan(
        concurrentCurrent,
        concurrentAuthentication,
        "o08d concurrent recovery",
      );
      await expect(runEffect(
        concurrentAuthentication.finishPointCommit(concurrentRunning),
      )).resolves.toMatchObject({
        kind: "replayed",
        token: { commitSeq: 1n },
      });
      expect(competitorKind).toBe("published");
      expect(concurrentAcquisitions).toBe(2);
      const concurrentScope = projectScopeIdUuidV1(
        concurrentCurrent.anchor.scopeId,
      ).scopeUuid;
      expect(await o08CPublicationState(
        persistence,
        concurrentScope,
      )).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const unresolvedCurrent = await o08B1Scenario(
        persistence,
        "o08d_second_lost_response",
      );
      let unresolvedAcquisitions = 0;
      const unresolvedAuthentication = createO08DAuthentication(
        persistence,
        unresolvedCurrent,
        resolutionPortsWithRunner(persistence, {
          afterAcquire: (client) => {
            unresolvedAcquisitions += 1;
            installClientQueryFault(
              client,
              (statement, forward) => statement === "commit"
                ? Promise.reject(new Error(
                    `O08-D COMMIT ${unresolvedAcquisitions} not forwarded`,
                  ))
                : forward(),
            );
          },
        }),
      );
      const unresolvedRunning = await preparePostgresO08CRunningPlan(
        unresolvedCurrent,
        unresolvedAuthentication,
        "o08d second lost response",
      );
      const unresolved = await runFailure(
        unresolvedAuthentication.finishPointCommit(unresolvedRunning),
      );
      expect(unresolved).toBeInstanceOf(
        PointCommitUncertainOutcomeUnresolvedV1Error,
      );
      expect(unresolved).toMatchObject({
        stage: "guardedPublication",
        secondary: { kind: "secondDecisionUncertain" },
      });
      expect(unresolvedAcquisitions).toBe(2);
      const unresolvedScope = projectScopeIdUuidV1(
        unresolvedCurrent.anchor.scopeId,
      ).scopeUuid;
      expect(await o08CPublicationState(
        persistence,
        unresolvedScope,
      )).toMatchObject({
        revisions: "0",
        commit_headers: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
      expect(await o08CAttemptState(
        persistence,
        unresolvedScope,
        unresolvedCurrent.anchor.sessionId,
      )).toMatchObject({ lifecycle: "finishing", leases: "1", journals: "1" });
    });
  }, 120_000);

  it("holds interruption through guarded settlement while an independent scope publishes", async () => {
    await withPostgresPersistence(async (persistence) => {
      const current = await o08B1Scenario(
        persistence,
        "o08d_interruption",
      );
      const guardedEntered = deferredSignal();
      const guardedRelease = deferredSignal();
      let acquisitions = 0;
      const authentication = createO08DAuthentication(
        persistence,
        current,
        resolutionPortsWithRunner(persistence, {
          afterAcquire: async (client) => {
            acquisitions += 1;
            if (acquisitions === 1) {
              installClientQueryFault(
                client,
                (statement, forward) => statement === "commit"
                  ? Promise.reject(
                      new Error("O08-D interruption COMMIT not forwarded"),
                    )
                  : forward(),
              );
              return;
            }
            guardedEntered.resolve();
            await guardedRelease.promise;
          },
        }),
      );
      const running = await preparePostgresO08CRunningPlan(
        current,
        authentication,
        "o08d interruption",
      );
      const fiber = Effect.runFork(
        authentication.finishPointCommit(running),
      );
      await guardedEntered.promise;
      let interruptionSettled = false;
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      await delay(25);
      expect(interruptionSettled).toBe(false);

      const independent = await o08B1Scenario(
        persistence,
        "o08d_independent_scope",
      );
      const independentAuthentication = createO08DAuthentication(
        persistence,
        independent,
        resolutionPorts(persistence),
      );
      const independentRunning = await preparePostgresO08CRunningPlan(
        independent,
        independentAuthentication,
        "o08d independent scope",
      );
      await expect(runEffect(
        independentAuthentication.finishPointCommit(independentRunning),
      )).resolves.toMatchObject({ kind: "published", token: { commitSeq: 1n } });

      guardedRelease.resolve();
      await interruption;
      expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(
        true,
      );
      const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
      expect(await o08CPublicationState(persistence, scopeUuid)).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      const independentScope = projectScopeIdUuidV1(
        independent.anchor.scopeId,
      ).scopeUuid;
      expect(await o08CPublicationState(
        persistence,
        independentScope,
      )).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
    });
  }, 120_000);
});

interface Scenario {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionClaims: PointMutationExecutionClaimVaultV1;
  readonly executionScope: PointMutationExecutionScopeV1;
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
  if (activation.status !== "created") {
    throw new Error("Expected a newly created Postgres stored attempt.");
  }
  const executionClaims = createPointMutationExecutionClaimVaultV1();
  const executionScope = await runEffect(Effect.fromResult(
    executionClaims.admission.admit(executionClaims.issuer.mint({
      selector: {
        deploymentId,
        scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      observation: activation.executionClaim,
      mode: "execute",
    }), "execute"),
  ));
  const store = createSessionJournalStorePersistenceV1(ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
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
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
    }),
  );
  return Object.freeze({
    anchor: activation.anchor,
    executionClaims,
    executionScope,
    authority: Object.freeze({
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
      storageGeneration: activation.anchor.storageGeneration,
      storageGenerationFence: activation.anchor.storageGenerationFence,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
      executionClaim: activation.executionClaim,
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
  if (activation.status !== "created") {
    throw new Error("Expected a newly created Postgres O08-B1 attempt.");
  }
  const executionClaims = createPointMutationExecutionClaimVaultV1();
  const executionScope = await runEffect(Effect.fromResult(
    executionClaims.admission.admit(executionClaims.issuer.mint({
      selector: {
        deploymentId,
        scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      observation: activation.executionClaim,
      mode: "execute",
    }), "execute"),
  ));
  const store = createSessionJournalStorePersistenceV1(ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
  });
  const attempt = await runEffect(store.openAttemptEffect({
    selector: {
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    },
    executionClaim: activation.executionClaim,
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
    executionClaims,
    executionScope,
    authority: Object.freeze({
      deploymentId,
      scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
      storageGeneration: activation.anchor.storageGeneration,
      storageGenerationFence: activation.anchor.storageGenerationFence,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId,
      executionClaim: activation.executionClaim,
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
      grantRetentionPolicy: Result.getOrThrow(
        makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 600_000,
          maximumFutureIssuedAtSkewMilliseconds: 0,
          maximumLiveSnapshotRetentionMilliseconds: 600_000,
        }),
      ),
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
    [RESOLVE_POINT_COMMIT_OUTCOME_V1]: (
      ...args: Parameters<
        typeof publisher[
          typeof RESOLVE_POINT_COMMIT_OUTCOME_V1
        ]
      >
    ) => publisher[
      RESOLVE_POINT_COMMIT_OUTCOME_V1
    ](...args).pipe(
      Effect.tap((outcome) => Effect.sync(() => {
        observedOutcomeKinds.push(outcome.kind);
      })),
    ),
  });
  return createStoredPointMutationOccRerunAuthorizationV1(current.loader, {
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
  }, current.executionClaims);
}

function createO08CAuthentication(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  commands: PointCommitPublicationCommandV1[],
  confirmed: PointCommitConfirmedPreDecisionRollbackV1Error[],
  onConfirmed?: (
    failure: PointCommitConfirmedPreDecisionRollbackV1Error,
  ) => void,
) {
  const ports = resolutionPorts(persistence);
  const publisher = createPointCommitPublisherPortV1(ports);
  const observedPublisher:
    & PointCommitPublisherPortV1
    & PointCommitOutcomeResolutionPortV1 = Object.freeze({
    prove: publisher.prove,
    [RESOLVE_POINT_COMMIT_OUTCOME_V1]:
      publisher[RESOLVE_POINT_COMMIT_OUTCOME_V1],
    publish: Effect.fn("TestO08C.observePublicationAttempt")((command) =>
      Effect.sync(() => commands.push(command)).pipe(
        Effect.flatMap(() => publisher.publish(command)),
        Effect.tapErrorTag(
          "PointCommitConfirmedPreDecisionRollbackV1Error",
          (failure) => Effect.sync(() => {
            if (
              failure instanceof
                PointCommitConfirmedPreDecisionRollbackV1Error
            ) {
              confirmed.push(failure);
              onConfirmed?.(failure);
            }
          }),
        ),
      )
    ),
  });
  return createStoredPointCommitExecutorV1(current.loader, {
    evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
    transactionGrantVerifier: current.verifier,
    functionMetadata: {
      load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
    },
    pointCommit: observedPublisher,
    pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
  }, current.executionClaims);
}

function createO08DAuthentication(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  publisherPorts: PointMutationSessionAuthorityResolutionPortsV1,
) {
  const ports = resolutionPorts(persistence);
  return createStoredPointCommitExecutorV1(current.loader, {
    evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
    transactionGrantVerifier: current.verifier,
    functionMetadata: {
      load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
    },
    pointCommit: createPointCommitPublisherPortV1(publisherPorts),
    pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
  }, current.executionClaims);
}

async function preparePostgresO08CRunningPlan(
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  authentication:
    | ReturnType<typeof createO08CAuthentication>
    | ReturnType<typeof createO08DAuthentication>,
  documentName: string,
) {
  const table = await runEffect(
    current.store.resolvePointTableEffect(current.attempt, "users"),
  );
  await runPointOperation(current.store, table, {
    kind: "insert",
    syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
    fields: { name: documentName },
  });
  const envelope = await sealScenario(current);
  const loadedAttempt = await runEffect(
    current.loading.load(selectorWire(current.anchor)),
  );
  const authority = await runEffect(
    authentication.deriveAuthority(loadedAttempt, current.executionScope),
  );
  const stored = await runEffect(
    authentication.authenticate(authority, encodeEnvelope(envelope)),
  );
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(stored),
  );
  const verified = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  return runEffect(authentication.planPointCommit(verified));
}

async function preparePostgresO08CCompanionPublication(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  label: string,
) {
  const randomUuid = uuidFactory("94800000");
  const ports = resolutionPorts(persistence);
  const requestKey = TransactionRequestKeyV1Schema.make(`request:${label}`);
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      ports,
      { leaseDurationMilliseconds: 60_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      current.anchor.deploymentId,
      current.anchor.scopeId,
      {
        evidence: {
          schemaVersionId: current.authority.schemaVersionId,
          requestKey,
        },
      },
    ),
  );
  if (activation.status !== "created") {
    throw new Error("Expected a newly created O08-C companion attempt.");
  }
  const store = createSessionJournalStorePersistenceV1(ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
  });
  const attempt = await runEffect(store.openAttemptEffect({
    selector: {
      deploymentId: activation.anchor.deploymentId,
      scopeId: activation.anchor.scopeId,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
    },
    executionClaim: activation.executionClaim,
    snapshotToken: activation.anchor.snapshotToken,
    schemaVersionId: current.authority.schemaVersionId,
  }));
  const prepared = await prepareSeal(store, attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: false }),
  );
  await completeSeal(store, prepared.preparation, journal, result);
  const authority: StoredAttemptEvidenceAuthorityV1 = Object.freeze({
    deploymentId: activation.anchor.deploymentId,
    scopeId: activation.anchor.scopeId,
    sessionId: activation.anchor.sessionId,
    attemptFence: activation.anchor.attemptFence,
    storageGeneration: activation.anchor.storageGeneration,
    storageGenerationFence: activation.anchor.storageGenerationFence,
    snapshotToken: activation.anchor.snapshotToken,
    schemaVersionId: current.authority.schemaVersionId,
    executionClaim: activation.executionClaim,
  });
  const loader = createStoredAttemptEvidenceLoaderV1(ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error(
      `Expected running O08-C companion evidence, received ${running.kind}.`,
    );
  }
  await runEffect(
    createPointCommitFinishingTransitionPortV1(ports).enterFinishing(
      await pointCommitFinishingCommandFromStoredAttemptV1(
        authority,
        running.evidence,
      ),
    ),
  );
  const finishing = await runEffect(loader.loadFinishingEffect({
    deploymentId: activation.anchor.deploymentId,
    scopeId: activation.anchor.scopeId,
    sessionId: activation.anchor.sessionId,
    attemptFence: activation.anchor.attemptFence,
  }));
  if (finishing.kind !== "loaded") {
    throw new Error(
      `Expected finishing O08-C companion evidence, received ${finishing.kind}.`,
    );
  }
  const command = await pointCommitCommandFromStoredAttemptV1(
    authority,
    finishing.evidence,
  );
  return Object.freeze({
    anchor: activation.anchor,
    requestKey,
    publicationCommand: Object.freeze({
      ...command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: Object.freeze({ ok: false }),
        canonicalBytes: result.canonicalBytes,
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    } satisfies PointCommitPublicationCommandV1),
  });
}

function createO08B2aAuthentication(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  runner: PointMutationOccRuntimeNeutralRunnerV1,
  executionEvidenceOptions: StoredCommitAuthorityEvidenceLoaderOptionsV1 = {},
  publisherOptions: PointCommitTransactionProofOptionsV1 = {},
  livenessOptions: Readonly<{
    readonly heartbeatIntervalMilliseconds?: number;
    readonly observeRenewal?: () => void;
  }> = {},
) {
  const ports = resolutionPorts(persistence);
  let executionSequence = 0;
  const actualLiveness = createPointMutationExecutionClaimLivenessV1(ports, {
    claimDurationMilliseconds: 60_000,
    leaseRenewalDurationMilliseconds: 120_000,
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
  });
  const observeRenewal = livenessOptions.observeRenewal;
  const liveness: PointMutationExecutionClaimLivenessV1 =
    observeRenewal === undefined
      ? actualLiveness
      : Object.freeze({
          configuration: actualLiveness.configuration,
          renewEffect: (
            input: Parameters<
              PointMutationExecutionClaimLivenessV1["renewEffect"]
            >[0],
          ) =>
            Effect.sync(observeRenewal).pipe(
              Effect.andThen(actualLiveness.renewEffect(input)),
            ),
        });
  return createStoredPointMutationOccRerunExecutionV1(current.loader, {
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
      journal: createPointMutationJournalV1(
        current.store,
        current.executionClaims.admission,
        SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
      ),
      terminalization: createPointMutationSessionAttemptTerminalizationV1(
        createPointMutationSessionAttemptTerminalizationPersistenceV1(ports),
        current.executionClaims.admission,
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
      liveness,
      heartbeatIntervalMilliseconds:
        livenessOptions.heartbeatIntervalMilliseconds ?? 20_000,
    },
  }, current.executionClaims);
}

function createB2b2aRedispatchAuthentication(
  persistence: PostgresFlarexPersistence,
  current: Awaited<ReturnType<typeof o08B1Scenario>>,
  executionClaims: PointMutationExecutionClaimVaultV1,
  runner: PointMutationOccRuntimeNeutralRunnerV1,
  randomOwner: () => string,
  executionEvidenceOptions: StoredCommitAuthorityEvidenceLoaderOptionsV1 = {},
  redispatchOptions: Readonly<{
    readonly acquisition?: PointMutationExecutionClaimDispatchAcquisitionV1;
    readonly attemptLoading?: PointMutationSessionAttemptLoadingV1;
  }> = {},
) {
  const ports = resolutionPorts(persistence);
  let executionSequence = 0;
  const terminalizationPersistence =
    createPointMutationSessionAttemptTerminalizationPersistenceV1(ports);
  return createStoredPointMutationCrashRedispatchV1(current.loader, {
    evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
    transactionGrantVerifier: current.verifier,
    functionMetadata: {
      load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
    },
    pointCommit: createPointCommitPublisherPortV1(ports),
    pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
    pointMutationAttemptReplacement:
      createPointMutationAttemptReplacementPortV1(ports, {
        leaseDurationMilliseconds: 60_000,
      }),
    pointMutationOccRerun: {
      attemptLoading: redispatchOptions.attemptLoading ?? current.loading,
      executionEvidence: createStoredOccExecutionEvidenceLoaderV1(
        ports,
        executionEvidenceOptions,
      ),
      journal: createPointMutationJournalV1(
        current.store,
        executionClaims.admission,
        SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
      ),
      terminalization: createPointMutationSessionAttemptTerminalizationV1(
        terminalizationPersistence,
        executionClaims.admission,
      ),
      contextFactory: {
        make: () =>
          Effect.sync(() => {
            executionSequence += 1;
            return Object.freeze({
              executionId: `o08-b2b2a-postgres-${executionSequence}`,
              logScopeId: `o08-b2b2a-postgres-log-${executionSequence}`,
              randomSeed: new Uint8Array(32).fill(executionSequence),
            });
          }),
      },
      runner,
      liveness: createPointMutationExecutionClaimLivenessV1(ports, {
        claimDurationMilliseconds: 60_000,
        leaseRenewalDurationMilliseconds: 120_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      }),
      heartbeatIntervalMilliseconds: 20_000,
    },
    pointMutationRedispatch: {
      acquisition: redispatchOptions.acquisition ??
        createPointMutationExecutionClaimDispatchAcquisitionV1(
          createPointMutationExecutionClaimAcquisitionV1(ports, {
            durationMilliseconds: 60_000,
            randomOwner,
          }),
          executionClaims.issuer,
        ),
      disposition: createPointMutationSessionAttemptDispositionV1(
        terminalizationPersistence,
        executionClaims.abortOnlyAdmission,
      ),
    },
  }, executionClaims);
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
    authentication.deriveAuthority(loadedAttempt, current.executionScope),
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
        fx_system_tx_execution_claim,
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
  const intent = command.rowIntents[0];
  if (intent?.kind !== "live") {
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
  await withPostgresSequentialScansDisabled(
    persistence,
    async (client) => {
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
    },
  );
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

function pointMutationAttemptDiscovery(
  persistence: PostgresFlarexPersistence,
) {
  return createPointMutationAttemptDiscoveryV1({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared discovery must not read split receipts.");
      },
    },
    scopeDiscoveryTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  });
}

function resolutionPortsWithRunner(
  persistence: PostgresFlarexPersistence,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1,
): PointMutationSessionAuthorityResolutionPortsV1 {
  const base = resolutionPorts(persistence);
  return {
    ...base,
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createLocatedPointMutationSessionActivationTargetV1(
          persistence.drizzle,
          physicalLocator,
          {
            [LOCATED_READ_COMMITTED_RUNNER_V1]:
              createPostgresLocatedReadCommittedTransactionRunnerV1(
                persistence.pool,
                runnerOptions,
              ),
          },
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
      indexedQuerySyscalls: evidence.root.indexedQuerySyscalls,
      indexRangeDependencyCount: evidence.root.indexRangeDependencyCount,
      indexRangeDependencyEvidenceBytes:
        evidence.root.indexRangeDependencyEvidenceBytes,
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

async function installO08CSerializationTriggerPostgres(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  label: "success" | "interleaving" | "exhaustion",
  failuresBeforeSuccess: 1 | 2 | 3,
) {
  const prefix = `fx_test_o08c_${label}`;
  const attemptSequence = `${prefix}_attempts`;
  const txidSequences = [1, 2, 3].map((attempt) =>
    `${prefix}_txid_${attempt}`
  );
  const timeSequences = [1, 2, 3].map((attempt) =>
    `${prefix}_time_${attempt}`
  );
  const commitSequences = [1, 2, 3].map((attempt) =>
    `${prefix}_commit_seq_${attempt}`
  );
  const functionName = `${prefix}_40001`;
  const triggerName = `${prefix}_40001_trigger`;
  for (const sequence of [
    attemptSequence,
    ...txidSequences,
    ...timeSequences,
    ...commitSequences,
  ]) {
    await persistence.query(`create sequence ${sequence}`);
  }
  await persistence.query(
    `
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      declare
        current_attempt bigint;
        publication_time_micros bigint;
      begin
        if new.scope_uuid <> '${scopeUuid}'::uuid then
          return new;
        end if;
        current_attempt := nextval('${attemptSequence}');
        publication_time_micros := floor(
          extract(epoch from new.committed_at) * 1000000
        )::bigint;
        if current_attempt = 1 then
          perform setval('${txidSequences[0]}', txid_current());
          perform setval('${timeSequences[0]}', publication_time_micros);
          perform setval('${commitSequences[0]}', new.commit_seq);
        elsif current_attempt = 2 then
          perform setval('${txidSequences[1]}', txid_current());
          perform setval('${timeSequences[1]}', publication_time_micros);
          perform setval('${commitSequences[1]}', new.commit_seq);
        elsif current_attempt = 3 then
          perform setval('${txidSequences[2]}', txid_current());
          perform setval('${timeSequences[2]}', publication_time_micros);
          perform setval('${commitSequences[2]}', new.commit_seq);
        end if;
        if current_attempt <= ${failuresBeforeSuccess} then
          raise exception 'forced O08-C serialization failure %',
            current_attempt using errcode = '40001';
        end if;
        return new;
      end
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      before insert on fx_system_commit
      for each row execute function ${functionName}()
    `,
  );
  return Object.freeze({
    observations: async () => {
      const result = await persistence.query<{
        attempts: string;
        txid_1: string;
        txid_2: string;
        txid_3: string;
        time_1: string;
        time_2: string;
        time_3: string;
        commit_seq_1: string;
        commit_seq_2: string;
        commit_seq_3: string;
      }>(
        `
          select
            (select last_value::text from ${attemptSequence}) as attempts,
            (select last_value::text from ${txidSequences[0]}) as txid_1,
            (select last_value::text from ${txidSequences[1]}) as txid_2,
            (select last_value::text from ${txidSequences[2]}) as txid_3,
            (select last_value::text from ${timeSequences[0]}) as time_1,
            (select last_value::text from ${timeSequences[1]}) as time_2,
            (select last_value::text from ${timeSequences[2]}) as time_3,
            (select last_value::text from ${commitSequences[0]})
              as commit_seq_1,
            (select last_value::text from ${commitSequences[1]})
              as commit_seq_2,
            (select last_value::text from ${commitSequences[2]})
              as commit_seq_3
        `,
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Missing PostgreSQL O08-C trigger observations.");
      }
      return Object.freeze({
        attempts: row.attempts,
        txids: Object.freeze([row.txid_1, row.txid_2, row.txid_3]),
        publicationTimesMicros: Object.freeze([
          BigInt(row.time_1),
          BigInt(row.time_2),
          BigInt(row.time_3),
        ]),
        commitSeqs: Object.freeze([
          row.commit_seq_1,
          row.commit_seq_2,
          row.commit_seq_3,
        ]),
      });
    },
    drop: async (): Promise<void> => {
      await persistence.query(
        `drop trigger ${triggerName} on fx_system_commit`,
      );
      await persistence.query(`drop function ${functionName}()`);
      for (const sequence of [
        attemptSequence,
        ...txidSequences,
        ...timeSequences,
        ...commitSequences,
      ]) {
        await persistence.query(`drop sequence ${sequence}`);
      }
    },
  });
}

async function installO08CDeadlockTriggerPostgres(
  persistence: PostgresFlarexPersistence,
  firstScopeUuid: string,
  secondScopeUuid: string,
) {
  const attemptSequence = "fx_test_o08c_deadlock_attempts";
  const functionName = "fx_test_o08c_deadlock_function";
  const triggerName = "fx_test_o08c_deadlock_trigger";
  await persistence.query(`create sequence ${attemptSequence}`);
  await persistence.query(
    `
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      declare
        current_attempt bigint;
        peer_key integer;
        wait_count integer := 0;
      begin
        if new.scope_uuid <> '${firstScopeUuid}'::uuid
          and new.scope_uuid <> '${secondScopeUuid}'::uuid then
          return new;
        end if;
        current_attempt := nextval('${attemptSequence}');
        if current_attempt > 2 then
          return new;
        end if;
        if new.scope_uuid = '${firstScopeUuid}'::uuid then
          perform pg_advisory_xact_lock(80831, 1);
          peer_key := 2;
        else
          perform pg_advisory_xact_lock(80831, 2);
          peer_key := 1;
        end if;
        while not exists (
          select 1
          from pg_locks
          where locktype = 'advisory'
            and classid = 80831
            and objid = peer_key
            and granted
            and pid <> pg_backend_pid()
        ) loop
          wait_count := wait_count + 1;
          if wait_count > 500 then
            raise exception 'timed out preparing the O08-C deadlock';
          end if;
          perform pg_sleep(0.01);
        end loop;
        perform pg_advisory_xact_lock(80831, peer_key);
        return new;
      end
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      before insert on fx_system_commit
      for each row execute function ${functionName}()
    `,
  );
  return Object.freeze({
    attempts: async (): Promise<string> => {
      const result = await persistence.query<{ last_value: string }>(
        `select last_value::text from ${attemptSequence}`,
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Missing PostgreSQL O08-C deadlock attempts.");
      }
      return row.last_value;
    },
    drop: async (): Promise<void> => {
      await persistence.query(
        `drop trigger ${triggerName} on fx_system_commit`,
      );
      await persistence.query(`drop function ${functionName}()`);
      await persistence.query(`drop sequence ${attemptSequence}`);
    },
  });
}

async function installO08CDeadlockExhaustionTriggerPostgres(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const advisoryClassId = 80832;
  const attemptSequence = "fx_test_o08c_deadlock_exhaustion_attempts";
  const functionName = "fx_test_o08c_deadlock_exhaustion_function";
  const triggerName = "fx_test_o08c_deadlock_exhaustion_trigger";
  await persistence.query(`create sequence ${attemptSequence}`);
  await persistence.query(
    `
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $$
      declare
        current_attempt bigint;
        main_key integer;
        peer_key integer;
        wait_count integer := 0;
      begin
        if new.scope_uuid <> '${scopeUuid}'::uuid then
          return new;
        end if;
        current_attempt := nextval('${attemptSequence}');
        main_key := (current_attempt * 2)::integer;
        peer_key := main_key + 1;
        perform pg_advisory_xact_lock(${advisoryClassId}, main_key);
        while not exists (
          select 1
          from pg_locks
          where locktype = 'advisory'
            and classid = ${advisoryClassId}
            and objid = peer_key
            and granted
            and pid <> pg_backend_pid()
        ) loop
          wait_count := wait_count + 1;
          if wait_count > 1000 then
            raise exception 'timed out preparing O08-C deadlock round %',
              current_attempt;
          end if;
          perform pg_sleep(0.005);
        end loop;
        perform pg_advisory_xact_lock(${advisoryClassId}, peer_key);
        return new;
      end
      $$
    `,
  );
  await persistence.query(
    `
      create trigger ${triggerName}
      before insert on fx_system_commit
      for each row execute function ${functionName}()
    `,
  );
  return Object.freeze({
    advisoryClassId,
    attemptSequence,
    attempts: async (): Promise<string> => {
      const result = await persistence.query<{ last_value: string }>(
        `select last_value::text from ${attemptSequence}`,
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Missing PostgreSQL O08-C exhaustion attempts.");
      }
      return row.last_value;
    },
    drop: async (): Promise<void> => {
      await persistence.query(
        `drop trigger ${triggerName} on fx_system_commit`,
      );
      await persistence.query(`drop function ${functionName}()`);
      await persistence.query(`drop sequence ${attemptSequence}`);
    },
  });
}

async function driveO08CDeadlockCompanions(
  persistence: PostgresFlarexPersistence,
  trigger: Awaited<
    ReturnType<typeof installO08CDeadlockExhaustionTriggerPostgres>
  >,
  rounds: 3,
): Promise<void> {
  for (let round = 1; round <= rounds; round += 1) {
    const mainKey = round * 2;
    const peerKey = mainKey + 1;
    const deadline = Date.now() + 10_000;
    let mainLockGranted = false;
    while (Date.now() < deadline) {
      const sequence = await persistence.query<{
        last_value: string;
        is_called: boolean;
        main_lock_granted: boolean;
      }>(
        `
          select
            last_value::text,
            is_called,
            exists (
              select 1
              from pg_locks
              where locktype = 'advisory'
                and classid = $1
                and objid = $2
                and granted
            ) as main_lock_granted
          from ${trigger.attemptSequence}
        `,
        [trigger.advisoryClassId, mainKey],
      );
      const row = sequence.rows[0];
      if (
        row !== undefined &&
        row.is_called &&
        BigInt(row.last_value) >= BigInt(round) &&
        row.main_lock_granted
      ) {
        mainLockGranted = true;
        break;
      }
      await delay(5);
    }
    if (!mainLockGranted) {
      throw new Error(
        `Timed out waiting for O08-C deadlock main lock ${round}.`,
      );
    }
    const client = await persistence.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
      await client.query("set local lock_timeout = '15s'");
      await client.query(
        "select pg_advisory_xact_lock($1, $2)",
        [trigger.advisoryClassId, peerKey],
      );
      const waitingDeadline = Date.now() + 10_000;
      let mainWaitingOnPeer = false;
      while (Date.now() < waitingDeadline) {
        const waiting = await client.query<{ main_waiting: boolean }>(
          `
            select exists (
              select 1
              from pg_locks
              where locktype = 'advisory'
                and classid = $1
                and objid = $2
                and not granted
                and pid <> pg_backend_pid()
            ) as main_waiting
          `,
          [trigger.advisoryClassId, peerKey],
        );
        if (waiting.rows[0]?.main_waiting === true) {
          mainWaitingOnPeer = true;
          break;
        }
        await delay(5);
      }
      if (!mainWaitingOnPeer) {
        throw new Error(
          `Timed out waiting for O08-C deadlock peer wait ${round}.`,
        );
      }
      // Give the publication backend a deterministic head start on PostgreSQL's
      // ordinary deadlock timer without requiring privileged GUC changes.
      await delay(50);
      await client.query(
        "select pg_advisory_xact_lock($1, $2)",
        [trigger.advisoryClassId, mainKey],
      );
      await client.query("rollback");
      transactionOpen = false;
    } finally {
      if (transactionOpen) {
        await client.query("rollback").catch(() => undefined);
      }
      client.release();
    }
  }
}

async function o08CPublicationState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const result = await persistence.query<{
    revisions: string;
    current_rows: string;
    commit_headers: string;
    commit_changes: string;
    outcomes: string;
    wakes: string;
    last_commit_seq: string;
    last_outbox_seq: string;
    header_xmin: string;
    committed_at_micros: string;
  }>(
    `
      select
        (select count(*)::text from fx_app_row_rev
          where scope_uuid = $1) as revisions,
        (select count(*)::text from fx_app_row_current
          where scope_uuid = $1) as current_rows,
        (select count(*)::text from fx_system_commit
          where scope_uuid = $1) as commit_headers,
        (select count(*)::text from fx_system_commit_app_row_change
          where scope_uuid = $1) as commit_changes,
        (select count(*)::text from fx_system_idempotency
          where scope_uuid = $1) as outcomes,
        (select count(*)::text from fx_system_outbox
          where scope_uuid = $1) as wakes,
        clock.last_commit_seq::text,
        clock.last_outbox_seq::text,
        coalesce((select header.xmin::text from fx_system_commit header
          where header.scope_uuid = $1
          order by header.commit_seq desc
          limit 1), '') as header_xmin,
        coalesce((select floor(
          extract(epoch from header.committed_at) * 1000000
        )::bigint::text from fx_system_commit header
          where header.scope_uuid = $1
          order by header.commit_seq desc
          limit 1), '') as committed_at_micros
      from fx_system_scope_clock clock
      where clock.scope_uuid = $1
    `,
    [scopeUuid],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing PostgreSQL O08-C state.");
  return row;
}

async function o08CInterleavingPublicationRows(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const [headers, changes, outcomes, wakes] = await Promise.all([
    persistence.query<{
      commit_seq: string;
      transaction_id: string;
      committed_at_micros: string;
      change_count: number;
    }>(
      `
        select commit_seq::text,
          xmin::text as transaction_id,
          floor(extract(epoch from committed_at) * 1000000)::bigint::text
            as committed_at_micros,
          change_count
        from fx_system_commit
        where scope_uuid = $1
        order by commit_seq
      `,
      [scopeUuid],
    ),
    persistence.query<{
      commit_seq: string;
      change_ordinal: number;
    }>(
      `
        select commit_seq::text, change_ordinal
        from fx_system_commit_app_row_change
        where scope_uuid = $1
        order by commit_seq, change_ordinal
      `,
      [scopeUuid],
    ),
    persistence.query<{
      request_key: string;
      commit_seq: string;
      result_state: string;
    }>(
      `
        select request_key, commit_seq::text, result_state
        from fx_system_idempotency
        where scope_uuid = $1
        order by commit_seq
      `,
      [scopeUuid],
    ),
    persistence.query<{
      outbox_seq: string;
      commit_seq: string;
      event_kind: string;
      delivery_state: string;
    }>(
      `
        select outbox_seq::text, commit_seq::text,
          event_kind, delivery_state
        from fx_system_outbox
        where scope_uuid = $1
        order by outbox_seq
      `,
      [scopeUuid],
    ),
  ]);
  return Object.freeze({
    headers: headers.rows,
    changes: changes.rows,
    outcomes: outcomes.rows,
    wakes: wakes.rows,
  });
}

async function o08CAttemptState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
) {
  const result = await persistence.query<{
    lifecycle: string;
    leases: string;
    journals: string;
  }>(
    `
      select session.lifecycle,
        (select count(*)::text from fx_system_snapshot_lease lease
          where lease.scope_uuid = session.scope_uuid
            and lease.session_id = session.session_id) as leases,
        (select count(*)::text from fx_system_tx_journal journal
          where journal.scope_uuid = session.scope_uuid
            and journal.session_id = session.session_id) as journals
      from fx_system_tx_session session
      where session.scope_uuid = $1 and session.session_id = $2
    `,
    [scopeUuid, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Missing PostgreSQL O08-C attempt state.");
  }
  return row;
}

async function o08DispositionPostgresState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
) {
  const result = await persistence.query<{
    lifecycle: string;
    claims: string;
    leases: string;
    journals: string;
    receipts: string;
    points: string;
    write_events: string;
    headers: string;
    changes: string;
    outcomes: string;
    wakes: string;
    last_commit_seq: string;
    last_outbox_seq: string;
  }>(
    `
      select session.lifecycle,
        (select count(*)::text from fx_system_tx_execution_claim claim
          where claim.scope_uuid = session.scope_uuid
            and claim.session_id = session.session_id) as claims,
        (select count(*)::text from fx_system_snapshot_lease lease
          where lease.scope_uuid = session.scope_uuid
            and lease.session_id = session.session_id) as leases,
        (select count(*)::text from fx_system_tx_journal journal
          where journal.scope_uuid = session.scope_uuid
            and journal.session_id = session.session_id) as journals,
        (select count(*)::text from fx_system_tx_journal_latest_receipt receipt
          where receipt.scope_uuid = session.scope_uuid
            and receipt.session_id = session.session_id) as receipts,
        (select count(*)::text from fx_system_tx_journal_point point
          where point.scope_uuid = session.scope_uuid
            and point.session_id = session.session_id) as points,
        (select count(*)::text from fx_system_tx_journal_write_event event
          where event.scope_uuid = session.scope_uuid
            and event.session_id = session.session_id) as write_events,
        (select count(*)::text from fx_system_commit header
          where header.scope_uuid = session.scope_uuid) as headers,
        (select count(*)::text from fx_system_commit_app_row_change change
          where change.scope_uuid = session.scope_uuid) as changes,
        (select count(*)::text from fx_system_idempotency outcome
          where outcome.scope_uuid = session.scope_uuid) as outcomes,
        (select count(*)::text from fx_system_outbox wake
          where wake.scope_uuid = session.scope_uuid) as wakes,
        clock.last_commit_seq::text,
        clock.last_outbox_seq::text
      from fx_system_tx_session session
      join fx_system_scope_clock clock
        on clock.scope_uuid = session.scope_uuid
      where session.scope_uuid = $1 and session.session_id = $2
    `,
    [scopeUuid, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Missing PostgreSQL O08 disposition state.");
  }
  return row;
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

function schedulerRun(
  persistence: PostgresFlarexPersistence,
  owner: string,
  multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect">,
  budgets: Readonly<{
    readonly scopeLimit: number;
    readonly maxAttemptPages: number;
    readonly maxCandidateAttempts: number;
  }>,
) {
  const target = createPostgresLocatedPointMutationSessionActivationTargetV1(
    persistence,
    sharedLocator("scheduler-run"),
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located scheduler transaction target.");
  }
  const repository = createPointMutationRedeliverySchedulerCheckpointV1(
    target,
    { claimDurationMilliseconds: 60_000, randomUuid: () => owner },
  );
  return Result.getOrThrow(createPointMutationRedeliverySchedulerRunV1(
    schedulerCheckpointPort(repository),
    multiScope,
    Object.freeze({
      maximumInvocations: 1,
      maximumAttemptPages: budgets.maxAttemptPages,
      maximumCandidateAttempts: budgets.maxCandidateAttempts,
      scopeLimitPerInvocation: budgets.scopeLimit,
      maximumRunMilliseconds: 10_000,
      maximumInvocationMilliseconds: 5_000,
      settlementReserveMilliseconds: 1_000,
    }),
  ));
}

async function installSchedulerSingleton(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(
    `insert into fx_system_point_mutation_redelivery_scheduler
       (scheduler_key, scheduler_state, run_fence, checkpoint_sequence)
     values ($1, 'idle', 0, 0)
     on conflict (scheduler_key) do nothing`,
    [POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1],
  );
}

function schedulerCheckpointPort(
  repository: PointMutationRedeliverySchedulerCheckpointV1,
): PointMutationRedeliverySchedulerCheckpointPortV1<
  PointMutationRedeliverySchedulerRunV1,
  PointMutationRedeliverySchedulerConfigurationV1Error,
  PointMutationRedeliverySchedulerAcquireV1Error,
  PointMutationRedeliverySchedulerRenewV1Error,
  PointMutationRedeliverySchedulerCheckpointV1Error,
  PointMutationRedeliverySchedulerReleaseV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error
> {
  return Object.freeze({
    ...repository,
    isAcquireConfirmedRollback:
      isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error,
    isRenewConfirmedRollback:
      isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error,
    isCheckpointConfirmedRollback:
      isPointMutationRedeliverySchedulerCheckpointConfirmedRollbackV1Error,
    isReleaseConfirmedRollback:
      isPointMutationRedeliverySchedulerReleaseConfirmedRollbackV1Error,
  });
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
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
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
  });
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
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const result = await client.query(
      `explain (format json) ${query.sql}`,
      [...query.params],
    );
    return JSON.stringify(result.rows);
  });
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

function installClientQueryFault(
  client: PoolClient,
  fault: (
    statement: string,
    forward: () => unknown,
  ) => unknown,
): void {
  const originalQuery = client.query;
  const installed = Reflect.set(
    client,
    "query",
    (...args: ReadonlyArray<unknown>): unknown => fault(
      postgresStatementText(args[0]),
      () => Reflect.apply(originalQuery, client, args),
    ),
  );
  if (!installed) throw new Error("Failed to install the client query fault.");
}

function postgresStatementText(statement: unknown): string {
  if (typeof statement === "string") return statement.trim().toLowerCase();
  if (
    typeof statement === "object" &&
    statement !== null &&
    "text" in statement &&
    typeof statement.text === "string"
  ) {
    return statement.text.trim().toLowerCase();
  }
  return "";
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
