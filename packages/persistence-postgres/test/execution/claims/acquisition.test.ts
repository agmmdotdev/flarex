import { eq, sql } from "drizzle-orm";
import { fxSystemTransactionSessions, fxSystemScopeExecutionAuthorities, fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../../src/database/schema";
import { PointMutationSessionAuthorityCorruptionV1Error } from "../../../src/execution/session/errors";
import { PointMutationExecutionClaimAcquisitionCorruptionV1Error } from "../../../src/execution/claims/transactionExecutionClaimErrors";
import { Cause, Effect, Exit } from "effect";
import { finiteApplicationMetadataScenario } from "../../application/finiteApplicationMetadataScenario";
import { createMigratedPGlitePersistence, migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import { ReplacementScopeIdV1Schema, decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../../src/database/pglite";
import {
  PointMutationExecutionClaimAcquisitionConfigurationV1Error,
  PointMutationExecutionClaimAcquisitionPersistenceV1Error,
  PointMutationExecutionClaimAcquisitionResourceV1Error,
  PointMutationExecutionClaimAcquisitionStaleV1Error,
} from "../../../src/execution/claims/transactionExecutionClaimErrors";
import {
  createPointMutationExecutionClaimAcquisitionV1,
} from "../../../src/execution/claims/acquisition";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
  PointMutationSessionActivationResolutionPortsV1,
} from "../../../src/execution/session/constructionContracts";
import type {
  PointMutationSessionAnchorV1,
} from "../../../src/execution/session/contracts";
import {
  PointMutationExecutionClaimLivenessStaleV1Error,
} from "../../../src/execution/claims/transactionExecutionClaimErrors";
import {
  createPointMutationExecutionClaimLivenessV1,
} from "../../../src/execution/claims/transactionExecutionClaimLiveness";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  pointMutationSessionActivationFixture,
} from "../session/support/activationEvidence";
import { activatePointMutationSession } from "../session/support/attemptFixture";
import { setFlarexActivationClock } from "../session/support/authorityClock";
import { runEffect, runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import {
  sharedLocator,
  type ActivationContext,
  selectorFromAnchor,
  resolutionPorts,
} from "../session/support/activationFixture";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";

const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

describe("O03-B1 point-mutation session activation", () => {
  let activationDriver: ReturnType<typeof newTestPGlite> | undefined;

  let persistence: PGliteFlarexPersistence;

  let uuidCounter = 1;


  beforeAll(async () => {
    const acquiredDriver = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    activationDriver = acquiredDriver;
    try {
      persistence = await createPGlitePersistence({ db: acquiredDriver });
    } catch (cause) {
      activationDriver = undefined;
      const cleanup = await Promise.allSettled([acquiredDriver.close()]);
      const outcome = cleanup[0];
      if (outcome?.status === "rejected") {
        throw new AggregateError([cause, outcome.reason], "Session activation setup and cleanup failed");
      }
      throw cause;
    }
  });

  afterAll(async () => {
    const acquiredDriver = activationDriver;
    activationDriver = undefined;
    await acquiredDriver?.close();
  });


  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `42000000-0000-4000-8000-${suffix}`;
  }


  async function provisionContext(label: string): Promise<ActivationContext> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_activation_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => nextUuid(),
      },
    ).ensure({
      deploymentId,
      projectId: `project_activation_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return {
      deploymentId,
      scopeId,
    };
  }


  function activationPersistence(
    options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  ) {
    return createPointMutationSessionActivationPersistenceV1(
      resolutionPorts(persistence, options),
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: () => nextUuid(),
      },
    );
  }


  function executionClaimAcquisition(owner: string) {
    return createPointMutationExecutionClaimAcquisitionV1(
      resolutionPorts(persistence),
      {
        durationMilliseconds: 30_000,
        randomOwner: () => owner,
      },
    );
  }


  async function activateClaimScenario(label: string) {
    const context = await provisionContext(label);
    const activation = await activatePointMutationSession(
      activationPersistence(),
      pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a new execution-claim scenario.");
    }
    return activation;
  }


  function executionClaimLiveness(
    targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  ) {
    return createPointMutationExecutionClaimLivenessV1(
      resolutionPorts(persistence, targetOptions),
      {
        claimDurationMilliseconds: 120_000,
        leaseRenewalDurationMilliseconds: 180_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      },
    );
  }


  async function expireExecutionClaim(sessionId: string): Promise<void> {
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [sessionId],
    );
  }


  it("reports an out-of-JS-range running finite date as typed corruption during recovery acquisition without writes", async () => {
    const persistence = await createMigratedPGlitePersistence(undefined, "finiteCapture");
    await finiteApplicationMetadataScenario(persistence, { afterMetadata: async entry => {
      const anchor = entry.context.anchor;
      expect(anchor.executionProfile).toBe("finiteRoot");
      const acquisition = createPointMutationExecutionClaimAcquisitionV1(entry.sessionAuthority, { durationMilliseconds: 60_000 });
      await persistence.drizzle.update(fxSystemTransactionSessions).set({
        finiteClaimedAt: sql`clock_timestamp() - interval '2 minutes'`,
        finiteClaimExpiresAt: sql`clock_timestamp() - interval '1 minute'`,
      }).where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
      expect(await runEffect(acquisition.acquireEffect(selectorFromAnchor(anchor)))).toMatchObject({ kind: "finiteRecovery" });
      // Deliberate stored-state fault: PostgreSQL accepts this finite timestamp,
      // but the real Drizzle timestamp decoder cannot represent it as a JS Date.
      await persistence.drizzle.update(fxSystemTransactionSessions).set({
        updatedAt: sql`'290000-01-01 00:00:00+00'::timestamptz`,
      }).where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
      const [storedTimestamp] = await persistence.drizzle.select({
        nativeFinite: sql<boolean>`isfinite(${fxSystemTransactionSessions.updatedAt})`,
        exactTimestamp: sql<boolean>`${fxSystemTransactionSessions.updatedAt} = '290000-01-01 00:00:00+00'::timestamptz`,
        updatedAt: fxSystemTransactionSessions.updatedAt,
      }).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
      if (storedTimestamp === undefined) throw new Error("Missing actual finite running timestamp");
      expect(storedTimestamp.nativeFinite).toBe(true);
      expect(storedTimestamp.exactTimestamp).toBe(true);
      expect(Number.isNaN(storedTimestamp.updatedAt.getTime())).toBe(true);
      const beforeSession = await persistence.drizzle.select({ stored: sql<string>`to_jsonb(${fxSystemTransactionSessions})::text` }).from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
      expect(beforeSession).toHaveLength(1);
      const beforeClock = await persistence.getScopeClock(anchor.scopeId);
      expect(beforeClock).not.toBeNull();
      const beforeAuthority = await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities).where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId));
      expect(beforeAuthority).toHaveLength(1);
      for (const table of [fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims])
        expect(await persistence.drizzle.select().from(table).where(eq(table.sessionId, anchor.sessionId))).toEqual([]);
      const exit = await Effect.runPromiseExit(acquisition.acquireEffect(selectorFromAnchor(anchor)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const failures = exit.cause.reasons.filter(Cause.isFailReason);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.error).toBeInstanceOf(PointMutationExecutionClaimAcquisitionCorruptionV1Error);
        expect(failures[0]?.error).toMatchObject({ _tag: "PointMutationExecutionClaimAcquisitionCorruptionV1Error", reason: "sessionInvalid",
          cause: { _tag: "PointMutationSessionAuthorityCorruptionV1Error", issue: "sessionRecordInvalid" } });
        if (failures[0]?.error instanceof PointMutationExecutionClaimAcquisitionCorruptionV1Error)
          expect(failures[0].error.cause).toBeInstanceOf(PointMutationSessionAuthorityCorruptionV1Error);
        expect(exit.cause.reasons.filter(Cause.isDieReason)).toHaveLength(0);
        expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toHaveLength(0);
      }
      expect(await persistence.drizzle.select({ stored: sql<string>`to_jsonb(${fxSystemTransactionSessions})::text` }).from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId))).toEqual(beforeSession);
      expect(await persistence.getScopeClock(anchor.scopeId)).toEqual(beforeClock);
      expect(await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities).where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId))).toEqual(beforeAuthority);
      for (const table of [fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims])
        expect(await persistence.drizzle.select().from(table).where(eq(table.sessionId, anchor.sessionId))).toEqual([]);
    } });
  }, 120_000);

  it("preserves lease and journal-root corruption discriminants", async () => {
    const missingRoot = await activateClaimScenario(
      "liveness_missing_journal_root",
    );
    await persistence.query(
      `delete from fx_system_tx_journal where session_id = $1`,
      [missingRoot.anchor.sessionId],
    );
    await expect(runFailure(executionClaimLiveness().renewEffect({
      selector: selectorFromAnchor(missingRoot.anchor),
      executionClaim: missingRoot.executionClaim,
    }))).resolves.toMatchObject({ reason: "journalRootInvalid" });

    const missingLease = await activateClaimScenario("liveness_missing_lease");
    await persistence.query(
      `delete from fx_system_tx_journal where session_id = $1`,
      [missingLease.anchor.sessionId],
    );
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [missingLease.anchor.sessionId],
    );
    await expect(runFailure(executionClaimLiveness().renewEffect({
      selector: selectorFromAnchor(missingLease.anchor),
      executionClaim: missingLease.executionClaim,
    }))).resolves.toMatchObject({ reason: "leaseInvalid" });
  });


  it("keeps failed roots dispatch-closed and never revives an expired claim", async () => {
    const failed = await activateClaimScenario("liveness_failed_root");
    await persistence.query(
      `update fx_system_tx_journal
       set state = 'failed', failure_dimension = 'readDocuments',
           updated_at = clock_timestamp()
       where session_id = $1`,
      [failed.anchor.sessionId],
    );
    await expect(runEffect(executionClaimLiveness().renewEffect({
      selector: selectorFromAnchor(failed.anchor),
      executionClaim: failed.executionClaim,
    }))).resolves.toMatchObject({
      kind: "terminalizationRequired",
      reason: "failedRoot",
      executionClaim: {
        claimOwner: failed.executionClaim.claimOwner,
        claimFence: failed.executionClaim.claimFence,
      },
    });

    const expired = await activateClaimScenario("liveness_expired_claim");
    await expireExecutionClaim(expired.anchor.sessionId);
    await expect(runFailure(executionClaimLiveness().renewEffect({
      selector: selectorFromAnchor(expired.anchor),
      executionClaim: expired.executionClaim,
    }))).resolves.toEqual(
      new PointMutationExecutionClaimLivenessStaleV1Error({
        reason: "claimExpired",
      }),
    );
  });


  async function executionClaimRow(sessionId: string): Promise<Readonly<{
    claim_owner: string;
    claim_fence: string;
  }>> {
    const result = await persistence.query<Readonly<{
      claim_owner: string;
      claim_fence: string;
    }>>(
      `select claim_owner::text, claim_fence::text
       from fx_system_tx_execution_claim where session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined || result.rows.length !== 1) {
      throw new Error("Expected one exact execution claim.");
    }
    return row;
  }


  async function insertExpiredOutcome(
    anchor: PointMutationSessionAnchorV1,
  ): Promise<void> {
    await persistence.query(
      `with clock as (
         update fx_system_scope_clock
         set last_commit_seq = 1
         where scope_id = $1
         returning scope_uuid, scope_id
       )
       insert into fx_system_commit (
         scope_uuid, epoch_uuid, commit_seq, change_count, committed_at
       )
       select c.scope_uuid, a.epoch_uuid, 1, 0, clock_timestamp() from clock c
       join fx_system_scope_execution_authority a on a.scope_id = c.scope_id`,
      [anchor.scopeId],
    );
    await persistence.query(
      `insert into fx_system_idempotency (
         scope_uuid, request_key, identity_access_policy_sha256,
         function_path, request_sha256, epoch_uuid, commit_seq,
         result_state, result_expired_at, created_at
       )
       select s.scope_uuid, s.request_key, s.identity_access_policy_sha256,
         s.function_path, s.request_sha256, a.epoch_uuid, 1,
         'expired', clock_timestamp(), clock_timestamp() - interval '1 second'
       from fx_system_tx_session s
       join fx_system_scope_clock c using (scope_uuid)
       join fx_system_scope_execution_authority a on a.scope_id = c.scope_id
       where s.session_id = $1`,
      [anchor.sessionId],
    );
  }


  it("acquires only an expired pristine claim and advances its fence exactly once", async () => {
    const current = await activateClaimScenario("claim_takeover");
    expect(current.anchor.executionProfile).toBe("durableOperations");
    expect((await persistence.query<{ execution_profile: string }>(
      "select execution_profile from fx_system_tx_journal where session_id = $1",
      [current.anchor.sessionId])).rows)
      .toEqual([{ execution_profile: "durableOperations" }]);
    const selector = selectorFromAnchor(current.anchor);
    const busy = await runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008001")
        .acquireEffect(selector),
    );
    expect(busy).toEqual({
      kind: "busy",
      observation: current.executionClaim,
    });

    await expireExecutionClaim(current.anchor.sessionId);
    const acquired = await runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008002")
        .acquireEffect(selector),
    );
    expect(acquired).toMatchObject({
      kind: "acquired",
      mode: "execute",
      observation: {
        claimOwner: "42000000-0000-4000-8000-000000008002",
        claimFence: 2n,
      },
    });
    if (acquired.kind !== "acquired") {
      throw new Error("Expected the expired exact claim to be acquired.");
    }
    expect(Date.parse(acquired.observation.claimExpiresAt)).toBeGreaterThan(
      Date.parse(acquired.observation.claimedAt),
    );
    await expect(executionClaimRow(current.anchor.sessionId)).resolves.toEqual({
      claim_owner: acquired.observation.claimOwner,
      claim_fence: "2",
    });

    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008003")
        .acquireEffect(selector),
    )).resolves.toEqual({
      kind: "busy",
      observation: acquired.observation,
    });
  });


  it("keeps acquisition configuration and authority-resolution failures in their owning channels", async () => {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_claim_authority_failure",
    );
    const scopeId = ReplacementScopeIdV1Schema.make(
      "scope_42000000-0000-4000-8000-000000008090",
    );
    const selector = Object.freeze({
      deploymentId,
      scopeId,
      sessionId: TransactionSessionIdV1Schema.make(
        "42000000-0000-4000-8000-000000008090",
      ),
      attemptFence: TransactionAttemptFenceSchema.make(1n),
    });
    const inaccessibleTarget = {
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Provisioning receipt must not be read.");
        },
      },
      scopeSessionTargets: {
        resolve: async () => {
          throw new Error("Scope target must not be resolved.");
        },
      },
    } as const;
    const missingAuthorityPorts = {
      scopeMetadata: {
        getScopeMetadata: async () => null,
        getScopeMetadataByDeploymentId: async () => null,
      },
      ...inaccessibleTarget,
    } satisfies PointMutationSessionActivationResolutionPortsV1;

    let configurationFailure: unknown;
    try {
      createPointMutationExecutionClaimAcquisitionV1(
        missingAuthorityPorts,
        { durationMilliseconds: 0 },
      );
    } catch (cause) {
      configurationFailure = cause;
    }
    expect(configurationFailure).toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionConfigurationV1Error",
      reason: "invalidClaimDuration",
    } satisfies Partial<
      PointMutationExecutionClaimAcquisitionConfigurationV1Error
    >);

    await expect(runEffect(
      createPointMutationExecutionClaimAcquisitionV1(
        missingAuthorityPorts,
        {
          durationMilliseconds: 30_000,
          randomOwner: () => "42000000-0000-4000-8000-000000008091",
        },
      ).acquireEffect(selector),
    )).rejects.toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionStaleV1Error",
      reason: "deploymentChanged",
    } satisfies Partial<PointMutationExecutionClaimAcquisitionStaleV1Error>);

    const portFailure = new Error("scope metadata unavailable");
    const failedPort = {
      scopeMetadata: {
        getScopeMetadata: async () => {
          throw portFailure;
        },
        getScopeMetadataByDeploymentId: async () => {
          throw portFailure;
        },
      },
      ...inaccessibleTarget,
    } satisfies PointMutationSessionActivationResolutionPortsV1;
    await expect(runEffect(
      createPointMutationExecutionClaimAcquisitionV1(failedPort, {
        durationMilliseconds: 30_000,
        randomOwner: () => "42000000-0000-4000-8000-000000008092",
      }).acquireEffect(selector),
    )).rejects.toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionPersistenceV1Error",
      operation: "prelude",
      cause: portFailure,
    } satisfies Partial<PointMutationExecutionClaimAcquisitionPersistenceV1Error>);

    const context = await provisionContext("claim_target_resolution_failure");
    const targetResolutionFailure = new Error("scope target unavailable");
    const targetResolutionPorts = {
      ...resolutionPorts(persistence),
      scopeSessionTargets: {
        resolve: async () => {
          throw targetResolutionFailure;
        },
      },
    } satisfies PointMutationSessionActivationResolutionPortsV1;
    await expect(runEffect(
      createPointMutationExecutionClaimAcquisitionV1(targetResolutionPorts, {
        durationMilliseconds: 30_000,
        randomOwner: () => "42000000-0000-4000-8000-000000008093",
      }).acquireEffect({
        deploymentId: context.deploymentId,
        scopeId: context.scopeId,
        sessionId: TransactionSessionIdV1Schema.make(
          "42000000-0000-4000-8000-000000008093",
        ),
        attemptFence: TransactionAttemptFenceSchema.make(1n),
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionPersistenceV1Error",
      operation: "prelude",
      cause: targetResolutionFailure,
    } satisfies Partial<PointMutationExecutionClaimAcquisitionPersistenceV1Error>);
  });


  it("classifies sealed, dirty, failed, and exhausted expired claims", async () => {
    const sealed = await activateClaimScenario("claim_sealed");
    await persistence.query(
      `update fx_system_tx_journal
       set state = 'sealed',
           sealed_journal_bytes = $2,
           sealed_journal_sha256 = $3,
           sealed_result_value_codec_version = 1,
           sealed_result_semantic_bytes = 0,
           sealed_result_bytes = $2,
           sealed_result_sha256 = $3,
           sealed_at = clock_timestamp(),
           updated_at = clock_timestamp()
       where session_id = $1`,
      [sealed.anchor.sessionId, new Uint8Array([0]), new Uint8Array(32)],
    );
    await persistence.query(
      `update fx_system_snapshot_lease as lease
       set lease_expires_at = least(
         session.authorization_grant_expires_at,
         session.hard_expires_at
       )
       from fx_system_tx_session as session
       where lease.scope_uuid = session.scope_uuid
         and lease.session_id = session.session_id
         and lease.attempt_fence = session.attempt_fence
         and session.session_id = $1`,
      [sealed.anchor.sessionId],
    );
    await expireExecutionClaim(sealed.anchor.sessionId);
    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008011")
        .acquireEffect(selectorFromAnchor(sealed.anchor)),
    )).resolves.toMatchObject({ kind: "acquired", mode: "finishOnly" });

    const mismatchedSealed = await activateClaimScenario(
      "claim_sealed_non_target",
    );
    await persistence.query(
      `update fx_system_tx_journal
       set state = 'sealed',
           sealed_journal_bytes = $2,
           sealed_journal_sha256 = $3,
           sealed_result_value_codec_version = 1,
           sealed_result_semantic_bytes = 0,
           sealed_result_bytes = $2,
           sealed_result_sha256 = $3,
           sealed_at = clock_timestamp(),
           updated_at = clock_timestamp()
       where session_id = $1`,
      [
        mismatchedSealed.anchor.sessionId,
        new Uint8Array([0]),
        new Uint8Array(32),
      ],
    );
    await expireExecutionClaim(mismatchedSealed.anchor.sessionId);
    const claimBeforeRejection = await executionClaimRow(
      mismatchedSealed.anchor.sessionId,
    );
    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008093")
        .acquireEffect(selectorFromAnchor(mismatchedSealed.anchor)),
    )).rejects.toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionCorruptionV1Error",
      reason: "leaseInvalid",
    });
    await expect(executionClaimRow(mismatchedSealed.anchor.sessionId))
      .resolves.toEqual(claimBeforeRejection);

    const expiredMismatchedSealed = await activateClaimScenario(
      "claim_sealed_expired_non_target",
    );
    await persistence.query(
      `update fx_system_tx_journal
       set state = 'sealed',
           sealed_journal_bytes = $2,
           sealed_journal_sha256 = $3,
           sealed_result_value_codec_version = 1,
           sealed_result_semantic_bytes = 0,
           sealed_result_bytes = $2,
           sealed_result_sha256 = $3,
           sealed_at = clock_timestamp(),
           updated_at = clock_timestamp()
       where session_id = $1`,
      [
        expiredMismatchedSealed.anchor.sessionId,
        new Uint8Array([0]),
        new Uint8Array(32),
      ],
    );
    await persistence.query(
      `update fx_system_snapshot_lease
       set lease_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [expiredMismatchedSealed.anchor.sessionId],
    );
    await expireExecutionClaim(expiredMismatchedSealed.anchor.sessionId);
    const expiredClaimBeforeRejection = await executionClaimRow(
      expiredMismatchedSealed.anchor.sessionId,
    );
    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008094")
        .acquireEffect(selectorFromAnchor(expiredMismatchedSealed.anchor)),
    )).rejects.toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionCorruptionV1Error",
      reason: "leaseInvalid",
    });
    await expect(executionClaimRow(expiredMismatchedSealed.anchor.sessionId))
      .resolves.toEqual(expiredClaimBeforeRejection);

    const dirty = await activateClaimScenario("claim_dirty");
    await persistence.query(
      `update fx_system_tx_journal
       set last_syscall_sequence = 1, updated_at = clock_timestamp()
       where session_id = $1`,
      [dirty.anchor.sessionId],
    );
    await expireExecutionClaim(dirty.anchor.sessionId);
    const dirtyAcquisition = await runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008012")
        .acquireEffect(selectorFromAnchor(dirty.anchor)),
    );
    expect(dirtyAcquisition).toMatchObject({
      kind: "acquired",
      mode: "abortOnly",
      reason: "dirtyOpen",
      observation: {
        claimOwner: "42000000-0000-4000-8000-000000008012",
        claimFence: 2n,
      },
    });
    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008092")
        .acquireEffect(selectorFromAnchor(dirty.anchor)),
    )).resolves.toMatchObject({
      kind: "busy",
      observation: {
        claimOwner: "42000000-0000-4000-8000-000000008012",
        claimFence: 2n,
      },
    });
    await expect(executionClaimRow(dirty.anchor.sessionId)).resolves
      .toMatchObject({
        claim_fence: "2",
        claim_owner: "42000000-0000-4000-8000-000000008012",
      });

    const failed = await activateClaimScenario("claim_failed");
    await persistence.query(
      `update fx_system_tx_journal
       set state = 'failed', failure_dimension = 'readDocuments',
           updated_at = clock_timestamp()
       where session_id = $1`,
      [failed.anchor.sessionId],
    );
    await expireExecutionClaim(failed.anchor.sessionId);
    const failedAcquisition = await runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008013")
        .acquireEffect(selectorFromAnchor(failed.anchor)),
    );
    expect(failedAcquisition).toMatchObject({
      kind: "acquired",
      mode: "abortOnly",
      reason: "failedRoot",
      observation: {
        claimOwner: "42000000-0000-4000-8000-000000008013",
        claimFence: 2n,
      },
    });

    const exhausted = await activateClaimScenario("claim_exhausted");
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claim_fence = $2,
           claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [exhausted.anchor.sessionId, POSTGRES_SIGNED_BIGINT_MAX],
    );
    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008014")
        .acquireEffect(selectorFromAnchor(exhausted.anchor)),
    )).rejects.toBeInstanceOf(
      PointMutationExecutionClaimAcquisitionResourceV1Error,
    );
    await expect(executionClaimRow(exhausted.anchor.sessionId)).resolves
      .toMatchObject({ claim_fence: POSTGRES_SIGNED_BIGINT_MAX.toString() });
  });


  it("returns inert finishing evidence without minting or mutating a claim", async () => {
    const current = await activateClaimScenario("claim_finishing");
    await persistence.query(
      `update fx_system_tx_session
       set lifecycle = 'finishing', updated_at = clock_timestamp()
       where session_id = $1`,
      [current.anchor.sessionId],
    );
    const before = await executionClaimRow(current.anchor.sessionId);

    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008015")
        .acquireEffect(selectorFromAnchor(current.anchor)),
    )).resolves.toEqual({ kind: "finishing" });
    await expect(executionClaimRow(current.anchor.sessionId)).resolves.toEqual(
      before,
    );
  });


  it("resolves a committed outcome before touching an expired execution claim", async () => {
    const current = await activateClaimScenario("claim_outcome_first");
    await expireExecutionClaim(current.anchor.sessionId);
    await insertExpiredOutcome(current.anchor);
    const before = await executionClaimRow(current.anchor.sessionId);

    const result = await runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008021")
        .acquireEffect(selectorFromAnchor(current.anchor)),
    );
    expect(result).toMatchObject({
      kind: "replayed",
      outcome: { kind: "expired", token: { commitSeq: 1n } },
    });
    await expect(executionClaimRow(current.anchor.sessionId)).resolves.toEqual(
      before,
    );

    for (const randomOwner of [
      () => {
        throw new Error("owner generation must not run for replay");
      },
      () => "not-a-uuid",
    ]) {
      let ownerCalls = 0;
      const acquisition = createPointMutationExecutionClaimAcquisitionV1(
        resolutionPorts(persistence),
        {
          durationMilliseconds: 30_000,
          randomOwner: () => {
            ownerCalls += 1;
            return randomOwner();
          },
        },
      );
      await expect(runEffect(acquisition.acquireEffect({
        ...selectorFromAnchor(current.anchor),
        attemptFence: TransactionAttemptFenceSchema.make(2n),
      }))).resolves.toMatchObject({
        kind: "replayed",
        outcome: { kind: "expired", token: { commitSeq: 1n } },
      });
      expect(ownerCalls).toBe(0);
    }
  });
});
