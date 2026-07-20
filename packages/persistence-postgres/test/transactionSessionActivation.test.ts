import { Effect, Exit, Fiber } from "effect";
import {
  ReplacementScopeIdV1Schema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { Json, JsonObject } from "flarex-protocol/json";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionPackageIdV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import {
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionSessions,
} from "../src/schema";
import {
  PointMutationSessionActivationConfigurationV1Error,
  PointMutationSessionActivationPersistenceV1Error,
  PointMutationSessionActivationV1Error,
  PointMutationExecutionClaimAcquisitionConfigurationV1Error,
  PointMutationExecutionClaimAcquisitionPersistenceV1Error,
  PointMutationExecutionClaimAcquisitionResourceV1Error,
  PointMutationExecutionClaimAcquisitionStaleV1Error,
  createPointMutationExecutionClaimAcquisitionV1,
  PointMutationSessionAuthorityCorruptionV1Error,
  createPointMutationSessionActivationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionAnchorV1,
} from "../src/transactionSessionActivation";
import {
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "./effectTestRuntime";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "activation-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

type RootActivationExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionActivationPersistenceV1"
>;

interface ActivationContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>;
}

describe("O03-B1 point-mutation session activation", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
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

  async function expireExecutionClaim(sessionId: string): Promise<void> {
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [sessionId],
    );
  }

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
         returning scope_uuid, epoch_uuid
       )
       insert into fx_system_commit (
         scope_uuid, epoch_uuid, commit_seq, change_count, committed_at
       )
       select scope_uuid, epoch_uuid, 1, 0, clock_timestamp() from clock`,
      [anchor.scopeId],
    );
    await persistence.query(
      `insert into fx_system_idempotency (
         scope_uuid, request_key, identity_access_policy_sha256,
         function_path, request_sha256, epoch_uuid, commit_seq,
         result_state, result_expired_at, created_at
       )
       select s.scope_uuid, s.request_key, s.identity_access_policy_sha256,
         s.function_path, s.request_sha256, c.epoch_uuid, 1,
         'expired', clock_timestamp(), clock_timestamp() - interval '1 second'
       from fx_system_tx_session s
       join fx_system_scope_clock c using (scope_uuid)
       where s.session_id = $1`,
      [anchor.sessionId],
    );
  }

  it("keeps activation off the broad persistence facade", () => {
    expectTypeOf<RootActivationExport>().toEqualTypeOf<never>();
  });

  it("maps metadata rejection into the typed Effect persistence channel", async () => {
    const context = await provisionContext("metadata_effect_failure");
    const cause = new Error("activation metadata transport unavailable");
    const basePorts = resolutionPorts(persistence);
    const activation = createPointMutationSessionActivationPersistenceV1(
      {
        ...basePorts,
        scopeMetadata: {
          getScopeMetadataByDeploymentId: async () => {
            throw cause;
          },
        },
      },
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: () => nextUuid(),
      },
    );

    const failure = await runFailure(activation.activateEffect(
      pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ),
    ));
    expect(failure).toBeInstanceOf(
      PointMutationSessionActivationPersistenceV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PointMutationSessionActivationPersistenceV1Error",
      operation: "scopeMetadataRead",
      cause,
    });
  });

  it("atomically creates one running anchor and reports its live claim as busy", async () => {
    const context = await provisionContext("create_replay");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );
    const activation = activationPersistence();

    const created = await activatePointMutationSession(activation, input);

    expect(created.status).toBe("created");
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.anchor)).toBe(true);
    expect(Object.isFrozen(created.anchor.snapshotToken)).toBe(true);
    expect(created.anchor).toMatchObject({
      deploymentId: context.deploymentId,
      scopeId: context.scopeId,
      requestKey: input.evidence.requestKey,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      attemptFence: 1n,
      snapshotToken: {
        scopeId: context.scopeId,
        commitSeq: 0n,
      },
      hardExpiresAt: input.evidence.authorizationGrantExpiresAt.toISOString(),
    });
    expect(created.anchor.createdAt).toBe(created.anchor.updatedAt);
    expect(
      Date.parse(created.anchor.leaseExpiresAt) -
        Date.parse(created.anchor.createdAt),
    ).toBe(60_000);

    const persisted = await persistence.query<{
      sessions: number;
      leases: number;
      journals: number;
      execution_claims: number;
      timestamps_equal: boolean;
      hard_expiry_matches: boolean;
      lease_duration_matches: boolean;
      claim_owner: string;
      claim_fence: string;
      claim_matches_session_time: boolean;
      lifecycle: string;
      attempt_fence: string;
      snapshot_commit_seq: string;
    }>(
      `
        select
          (select count(*)::int from fx_system_tx_session
            where scope_uuid = c.scope_uuid) as sessions,
          (select count(*)::int from fx_system_snapshot_lease
            where scope_uuid = c.scope_uuid) as leases,
          (select count(*)::int from fx_system_tx_journal
            where scope_uuid = c.scope_uuid) as journals,
          (select count(*)::int from fx_system_tx_execution_claim
            where scope_uuid = c.scope_uuid) as execution_claims,
          s.created_at = s.updated_at as timestamps_equal,
          s.hard_expires_at = s.authorization_grant_expires_at
            as hard_expiry_matches,
          l.lease_expires_at = s.created_at + interval '60 seconds'
            as lease_duration_matches,
          x.claim_owner::text,
          x.claim_fence::text,
          x.claimed_at = s.created_at as claim_matches_session_time,
          s.lifecycle,
          s.attempt_fence::text,
          l.snapshot_commit_seq::text
        from fx_system_scope_clock c
        join fx_system_tx_session s on s.scope_uuid = c.scope_uuid
        join fx_system_snapshot_lease l
          on l.scope_uuid = s.scope_uuid
         and l.session_id = s.session_id
         and l.attempt_fence = s.attempt_fence
        join fx_system_tx_execution_claim x
          on x.scope_uuid = s.scope_uuid
         and x.session_id = s.session_id
         and x.attempt_fence = s.attempt_fence
        where c.scope_id = $1
      `,
      [context.scopeId],
    );
    expect(persisted.rows).toEqual([
      {
        sessions: 1,
        leases: 1,
        journals: 1,
        execution_claims: 1,
        timestamps_equal: true,
        hard_expiry_matches: true,
        lease_duration_matches: true,
        claim_owner: created.status === "created"
          ? created.executionClaim.claimOwner
          : "unreachable",
        claim_fence: "1",
        claim_matches_session_time: true,
        lifecycle: "running",
        attempt_fence: "1",
        snapshot_commit_seq: "0",
      },
    ]);

    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 7 where scope_id = $1`,
      [context.scopeId],
    );
    const replayed = await activatePointMutationSession(activation, input);

    expect(replayed.status).toBe("busy");
    expect(replayed.anchor).toEqual(created.anchor);
    await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
      sessions: 1,
      leases: 1,
      journals: 1,
      executionClaims: 1,
    });
  });

  it("acquires only an expired pristine claim and advances its fence exactly once", async () => {
    const current = await activateClaimScenario("claim_takeover");
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

  it("replays an inert anchor after a lost activation response even when its claim expired", async () => {
    const context = await provisionContext("claim_lost_activation_response");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );
    const activation = activationPersistence();
    const created = await activatePointMutationSession(activation, input);
    if (created.status !== "created") {
      throw new Error("Expected a newly created activation.");
    }
    await expireExecutionClaim(created.anchor.sessionId);
    const before = await executionClaimRow(created.anchor.sessionId);

    await expect(activatePointMutationSession(activation, input)).resolves
      .toEqual({ status: "busy", anchor: created.anchor });
    await expect(executionClaimRow(created.anchor.sessionId)).resolves.toEqual(
      before,
    );
    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008009")
        .acquireEffect(selectorFromAnchor(created.anchor)),
    )).resolves.toMatchObject({
      kind: "acquired",
      mode: "execute",
      observation: { claimFence: 2n },
    });
  });

  it("classifies sealed, dirty, failed, and exhausted expired claims", async () => {
    const sealed = await activateClaimScenario("claim_sealed");
    await persistence.query(
      `update fx_system_tx_journal
       set state = 'sealed',
           sealed_final_syscall_sequence = last_syscall_sequence,
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
    await expireExecutionClaim(sealed.anchor.sessionId);
    await expect(runEffect(
      executionClaimAcquisition("42000000-0000-4000-8000-000000008011")
        .acquireEffect(selectorFromAnchor(sealed.anchor)),
    )).resolves.toMatchObject({ kind: "acquired", mode: "finishOnly" });

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

  it("rejects non-JSON prepared evidence before persistence", async () => {
    const context = await provisionContext("invalid_prepared_json");
    const activation = activationPersistence();

    for (const evidence of [
      { validatedArgsJson: { nested: Number.POSITIVE_INFINITY } },
      { authorizationGrantJson: { nested: Number.POSITIVE_INFINITY } },
    ]) {
      const input = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
        { evidence },
      );

      await expect(
        activatePointMutationSession(activation, input),
      ).rejects.toMatchObject({
        issue: { reason: "invalidPreparedEvidence" },
      } satisfies Partial<PointMutationSessionActivationV1Error>);
    }

    await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
      sessions: 0,
      leases: 0,
      journals: 0,
      executionClaims: 0,
    });
  });

  it("preserves __proto__ as validated argument data across persistence and replay", async () => {
    const context = await provisionContext("proto_argument");
    const validatedArgsJson = jsonObjectWithProtoData();
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      { evidence: { validatedArgsJson } },
    );
    const activation = activationPersistence();

    const created = await activatePointMutationSession(activation, input);
    const persisted = await persistence.query<{
      validated_args_json: JsonObject;
    }>(
      `
        select s.validated_args_json
        from fx_system_tx_session s
        join fx_system_scope_clock c using (scope_uuid)
        where c.scope_id = $1
      `,
      [context.scopeId],
    );
    const persistedArgs = persisted.rows[0]?.validated_args_json;
    if (persistedArgs === undefined) {
      throw new Error("Activated session persisted no validated arguments.");
    }

    expect(Object.hasOwn(validatedArgsJson, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(validatedArgsJson)).toBe(Object.prototype);
    expect(Object.hasOwn(persistedArgs, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(persistedArgs)).toBe(Object.prototype);
    expect(persistedArgs["__proto__"]).toEqual({ polluted: true });

    const replayed = await activatePointMutationSession(activation, input);
    expect(replayed.status).toBe("busy");
    expect(replayed.anchor).toEqual(created.anchor);
  });

  it("preserves normalized negative-zero JSON while the claim is busy", async () => {
    const context = await provisionContext("negative_zero_argument");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      { evidence: { validatedArgsJson: { value: -0 } } },
    );
    const activation = activationPersistence();

    const created = await activatePointMutationSession(activation, input);
    const persisted = await persistence.query<{
      validated_args_json: JsonObject;
    }>(
      `
        select s.validated_args_json
        from fx_system_tx_session s
        join fx_system_scope_clock c using (scope_uuid)
        where c.scope_id = $1
      `,
      [context.scopeId],
    );

    expect(Object.is(persisted.rows[0]?.validated_args_json.value, 0)).toBe(
      true,
    );
    const replayed = await activatePointMutationSession(activation, input);
    expect(replayed.status).toBe("busy");
    expect(replayed.anchor).toEqual(created.anchor);
  });

  it("caps the initial lease at the verified grant hard expiry", async () => {
    const context = await provisionContext("expiry_cap");
    const databaseTime = await persistence.query<{ now: string }>(
      "select clock_timestamp()::text as now",
    );
    const nowText = databaseTime.rows[0]?.now;
    const nowMilliseconds =
      typeof nowText === "string" ? Date.parse(nowText) : Number.NaN;
    if (!Number.isFinite(nowMilliseconds)) {
      throw new Error("PGlite returned no clock.");
    }
    const grantExpiry = new Date(nowMilliseconds + 300_000);
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      { evidence: { authorizationGrantExpiresAt: grantExpiry } },
    );
    const activation = createPointMutationSessionActivationPersistenceV1(
      resolutionPorts(persistence),
      {
        leaseDurationMilliseconds: 3_600_000,
        randomUuid: () => nextUuid(),
      },
    );

    const result = await activatePointMutationSession(activation, input);

    expect(result.anchor.hardExpiresAt).toBe(grantExpiry.toISOString());
    expect(result.anchor.leaseExpiresAt).toBe(grantExpiry.toISOString());
    expect(Date.parse(result.anchor.leaseExpiresAt)).toBeGreaterThan(
      Date.parse(result.anchor.createdAt),
    );
  });

  it("fails closed on changed evidence, terminal reopen, and invalid lease state", async () => {
    const changedContext = await provisionContext("changed_evidence");
    const changedActivation = activationPersistence();
    const changedInput = pointMutationSessionActivationFixture(
      changedContext.deploymentId,
      changedContext.scopeId,
    );
    await activatePointMutationSession(changedActivation, changedInput);
    const conflictingInput = pointMutationSessionActivationFixture(
      changedContext.deploymentId,
      changedContext.scopeId,
      {
        evidence: {
          packageId: TransactionPackageIdV1Schema.make(
            "package_activation_conflict",
          ),
        },
      },
    );
    await expect(
      activatePointMutationSession(changedActivation, conflictingInput),
    ).rejects.toMatchObject({
      issue: { reason: "requestKeyConflict" },
    } satisfies Partial<PointMutationSessionActivationV1Error>);

    const terminalContext = await provisionContext("terminal");
    const terminalActivation = activationPersistence();
    const terminalInput = pointMutationSessionActivationFixture(
      terminalContext.deploymentId,
      terminalContext.scopeId,
    );
    await activatePointMutationSession(terminalActivation, terminalInput);
    await persistence.query(
      `
        update fx_system_tx_session
        set lifecycle = 'aborted'
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [terminalContext.scopeId],
    );
    await expect(
      activatePointMutationSession(terminalActivation, terminalInput),
    ).rejects.toMatchObject({
      issue: { reason: "terminalRequest", lifecycle: "aborted" },
    } satisfies Partial<PointMutationSessionActivationV1Error>);

    const missingLeaseContext = await provisionContext("missing_lease");
    const missingLeaseActivation = activationPersistence();
    const missingLeaseInput = pointMutationSessionActivationFixture(
      missingLeaseContext.deploymentId,
      missingLeaseContext.scopeId,
    );
    await activatePointMutationSession(
      missingLeaseActivation,
      missingLeaseInput,
    );
    await persistence.query(
      `
        delete from fx_system_snapshot_lease
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [missingLeaseContext.scopeId],
    );
    await expect(
      activatePointMutationSession(missingLeaseActivation, missingLeaseInput),
    ).rejects.toMatchObject({
      issue: "snapshotLeaseMissing",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const expiredLeaseContext = await provisionContext("expired_lease");
    const expiredLeaseActivation = activationPersistence();
    const expiredLeaseInput = pointMutationSessionActivationFixture(
      expiredLeaseContext.deploymentId,
      expiredLeaseContext.scopeId,
    );
    await activatePointMutationSession(
      expiredLeaseActivation,
      expiredLeaseInput,
    );
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [expiredLeaseContext.scopeId],
    );
    await expect(
      activatePointMutationSession(expiredLeaseActivation, expiredLeaseInput),
    ).rejects.toMatchObject({
      issue: { reason: "activeAttemptExpired" },
    } satisfies Partial<PointMutationSessionActivationV1Error>);

    const mismatchedLeaseContext = await provisionContext("mismatched_lease");
    const mismatchedLeaseActivation = activationPersistence();
    const mismatchedLeaseInput = pointMutationSessionActivationFixture(
      mismatchedLeaseContext.deploymentId,
      mismatchedLeaseContext.scopeId,
    );
    await activatePointMutationSession(
      mismatchedLeaseActivation,
      mismatchedLeaseInput,
    );
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2099-01-02T00:00:00.000Z'
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [mismatchedLeaseContext.scopeId],
    );
    await expect(
      activatePointMutationSession(
        mismatchedLeaseActivation,
        mismatchedLeaseInput,
      ),
    ).rejects.toMatchObject({
      issue: "snapshotLeaseInvalid",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);
  });

  it("classifies multiple request anchors as authority corruption", async () => {
    const context = await provisionContext("duplicate");
    const activation = activationPersistence();
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );
    const created = await activatePointMutationSession(activation, input);
    const sessions = await persistence.drizzle
      .select()
      .from(fxSystemTransactionSessions);
    const leases = await persistence.drizzle
      .select()
      .from(fxSystemSnapshotLeases);
    const session = sessions.find(
      (row) => row.sessionId === created.anchor.sessionId,
    );
    const lease = leases.find((row) => row.sessionId === session?.sessionId);
    if (session === undefined || lease === undefined) {
      throw new Error("Expected the original activation rows.");
    }
    const duplicateSessionId = TransactionSessionIdV1Schema.make(nextUuid());
    await persistence.drizzle.insert(fxSystemTransactionSessions).values({
      ...session,
      sessionId: duplicateSessionId,
    });
    await persistence.drizzle.insert(fxSystemSnapshotLeases).values({
      ...lease,
      sessionId: duplicateSessionId,
    });

    await expect(
      activatePointMutationSession(activation, input),
    ).rejects.toMatchObject({
      issue: "duplicateRequestAnchors",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);
  });

  it("rolls back both rows after each mutating statement", async () => {
    const context = await provisionContext("rollback");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );

    for (const failureStep of [
      "sessionInserted",
      "leaseInserted",
      "journalRootInserted",
      "executionClaimInserted",
    ] as const) {
      const activation = activationPersistence({
        afterWrite: (step) => {
          if (step === failureStep) throw new Error(`fail:${step}`);
        },
      });

      const failure = await runFailure(activation.activateEffect(input));
      expect(failure).toMatchObject({
        _tag: "PointMutationSessionActivationPersistenceV1Error",
        operation: "activationTransaction",
        cause: expect.objectContaining({ message: `fail:${failureStep}` }),
      });
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 0,
        leases: 0,
        journals: 0,
        executionClaims: 0,
      });
    }
  });

  it("maps activation-transaction rejection once into the typed channel", async () => {
    const context = await provisionContext("typed_transaction_failure");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );
    const cause = new Error("activation transaction unavailable");
    const activation = activationPersistence({
      afterWrite: () => {
        throw cause;
      },
    });

    const failure = await runFailure(activation.activateEffect(input));
    expect(failure).toBeInstanceOf(
      PointMutationSessionActivationPersistenceV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PointMutationSessionActivationPersistenceV1Error",
      operation: "activationTransaction",
      cause,
    });
    await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
      sessions: 0,
      leases: 0,
      journals: 0,
      executionClaims: 0,
    });
  });

  it("does not observe interruption until the activation transaction settles", async () => {
    const context = await provisionContext("transaction_interruption");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const activation = activationPersistence({
      afterWrite: async (step) => {
        if (step !== "sessionInserted") return;
        entered.resolve();
        await release.promise;
      },
    });

    const fiber = Effect.runFork(activation.activateEffect(input));
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
    await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
      sessions: 1,
      leases: 1,
      journals: 1,
      executionClaims: 1,
    });
  });

  it("rejects invalid generated identity before any authority or SQL read", async () => {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_activation_invalid_uuid",
    );
    const scopeId = ReplacementScopeIdV1Schema.make(
      "scope_42000000-0000-4000-8000-000000009999",
    );
    let authorityReads = 0;
    const ports = {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => {
          authorityReads += 1;
          return null;
        },
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          authorityReads += 1;
          return null;
        },
      },
      scopeSessionTargets: {
        resolve: async () => {
          authorityReads += 1;
          throw new Error("Target resolution must not run.");
        },
      },
    } satisfies PointMutationSessionActivationResolutionPortsV1;
    const activation = createPointMutationSessionActivationPersistenceV1(
      ports,
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: () => "not-a-uuid",
      },
    );

    await expect(
      activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(deploymentId, scopeId),
      ),
    ).rejects.toMatchObject({
      issue: { reason: "invalidGeneratedSessionId", value: "not-a-uuid" },
    } satisfies Partial<PointMutationSessionActivationConfigurationV1Error>);

    const taggedIssue = await runEffect(
      activation.activateEffect(
        pointMutationSessionActivationFixture(deploymentId, scopeId),
      ).pipe(
        Effect.catchTag(
          "PointMutationSessionActivationConfigurationV1Error",
          (error) => Effect.succeed(error.issue),
        ),
      ),
    );
    expect(taggedIssue).toEqual({
      reason: "invalidGeneratedSessionId",
      value: "not-a-uuid",
    });
    expect(authorityReads).toBe(0);
  });

  it("fails closed when located authority changes after the preliminary read", async () => {
    const races = [
      {
        label: "generation",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set storage_generation = 'legacy_v1' where scope_id = $1`,
            [scopeId],
          ),
      },
      {
        label: "generation_fence",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set storage_generation_fence = storage_generation_fence + 1
             where scope_id = $1`,
            [scopeId],
          ),
      },
      {
        label: "epoch",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock set epoch = $2 where scope_id = $1`,
            [scopeId, `epoch_${nextUuid()}`],
          ),
      },
      {
        label: "revocation",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set authorization_revocation_epoch = authorization_revocation_epoch + 1
             where scope_id = $1`,
            [scopeId],
          ),
      },
      {
        label: "snapshot",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set last_commit_seq = last_commit_seq + 1 where scope_id = $1`,
            [scopeId],
          ),
      },
    ] as const;

    for (const race of races) {
      const context = await provisionContext(`race_${race.label}`);
      const baseTarget =
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          sharedLocator,
        );
      const ports = {
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async () => ({
            ...baseTarget,
            getCurrentClock: async (scopeId: typeof context.scopeId) => {
              const preliminary = await baseTarget.getCurrentClock(scopeId);
              await race.mutate(scopeId);
              return preliminary;
            },
          }),
        },
      } satisfies PointMutationSessionActivationResolutionPortsV1;
      const activation = createPointMutationSessionActivationPersistenceV1(
        ports,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid: () => nextUuid(),
        },
      );

      await expect(
        activatePointMutationSession(
          activation,
          pointMutationSessionActivationFixture(
            context.deploymentId,
            context.scopeId,
          ),
        ),
      ).rejects.toBeInstanceOf(PointMutationSessionActivationV1Error);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 0,
        leases: 0,
        journals: 0,
        executionClaims: 0,
      });
    }
  });

  it("preserves maximum signed-bigint authority without number coercion", async () => {
    const context = await provisionContext("bigint");
    await setFlarexActivationClock(persistence, context.scopeId, {
      storageGenerationFence: POSTGRES_SIGNED_BIGINT_MAX,
      lastCommitSeq: POSTGRES_SIGNED_BIGINT_MAX,
      authorizationRevocationEpoch: POSTGRES_SIGNED_BIGINT_MAX,
    });
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      {
        evidence: {
          authorizationRevocationEpoch:
            TransactionAuthorizationRevocationEpochSchema.make(
              POSTGRES_SIGNED_BIGINT_MAX,
            ),
        },
      },
    );

    const result = await activatePointMutationSession(
      activationPersistence(),
      input,
    );

    expect(result.anchor.storageGenerationFence).toBe(
      POSTGRES_SIGNED_BIGINT_MAX,
    );
    expect(result.anchor.snapshotToken.commitSeq).toBe(
      POSTGRES_SIGNED_BIGINT_MAX,
    );
  });
});

function jsonObjectWithProtoData(): JsonObject {
  const value: Record<string, Json> = { body: "hello" };
  Object.defineProperty(value, "__proto__", {
    configurable: false,
    enumerable: true,
    value: Object.freeze({ polluted: true } satisfies JsonObject),
    writable: false,
  });
  return Object.freeze(value);
}

function selectorFromAnchor(anchor: PointMutationSessionAnchorV1) {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

function resolutionPorts(
  persistence: PGliteFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): PointMutationSessionActivationResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared activation must not read provisioning receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        ),
    },
  };
}

async function rowCounts(
  persistence: PGliteFlarexPersistence,
  scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>,
): Promise<{
  readonly sessions: number;
  readonly leases: number;
  readonly journals: number;
  readonly executionClaims: number;
}> {
  const result = await persistence.query<{
    sessions: number;
    leases: number;
    journals: number;
    execution_claims: number;
  }>(
    `
      select
        (select count(*)::int from fx_system_tx_session
          where scope_uuid = c.scope_uuid) as sessions,
        (select count(*)::int from fx_system_snapshot_lease
          where scope_uuid = c.scope_uuid) as leases,
        (select count(*)::int from fx_system_tx_journal
          where scope_uuid = c.scope_uuid) as journals,
        (select count(*)::int from fx_system_tx_execution_claim
          where scope_uuid = c.scope_uuid) as execution_claims
      from fx_system_scope_clock c
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Activation scope clock is missing.");
  return Object.freeze({
    sessions: row.sessions,
    leases: row.leases,
    journals: row.journals,
    executionClaims: row.execution_claims,
  });
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
