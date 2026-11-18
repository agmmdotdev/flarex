import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../../src/database/pglite";
import {
  TransactionExecutionClaimOwnerV1Schema,
} from "../../../src/execution/claims/transactionExecutionClaimModel";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
} from "../../../src/execution/session/constructionContracts";
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
  attemptLivenessState,
} from "../session/support/activationFixture";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";

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


  it("jointly renews the open lease and exact execution claim without changing ownership", async () => {
    const created = await activateClaimScenario("liveness_open");
    const before = await attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    );

    const result = await runEffect(executionClaimLiveness().renewEffect({
      selector: selectorFromAnchor(created.anchor),
      executionClaim: created.executionClaim,
    }));

    expect(result).toMatchObject({
      kind: "renewed",
      phase: "open",
      executionClaim: {
        claimOwner: created.executionClaim.claimOwner,
        claimFence: created.executionClaim.claimFence,
        claimedAt: created.executionClaim.claimedAt,
      },
    });
    const after = await attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    );
    expect(after.lease_expires_at.getTime()).toBeGreaterThanOrEqual(
      before.lease_expires_at.getTime(),
    );
    expect(after.claim_expires_at.getTime()).toBeGreaterThanOrEqual(
      before.claim_expires_at.getTime(),
    );
    expect(after).toMatchObject({
      claim_owner: before.claim_owner,
      claim_fence: before.claim_fence,
      claimed_at: before.claimed_at,
    });
  });


  it("refuses to extend an existing lease below the retained-history floor", async () => {
    const created = await activateClaimScenario("liveness_below_floor");
    const before = await attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    );
    await persistence.query(
      `with authority_lock as materialized (
         select scope_id from fx_system_scope_execution_authority where scope_id = $1 for update
       ), sequencer as (
         update fx_system_scope_clock c set last_commit_seq = 1 from authority_lock a
         where c.scope_id = a.scope_id returning c.scope_id
       ) update fx_system_scope_execution_authority a set oldest_available_commit_seq = 1
       from sequencer c where a.scope_id = c.scope_id`,
      [created.anchor.scopeId],
    );

    await expect(runFailure(executionClaimLiveness().renewEffect({
      selector: selectorFromAnchor(created.anchor),
      executionClaim: created.executionClaim,
    }))).resolves.toMatchObject({ reason: "leaseInvalid" });
    await expect(attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    )).resolves.toEqual(before);
  });


  it("admits a new lease exactly at the retained-history floor", async () => {
    const context = await provisionContext("activation_at_floor");
    await persistence.query(
      `with authority_lock as materialized (
         select scope_id from fx_system_scope_execution_authority where scope_id = $1 for update
       ), sequencer as (
         update fx_system_scope_clock c set last_commit_seq = 1 from authority_lock a
         where c.scope_id = a.scope_id returning c.scope_id
       ) update fx_system_scope_execution_authority a set oldest_available_commit_seq = 1
       from sequencer c where a.scope_id = c.scope_id`,
      [context.scopeId],
    );

    const created = await activatePointMutationSession(
      activationPersistence(),
      pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ),
    );
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    await expect(persistence.query<{ snapshot_commit_seq: string }>(
      `select snapshot_commit_seq::text
       from fx_system_snapshot_lease where session_id = $1`,
      [created.anchor.sessionId],
    )).resolves.toMatchObject({
      rows: [{ snapshot_commit_seq: "1" }],
    });
  });


  it("rolls the lease renewal back when claim renewal fails", async () => {
    const created = await activateClaimScenario("liveness_rollback");
    const before = await attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    );
    const liveness = executionClaimLiveness({
      afterExecutionClaimLivenessEvent: (event) => {
        if (event.phase === "write" && event.step === "leaseRenewed") {
          throw new Error("fail:leaseRenewed");
        }
      },
    });

    await expect(runFailure(liveness.renewEffect({
      selector: selectorFromAnchor(created.anchor),
      executionClaim: created.executionClaim,
    }))).resolves.toMatchObject({
      operation: "transaction",
      cause: expect.anything(),
    });
    await expect(attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    )).resolves
      .toEqual(before);
  });


  it("rejects stale claim ownership without mutating liveness", async () => {
    const created = await activateClaimScenario("liveness_stale_owner");
    const before = await attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    );

    await expect(runFailure(executionClaimLiveness().renewEffect({
      selector: selectorFromAnchor(created.anchor),
      executionClaim: {
        ...created.executionClaim,
        claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
          "42000000-0000-4000-8000-999999999999",
        ),
      },
    }))).resolves.toEqual(
      new PointMutationExecutionClaimLivenessStaleV1Error({
        reason: "claimOwnerChanged",
      }),
    );
    await expect(attemptLivenessState(
      persistence,
      created.anchor.sessionId,
    )).resolves
      .toEqual(before);
  });
});
