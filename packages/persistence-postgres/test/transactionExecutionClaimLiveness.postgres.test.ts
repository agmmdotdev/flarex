import { setTimeout as delay } from "node:timers/promises";

import { Result } from "effect";
import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import { decodeReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
} from "../src/transactionSessionActivation";
import { createPointMutationExecutionClaimLivenessV1 } from
  "../src/transactionExecutionClaimLiveness";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { postgresUrl, withTemporaryPostgresPersistence } from
  "./postgresHelpers";
import {
  abortPointMutationSessionAttempt,
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LIVENESS_POLICY = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 86_400_000,
  maximumFutureIssuedAtSkewMilliseconds: 0,
  maximumLiveSnapshotRetentionMilliseconds: 86_400_000,
}));

describePostgres("real Postgres execution-claim liveness", () => {
  it("serializes duplicate renewals and rolls lease plus claim back together", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "claim_liveness",
        sharedLocator("claim-liveness"),
        ids,
      );
      const created = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(
          context.deploymentId,
          context.scopeId,
        ),
      );
      if (created.status !== "created") {
        throw new Error("Expected a new liveness attempt.");
      }
      const input = Object.freeze({
        selector: selectorFromAnchor(created.anchor),
        executionClaim: created.executionClaim,
      });
      const liveness = createLivenessPersistence(persistence);

      const results = await Promise.all([
        runEffect(liveness.renewEffect(input)),
        runEffect(liveness.renewEffect(input)),
      ]);
      expect(results).toMatchObject([
        { kind: "renewed", phase: "open" },
        { kind: "renewed", phase: "open" },
      ]);
      const beforeRollback = await executionClaimLivenessState(
        persistence,
        created.anchor.sessionId,
      );
      const renewedResults = results.filter((result) =>
        result.kind === "renewed"
      );
      expect(renewedResults.map((result) => ({
        claimOwner: result.executionClaim.claimOwner,
        claimFence: result.executionClaim.claimFence,
      }))).toEqual([
        {
          claimOwner: created.executionClaim.claimOwner,
          claimFence: created.executionClaim.claimFence,
        },
        {
          claimOwner: created.executionClaim.claimOwner,
          claimFence: created.executionClaim.claimFence,
        },
      ]);
      expect(beforeRollback.lease_expires_at.getTime()).toBe(Math.max(
        ...renewedResults.map((result) => Date.parse(result.leaseExpiresAt)),
      ));
      expect(beforeRollback.claim_expires_at.getTime()).toBe(Math.max(
        ...renewedResults.map((result) =>
          Date.parse(result.executionClaim.claimExpiresAt)
        ),
      ));

      const rollback = createLivenessPersistence(
        persistence,
        {
          afterExecutionClaimLivenessEvent: (event) => {
            if (
              event.phase === "write" &&
              event.step === "executionClaimRenewed"
            ) {
              throw new Error("fail:executionClaimRenewed");
            }
          },
        },
        { claim: 240_000, lease: 300_000 },
      );
      await expect(runEffectFailure(rollback.renewEffect(input))).resolves
        .toMatchObject({ operation: "transaction" });
      await expect(executionClaimLivenessState(
        persistence,
        created.anchor.sessionId,
      )).resolves.toEqual(beforeRollback);
    });
  }, 120_000);

  it("serializes one scope while an independent scope continues", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "claim_liveness_a",
        sharedLocator("claim-liveness-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "claim_liveness_b",
        sharedLocator("claim-liveness-b"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const createdA = await activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      );
      const createdB = await activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(
          contextB.deploymentId,
          contextB.scopeId,
        ),
      );
      if (createdA.status !== "created" || createdB.status !== "created") {
        throw new Error("Expected two independent liveness attempts.");
      }

      const entered = deferred<void>();
      const release = deferred<void>();
      let held = false;
      const livenessA = createLivenessPersistence(persistence, {
        afterExecutionClaimLivenessEvent: async (event) => {
          if (!held && event.phase === "lock" && event.step === "clockLocked") {
            held = true;
            entered.resolve();
            await release.promise;
          }
        },
      });
      const inputA = Object.freeze({
        selector: selectorFromAnchor(createdA.anchor),
        executionClaim: createdA.executionClaim,
      });
      const firstA = runEffect(livenessA.renewEffect(inputA));
      await entered.promise;
      const secondA = runEffect(
        createLivenessPersistence(persistence).renewEffect(inputA),
      );
      const inputB = Object.freeze({
        selector: selectorFromAnchor(createdB.anchor),
        executionClaim: createdB.executionClaim,
      });

      try {
        await expect(Promise.race([
          runEffect(createLivenessPersistence(persistence).renewEffect(inputB)),
          delay(5_000).then(() => {
            throw new Error("Independent-scope liveness timed out.");
          }),
        ])).resolves.toMatchObject({ kind: "renewed", phase: "open" });
        await expect(Promise.race([
          secondA.then(() => "completed" as const),
          delay(100).then(() => "blocked" as const),
        ])).resolves.toBe("blocked");
      } finally {
        release.resolve();
      }

      await expect(Promise.all([firstA, secondA])).resolves.toMatchObject([
        { kind: "renewed", phase: "open" },
        { kind: "renewed", phase: "open" },
      ]);
    });
  }, 120_000);

  it("cannot renew through an expired-claim takeover", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "claim_liveness_takeover",
        sharedLocator("claim-liveness-takeover"),
        ids,
      );
      const created = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(
          context.deploymentId,
          context.scopeId,
        ),
      );
      if (created.status !== "created") {
        throw new Error("Expected a takeover liveness attempt.");
      }
      await expireExecutionClaim(persistence, created.anchor.sessionId);

      const entered = deferred<void>();
      const release = deferred<void>();
      const renewal = runEffectFailure(createLivenessPersistence(
        persistence,
        {
          afterExecutionClaimLivenessEvent: async (event) => {
            if (event.phase !== "lock" || event.step !== "clockLocked") return;
            entered.resolve();
            await release.promise;
          },
        },
      ).renewEffect({
        selector: selectorFromAnchor(created.anchor),
        executionClaim: created.executionClaim,
      }));
      await entered.promise;
      const acquisition = runEffect(createPointMutationExecutionClaimAcquisitionV1(
        resolutionPorts(persistence),
        {
          durationMilliseconds: 30_000,
          randomOwner: () => "56000000-0000-4000-8000-999999999991",
        },
      ).acquireEffect(selectorFromAnchor(created.anchor)));
      try {
        await expect(Promise.race([
          acquisition.then(() => "completed" as const),
          delay(100).then(() => "blocked" as const),
        ])).resolves.toBe("blocked");
      } finally {
        release.resolve();
      }

      await expect(renewal).resolves.toMatchObject({ reason: "claimExpired" });
      await expect(acquisition).resolves.toMatchObject({
        kind: "acquired",
        observation: {
          claimOwner: "56000000-0000-4000-8000-999999999991",
          claimFence: 2n,
        },
      });
      await expect(executionClaimLivenessState(
        persistence,
        created.anchor.sessionId,
      )).resolves.toMatchObject({
        claim_owner: "56000000-0000-4000-8000-999999999991",
        claim_fence: "2",
      });
    });
  }, 120_000);

  it("rejects renewal after claim-fenced abort wins the scope lock", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "claim_liveness_abort",
        sharedLocator("claim-liveness-abort"),
        ids,
      );
      const created = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(
          context.deploymentId,
          context.scopeId,
        ),
      );
      if (created.status !== "created") {
        throw new Error("Expected an abort liveness attempt.");
      }

      const entered = deferred<void>();
      const release = deferred<void>();
      const terminalization = createPointMutationSessionAttemptTerminalizationPersistenceV1(
        resolutionPorts(persistence, {
          afterTerminalizationEvent: async (event) => {
            if (event.phase !== "lock" || event.step !== "clockLocked") return;
            entered.resolve();
            await release.promise;
          },
        }),
      );
      const abort = abortPointMutationSessionAttempt(terminalization, {
        selector: selectorFromAnchor(created.anchor),
        executionClaim: created.executionClaim,
        expectedSnapshotToken: created.anchor.snapshotToken,
      });
      await entered.promise;
      const renewal = runEffectFailure(createLivenessPersistence(
        persistence,
      ).renewEffect({
        selector: selectorFromAnchor(created.anchor),
        executionClaim: created.executionClaim,
      }));
      try {
        await expect(Promise.race([
          renewal.then(() => "completed" as const),
          delay(100).then(() => "blocked" as const),
        ])).resolves.toBe("blocked");
      } finally {
        release.resolve();
      }

      await expect(abort).resolves.toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "aborted" },
      });
      await expect(renewal).resolves.toMatchObject({
        reason: "lifecycleChanged",
      });
      await expect(attemptFacetCounts(
        persistence,
        created.anchor.sessionId,
      )).resolves.toEqual({ leases: 0, journals: 0, claims: 0 });
      await expect(publicationCounts(persistence, context.scopeId)).resolves
        .toEqual({ commits: 0, outcomes: 0, wakes: 0 });
    });
  }, 120_000);
});

interface ActivationContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly physicalLocator: SharedDatabaseScopePhysicalLocator;
}

async function provisionContext(
  persistence: PostgresFlarexPersistence,
  label: string,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  ids: () => string,
): Promise<ActivationContext> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_claim_liveness_${label}`,
  );
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator, randomUuid: ids },
  ).ensure({ deploymentId, projectId: `project_claim_liveness_${label}` });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  return Object.freeze({ deploymentId, scopeId, physicalLocator });
}

function createActivationPersistence(
  persistence: PostgresFlarexPersistence,
  ids: () => string,
) {
  return createPointMutationSessionActivationPersistenceV1(
    resolutionPorts(persistence),
    { leaseDurationMilliseconds: 60_000, randomUuid: ids },
  );
}

function createLivenessPersistence(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  durations: Readonly<{ readonly claim: number; readonly lease: number }> = {
    claim: 120_000,
    lease: 180_000,
  },
) {
  return createPointMutationExecutionClaimLivenessV1(
    resolutionPorts(persistence, targetOptions),
    {
      claimDurationMilliseconds: durations.claim,
      leaseRenewalDurationMilliseconds: durations.lease,
      grantRetentionPolicy: LIVENESS_POLICY,
    },
  );
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): PointMutationSessionActivationResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared liveness must not read provisioning receipts.");
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

function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

async function executionClaimLivenessState(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<Readonly<{
  readonly lease_expires_at: Date;
  readonly claim_owner: string;
  readonly claim_fence: string;
  readonly claimed_at: Date;
  readonly claim_expires_at: Date;
}>> {
  const result = await persistence.query<{
    lease_expires_at: Date;
    claim_owner: string;
    claim_fence: string;
    claimed_at: Date;
    claim_expires_at: Date;
  }>(
    `select l.lease_expires_at,
            c.claim_owner,
            c.claim_fence::text,
            c.claimed_at,
            c.claim_expires_at
     from fx_system_snapshot_lease l
     join fx_system_tx_execution_claim c
       on c.scope_uuid = l.scope_uuid
      and c.session_id = l.session_id
      and c.attempt_fence = l.attempt_fence
     where l.session_id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error("Expected one exact Postgres liveness row.");
  }
  return Object.freeze({ ...row });
}

async function expireExecutionClaim(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<void> {
  await persistence.query(
    `update fx_system_tx_execution_claim
     set claimed_at = clock_timestamp() - interval '2 minutes',
         claim_expires_at = clock_timestamp() - interval '1 minute'
     where session_id = $1`,
    [sessionId],
  );
}

async function attemptFacetCounts(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<Readonly<{
  readonly leases: number;
  readonly journals: number;
  readonly claims: number;
}>> {
  const result = await persistence.query<{
    leases: number;
    journals: number;
    claims: number;
  }>(
    `select
       (select count(*)::int from fx_system_snapshot_lease
        where session_id = $1) as leases,
       (select count(*)::int from fx_system_tx_journal
        where session_id = $1) as journals,
       (select count(*)::int from fx_system_tx_execution_claim
        where session_id = $1) as claims`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Attempt facet counts are missing.");
  return Object.freeze({ ...row });
}

async function publicationCounts(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<Readonly<{
  readonly commits: number;
  readonly outcomes: number;
  readonly wakes: number;
}>> {
  const result = await persistence.query<{
    commits: number;
    outcomes: number;
    wakes: number;
  }>(
    `select
       (select count(*)::int from fx_system_commit
        where scope_uuid = c.scope_uuid) as commits,
       (select count(*)::int from fx_system_idempotency
        where scope_uuid = c.scope_uuid) as outcomes,
       (select count(*)::int from fx_system_outbox
        where scope_uuid = c.scope_uuid) as wakes
     from fx_system_scope_clock c where c.scope_id = $1`,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Publication counts are missing.");
  return Object.freeze({ ...row });
}

function sharedLocator(databaseKey: string): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

function uuidFactory(): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `56000000-0000-4000-8000-${suffix}`;
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred resolver is unavailable.");
      }
      resolvePromise(value);
    },
  };
}
