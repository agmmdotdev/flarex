import { setTimeout as delay } from "node:timers/promises";

import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionPackageIdV1Schema,
} from "flarex-protocol/transaction-session";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../src/postgresLocatedReadCommitted";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  PointMutationSessionActivationV1Error,
  PointMutationSessionAttemptLoadV1Error,
  PointMutationExecutionClaimAcquisitionResourceV1Error,
  createLocatedPointMutationSessionActivationTargetV1,
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionActivationResultV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
} from "../src/transactionSessionActivation";
import { LOCATED_READ_COMMITTED_RUNNER_V1 } from
  "../src/transactionSessionAttemptKernel";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "./effectTestRuntime";
import {
  abortPointMutationSessionAttempt,
  activatePointMutationSession,
  executionClaimForAnchor,
  expirePointMutationSessionAttempt,
  loadPointMutationSessionAttempt,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

interface ActivationContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly physicalLocator: SharedDatabaseScopePhysicalLocator;
}

describePostgres("real Postgres O03-B session authority", () => {
  it("serializes exact same-request activation into one created and one busy anchor", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "same_request",
        sharedLocator("same-request"),
        ids,
      );
      const activation = createActivationPersistence(
        persistence,
        ids,
      );
      const input = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );

      const results = await Promise.all([
        activatePointMutationSession(activation, input),
        activatePointMutationSession(activation, input),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "busy",
        "created",
      ]);
      expect(results[0]?.anchor).toEqual(results[1]?.anchor);
      const created = results.find((result) => result.status === "created");
      if (created?.status !== "created") {
        throw new Error("Expected one created activation result.");
      }
      const claim = await persistence.query<{
        claim_owner: string;
        claim_fence: string;
      }>(`
        select claim_owner::text, claim_fence::text
        from fx_system_tx_execution_claim
        where session_id = $1
      `, [created.anchor.sessionId]);
      expect(claim.rows).toEqual([{
        claim_owner: created.executionClaim.claimOwner,
        claim_fence: "1",
      }]);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
    });
  }, 120_000);

  it("recovers a lost activation response and advances an expired claim exactly once", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "claim_takeover",
        sharedLocator("claim-takeover"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const input = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );
      const created = await activatePointMutationSession(activation, input);
      if (created.status !== "created") {
        throw new Error("Expected a newly created execution claim.");
      }
      await expireExecutionClaim(persistence, created.anchor.sessionId);

      await expect(activatePointMutationSession(activation, input)).resolves
        .toEqual({ status: "busy", anchor: created.anchor });

      const selector = selectorFromAnchor(created.anchor);
      const results = await Promise.all([
        runEffect(createExecutionClaimAcquisition(
          persistence,
          "42000000-0000-4000-8000-000000009001",
        ).acquireEffect(selector)),
        runEffect(createExecutionClaimAcquisition(
          persistence,
          "42000000-0000-4000-8000-000000009002",
        ).acquireEffect(selector)),
      ]);
      const acquired = results.find((result) => result.kind === "acquired");
      const busy = results.find((result) => result.kind === "busy");
      if (acquired?.kind !== "acquired" || busy?.kind !== "busy") {
        throw new Error("Expected one acquired and one busy claim result.");
      }

      expect(acquired).toMatchObject({
        mode: "execute",
        observation: { claimFence: 2n },
      });
      expect(busy.observation).toEqual(acquired.observation);
      await expect(executionClaimRow(
        persistence,
        created.anchor.sessionId,
      )).resolves.toEqual({
        claim_owner: acquired.observation.claimOwner,
        claim_fence: "2",
      });
    });
  }, 120_000);

  it("rejects an expired non-target sealed lease without mutating its evidence", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "claim_expired_non_target_sealed_lease",
        sharedLocator("claim-expired-non-target-sealed-lease"),
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
        throw new Error("Expected an expired non-target sealed-lease attempt.");
      }
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
        [
          created.anchor.sessionId,
          new Uint8Array([0]),
          new Uint8Array(32),
        ],
      );
      await persistence.query(
        `update fx_system_snapshot_lease
         set lease_expires_at = clock_timestamp() - interval '1 minute'
         where session_id = $1`,
        [created.anchor.sessionId],
      );
      await expireExecutionClaim(persistence, created.anchor.sessionId);
      const claimBefore = await executionClaimRow(
        persistence,
        created.anchor.sessionId,
      );
      const countsBefore = await rowCounts(persistence, context.scopeId);

      await expect(runFailure(createExecutionClaimAcquisition(
        persistence,
        "42000000-0000-4000-8000-000000009003",
      ).acquireEffect(selectorFromAnchor(created.anchor)))).resolves
        .toMatchObject({
          _tag: "PointMutationExecutionClaimAcquisitionCorruptionV1Error",
          reason: "leaseInvalid",
        });
      await expect(executionClaimRow(
        persistence,
        created.anchor.sessionId,
      )).resolves.toEqual(claimBefore);
      await expect(rowCounts(persistence, context.scopeId)).resolves
        .toEqual(countsBefore);
      await expect(persistence.query<{ state: string }>(
        `select state from fx_system_tx_journal where session_id = $1`,
        [created.anchor.sessionId],
      )).resolves.toMatchObject({ rows: [{ state: "sealed" }] });
    });
  }, 120_000);

  it("resolves a committed outcome before owner generation and stale-fence checks", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "claim_outcome_first",
        sharedLocator("claim-outcome-first"),
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
        throw new Error("Expected a newly created outcome-first attempt.");
      }
      await expireExecutionClaim(persistence, created.anchor.sessionId);
      await insertExpiredOutcome(persistence, created.anchor);
      const before = await executionClaimRow(
        persistence,
        created.anchor.sessionId,
      );
      let ownerCalls = 0;
      const acquisition = createPointMutationExecutionClaimAcquisitionV1(
        resolutionPorts(persistence),
        {
          durationMilliseconds: 30_000,
          randomOwner: () => {
            ownerCalls += 1;
            throw new Error("Committed replay must not generate an owner.");
          },
        },
      );

      await expect(runEffect(acquisition.acquireEffect({
        ...selectorFromAnchor(created.anchor),
        attemptFence: TransactionAttemptFenceSchema.make(2n),
      }))).resolves.toMatchObject({
        kind: "replayed",
        outcome: { kind: "expired", token: { commitSeq: 1n } },
      });
      expect(ownerCalls).toBe(0);
      await expect(executionClaimRow(
        persistence,
        created.anchor.sessionId,
      )).resolves.toEqual(before);
    });
  }, 120_000);

  it("mints no settled acquisition from either kind of lost COMMIT response", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const forwardedContext = await provisionContext(
        persistence,
        "claim_forwarded_commit",
        sharedLocator("claim-forwarded-commit"),
        ids,
      );
      const forwarded = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(
          forwardedContext.deploymentId,
          forwardedContext.scopeId,
        ),
      );
      if (forwarded.status !== "created") {
        throw new Error("Expected a forwarded-COMMIT claim scenario.");
      }
      await expireExecutionClaim(persistence, forwarded.anchor.sessionId);
      const forwardedAcquisition = createPointMutationExecutionClaimAcquisitionV1(
        resolutionPortsWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.resolve(forward()).then(() => {
                  throw new Error("Execution-claim COMMIT response lost.");
                })
              : forward(),
          ),
        }),
        {
          durationMilliseconds: 30_000,
          randomOwner: () => "42000000-0000-4000-8000-000000009021",
        },
      );

      await expect(runFailure(forwardedAcquisition.acquireEffect(
        selectorFromAnchor(forwarded.anchor),
      ))).resolves.toMatchObject({
        _tag: "PointMutationExecutionClaimAcquisitionPersistenceV1Error",
        operation: "transaction",
      });
      await expect(executionClaimRow(
        persistence,
        forwarded.anchor.sessionId,
      )).resolves.toEqual({
        claim_owner: "42000000-0000-4000-8000-000000009021",
        claim_fence: "2",
      });
      await expect(runEffect(createExecutionClaimAcquisition(
        persistence,
        "42000000-0000-4000-8000-000000009022",
      ).acquireEffect(selectorFromAnchor(forwarded.anchor)))).resolves
        .toMatchObject({
          kind: "busy",
          observation: {
            claimOwner: "42000000-0000-4000-8000-000000009021",
            claimFence: 2n,
          },
        });

      const missingContext = await provisionContext(
        persistence,
        "claim_not_forwarded_commit",
        sharedLocator("claim-not-forwarded-commit"),
        ids,
      );
      const missing = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(
          missingContext.deploymentId,
          missingContext.scopeId,
        ),
      );
      if (missing.status !== "created") {
        throw new Error("Expected a not-forwarded-COMMIT claim scenario.");
      }
      await expireExecutionClaim(persistence, missing.anchor.sessionId);
      const prior = await executionClaimRow(
        persistence,
        missing.anchor.sessionId,
      );
      const missingAcquisition = createPointMutationExecutionClaimAcquisitionV1(
        resolutionPortsWithRunner(persistence, {
          afterAcquire: (client) => installClientQueryFault(
            client,
            (statement, forward) => statement === "commit"
              ? Promise.reject(
                  new Error("Execution-claim COMMIT was not forwarded."),
                )
              : forward(),
          ),
        }),
        {
          durationMilliseconds: 30_000,
          randomOwner: () => "42000000-0000-4000-8000-000000009023",
        },
      );

      await expect(runFailure(missingAcquisition.acquireEffect(
        selectorFromAnchor(missing.anchor),
      ))).resolves.toMatchObject({
        _tag: "PointMutationExecutionClaimAcquisitionPersistenceV1Error",
        operation: "transaction",
      });
      await expect(executionClaimRow(
        persistence,
        missing.anchor.sessionId,
      )).resolves.toEqual(prior);
      await expect(runEffect(createExecutionClaimAcquisition(
        persistence,
        "42000000-0000-4000-8000-000000009024",
      ).acquireEffect(selectorFromAnchor(missing.anchor)))).resolves
        .toMatchObject({
          kind: "acquired",
          mode: "execute",
          observation: {
            claimOwner: "42000000-0000-4000-8000-000000009024",
            claimFence: 2n,
          },
        });
    });
  }, 120_000);

  it("rejects an expired maximum claim fence without mutation", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "claim_fence_exhausted",
        sharedLocator("claim-fence-exhausted"),
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
        throw new Error("Expected a claim-fence exhaustion scenario.");
      }
      await persistence.query(
        `update fx_system_tx_execution_claim
         set claim_fence = 9223372036854775807,
             claimed_at = clock_timestamp() - interval '2 minutes',
             claim_expires_at = clock_timestamp() - interval '1 minute'
         where session_id = $1`,
        [created.anchor.sessionId],
      );

      await expect(runFailure(createExecutionClaimAcquisition(
        persistence,
        "42000000-0000-4000-8000-000000009031",
      ).acquireEffect(selectorFromAnchor(created.anchor)))).resolves
        .toBeInstanceOf(PointMutationExecutionClaimAcquisitionResourceV1Error);
      await expect(executionClaimRow(
        persistence,
        created.anchor.sessionId,
      )).resolves.toMatchObject({ claim_fence: "9223372036854775807" });
    });
  }, 120_000);

  it("lets an independent scope take over while another scope clock is locked", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "claim_independent_a",
        sharedLocator("claim-independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "claim_independent_b",
        sharedLocator("claim-independent-b"),
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
        throw new Error("Expected two newly created claim scenarios.");
      }
      await Promise.all([
        expireExecutionClaim(persistence, createdA.anchor.sessionId),
        expireExecutionClaim(persistence, createdB.anchor.sessionId),
      ]);

      const held = await holdScopeClock(persistence, contextA.scopeId);
      const pendingA = runEffect(createExecutionClaimAcquisition(
        persistence,
        "42000000-0000-4000-8000-000000009011",
      ).acquireEffect(selectorFromAnchor(createdA.anchor)));
      try {
        await waitForBlockedScopeClock(persistence, held);
        await expect(Promise.race([
          runEffect(createExecutionClaimAcquisition(
            persistence,
            "42000000-0000-4000-8000-000000009012",
          ).acquireEffect(selectorFromAnchor(createdB.anchor))),
          delay(5_000).then(() => {
            throw new Error("Independent-scope claim acquisition timed out.");
          }),
        ])).resolves.toMatchObject({
          kind: "acquired",
          mode: "execute",
          observation: { claimFence: 2n },
        });
      } finally {
        await held.client.query("rollback").catch(() => undefined);
        held.client.release();
      }
      await expect(pendingA).resolves.toMatchObject({
        kind: "acquired",
        mode: "execute",
        observation: { claimFence: 2n },
      });
    });
  }, 120_000);

  it("gives changed-evidence competition one winner under the scope lock", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "changed_competition",
        sharedLocator("changed-competition"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const first = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );
      const second = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
        {
          evidence: {
            packageId: TransactionPackageIdV1Schema.make(
              "package_activation_competitor",
            ),
          },
        },
      );

      const settled = await Promise.allSettled([
        activatePointMutationSession(activation, first),
        activatePointMutationSession(activation, second),
      ]);
      const fulfilled = settled.find(
        (result) => result.status === "fulfilled",
      );
      const rejected = settled.find(
        (result) => result.status === "rejected",
      );

      expect(settled.filter((result) => result.status === "fulfilled"))
        .toHaveLength(1);
      expect(settled.filter((result) => result.status === "rejected"))
        .toHaveLength(1);
      expect(fulfilled?.status === "fulfilled" && fulfilled.value.status)
        .toBe("created");
      expect(rejected?.status === "rejected" ? rejected.reason : undefined)
        .toMatchObject({
        issue: { reason: "requestKeyConflict" },
      } satisfies Partial<PointMutationSessionActivationV1Error>);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
    });
  });

  it("allows an independent scope to activate while another scope transaction is paused", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "independent_a",
        sharedLocator("independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "independent_b",
        sharedLocator("independent-b"),
        ids,
      );
      const entered = deferred<void>();
      const release = deferred<void>();
      const activationA = createActivationPersistence(persistence, ids, {
        afterWrite: async (step) => {
          if (step !== "sessionInserted") return;
          entered.resolve();
          await release.promise;
        },
      });
      const activationB = createActivationPersistence(persistence, ids);
      const pendingA = activatePointMutationSession(
        activationA,
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      );
      await entered.promise;

      let resultB: PointMutationSessionActivationResultV1 | undefined;
      try {
        resultB = await Promise.race([
          activatePointMutationSession(
            activationB,
            pointMutationSessionActivationFixture(
              contextB.deploymentId,
              contextB.scopeId,
            ),
          ),
          delay(5_000).then(() => {
            throw new Error("Independent-scope activation timed out.");
          }),
        ]);
      } finally {
        release.resolve();
      }
      const resultA = await pendingA;
      if (resultB === undefined) {
        throw new Error("Independent-scope activation returned no result.");
      }

      expect(resultA.status).toBe("created");
      expect(resultB.status).toBe("created");
      await expect(rowCounts(persistence, contextA.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
      await expect(rowCounts(persistence, contextB.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
    });
  });

  it("rolls back all four authoritative facets after every mutating statement", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "rollback",
        sharedLocator("rollback"),
        ids,
      );
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
        const activation = createActivationPersistence(persistence, ids, {
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
  });

  it("serializes concurrent exact reloads without mutating their anchor or lease", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_reload",
        sharedLocator("attempt-reload"),
        ids,
      );
      const activated = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(
          context.deploymentId,
          context.scopeId,
        ),
      );
      const selector = selectorFromAnchor(activated.anchor);
      const before = await attemptRowState(persistence, context.scopeId);
      const steps: string[] = [];
      const loader = createLoadPersistence(persistence, {
        afterLoadLock: (step) => {
          steps.push(step);
        },
      });

      const results = await Promise.all([
        loadPointMutationSessionAttempt(loader, selector),
        loadPointMutationSessionAttempt(loader, Object.freeze({ ...selector })),
      ]);

      expect(results[0]).toEqual(results[1]);
      expect(results[0]?.anchor).toEqual(activated.anchor);
      expect(steps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "executionClaimLocked",
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "executionClaimLocked",
      ]);
      await expect(attemptRowState(persistence, context.scopeId))
        .resolves.toEqual(before);
    });
  });

  it("allows an independent scope to reload while another exact attempt is paused", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "attempt_independent_a",
        sharedLocator("attempt-independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "attempt_independent_b",
        sharedLocator("attempt-independent-b"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const anchorA = (await activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      )).anchor;
      const anchorB = (await activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(
          contextB.deploymentId,
          contextB.scopeId,
        ),
      )).anchor;
      const entered = deferred<void>();
      const release = deferred<void>();
      const loaderA = createLoadPersistence(persistence, {
        afterLoadLock: async (step) => {
          if (step !== "sessionLocked") return;
          entered.resolve();
          await release.promise;
        },
      });
      const loaderB = createLoadPersistence(persistence);
      const pendingA = loadPointMutationSessionAttempt(
        loaderA,
        selectorFromAnchor(anchorA),
      );
      await entered.promise;

      let resultB;
      try {
        resultB = await Promise.race([
          loadPointMutationSessionAttempt(loaderB, selectorFromAnchor(anchorB)),
          delay(5_000).then(() => {
            throw new Error("Independent-scope attempt reload timed out.");
          }),
        ]);
      } finally {
        release.resolve();
      }
      const resultA = await pendingA;

      expect(resultA.anchor).toEqual(anchorA);
      expect(resultB.anchor).toEqual(anchorB);
    });
  });

  it("uses database time only after the exact lease lock", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_expiry",
        sharedLocator("attempt-expiry"),
        ids,
      );
      const anchor = (
        await activatePointMutationSession(
          createActivationPersistence(persistence, ids),
          pointMutationSessionActivationFixture(
            context.deploymentId,
            context.scopeId,
          ),
        )
      ).anchor;
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set lease_expires_at = clock_timestamp() + interval '2 seconds'
          where session_id = $1
        `,
        [anchor.sessionId],
      );
      const loader = createLoadPersistence(persistence, {
        afterLoadLock: async (step) => {
          if (step === "leaseLocked") await delay(2_200);
        },
      });

      await expect(loadPointMutationSessionAttempt(
        loader,
        selectorFromAnchor(anchor),
      ))
        .rejects.toMatchObject({
          issue: { reason: "activeAttemptExpired" },
        } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    });
  });

  it("rejects authority that changes after preliminary placement resolution", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_authority_race",
        sharedLocator("attempt-authority-race"),
        ids,
      );
      const anchor = (
        await activatePointMutationSession(
          createActivationPersistence(persistence, ids),
          pointMutationSessionActivationFixture(
            context.deploymentId,
            context.scopeId,
          ),
        )
      ).anchor;
      const baseTarget =
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          context.physicalLocator,
        );
      const ports = {
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (): Promise<LocatedScopeClockReader> => ({
            ...baseTarget,
            getCurrentClock: async (scopeId) => {
              const preliminary = await baseTarget.getCurrentClock(scopeId);
              await persistence.query(
                `
                  update fx_system_scope_clock
                  set storage_generation_fence = storage_generation_fence + 1
                  where scope_id = $1
                `,
                [scopeId],
              );
              return preliminary;
            },
          }),
        },
      } satisfies PointMutationSessionActivationResolutionPortsV1;
      const loader = createPointMutationSessionAttemptLoadPersistenceV1(ports);

      await expect(loadPointMutationSessionAttempt(
        loader,
        selectorFromAnchor(anchor),
      ))
        .rejects.toMatchObject({
          issue: { reason: "storageGenerationFenceChanged" },
        } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    });
  });

  it("serializes concurrent exact abort and expiry into one terminal transition", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_terminal_race",
        sharedLocator("attempt-terminal-race"),
        ids,
      );
      const anchor = (
        await activatePointMutationSession(
          createActivationPersistence(persistence, ids),
          pointMutationSessionActivationFixture(
            context.deploymentId,
            context.scopeId,
          ),
        )
      ).anchor;
      await persistence.query(
        `update fx_system_snapshot_lease
         set lease_expires_at = '2000-01-01T00:00:00.000Z'
         where session_id = $1`,
        [anchor.sessionId],
      );
      const events: string[] = [];
      const terminalization = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: (event) => {
          events.push(`${event.operation}:${event.phase}:${event.step}`);
        },
      });
      const selector = selectorFromAnchor(anchor);

      const results = await Promise.all([
        abortPointMutationSessionAttempt(terminalization, {
          selector,
          executionClaim: executionClaimForAnchor(anchor),
          expectedSnapshotToken: anchor.snapshotToken,
        }),
        expirePointMutationSessionAttempt(terminalization, selector),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "observed",
        "terminalized",
      ]);
      expect(results.map((result) => result.terminal.lifecycle))
        .toEqual(["expired", "expired"]);
      expect(events.filter((event) => event.endsWith(":clockLocked")))
        .toHaveLength(2);
      expect(events.filter((event) => event.endsWith(":sessionLocked")))
        .toHaveLength(2);
      expect(events.filter((event) => event.endsWith(":leaseLocked")))
        .toHaveLength(1);
      expect(events.filter((event) => event.includes(":write:")))
        .toHaveLength(3);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 0,
        journals: 0,
        executionClaims: 0,
      });
    });
  });

  it("reads database time after the exact lease lock when expiry crosses its edge", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_terminal_expiry",
        sharedLocator("attempt-terminal-expiry"),
        ids,
      );
      const anchor = (
        await activatePointMutationSession(
          createActivationPersistence(persistence, ids),
          pointMutationSessionActivationFixture(
            context.deploymentId,
            context.scopeId,
          ),
        )
      ).anchor;
      await persistence.query(
        `update fx_system_snapshot_lease
         set lease_expires_at = clock_timestamp() + interval '2 seconds'
         where session_id = $1`,
        [anchor.sessionId],
      );
      const events: string[] = [];
      const terminalization = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: async (event) => {
          events.push(`${event.phase}:${event.step}`);
          if (event.phase === "lock" && event.step === "leaseLocked") {
            await delay(2_200);
          }
        },
      });

      await expect(
        expirePointMutationSessionAttempt(
          terminalization,
          selectorFromAnchor(anchor),
        ),
      ).resolves.toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "expired" },
      });
      expect(events).toEqual([
        "lock:clockLocked",
        "lock:sessionLocked",
        "lock:leaseLocked",
        "lock:journalRootLocked",
        "write:journalDeleted",
        "write:leaseDeleted",
        "write:sessionTerminalized",
      ]);
    });
  });

  it("allows an independent scope to terminalize while another attempt is paused", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "attempt_terminal_independent_a",
        sharedLocator("attempt-terminal-independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "attempt_terminal_independent_b",
        sharedLocator("attempt-terminal-independent-b"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const anchorA = (await activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      )).anchor;
      const anchorB = (await activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(
          contextB.deploymentId,
          contextB.scopeId,
        ),
      )).anchor;
      const entered = deferred<void>();
      const release = deferred<void>();
      const terminalizationA = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: async (event) => {
          if (event.phase !== "lock" || event.step !== "sessionLocked") return;
          entered.resolve();
          await release.promise;
        },
      });
      const terminalizationB = createTerminalizationPersistence(persistence);
      const pendingA = abortPointMutationSessionAttempt(terminalizationA, {
        selector: selectorFromAnchor(anchorA),
        executionClaim: executionClaimForAnchor(anchorA),
        expectedSnapshotToken: anchorA.snapshotToken,
      });
      await entered.promise;

      let resultB;
      try {
        resultB = await Promise.race([
          abortPointMutationSessionAttempt(terminalizationB, {
            selector: selectorFromAnchor(anchorB),
            executionClaim: executionClaimForAnchor(anchorB),
            expectedSnapshotToken: anchorB.snapshotToken,
          }),
          delay(5_000).then(() => {
            throw new Error("Independent-scope terminalization timed out.");
          }),
        ]);
      } finally {
        release.resolve();
      }
      const resultA = await pendingA;

      expect(resultA.terminal.lifecycle).toBe("aborted");
      expect(resultB.terminal.lifecycle).toBe("aborted");
    });
  });

  it("rolls back lease deletion and terminal lifecycle after the second write", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_terminal_rollback",
        sharedLocator("attempt-terminal-rollback"),
        ids,
      );
      const anchor = (
        await activatePointMutationSession(
          createActivationPersistence(persistence, ids),
          pointMutationSessionActivationFixture(
            context.deploymentId,
            context.scopeId,
          ),
        )
      ).anchor;
      const before = await attemptRowState(persistence, context.scopeId);
      const terminalization = createTerminalizationPersistence(persistence, {
        afterTerminalizationEvent: (event) => {
          if (
            event.phase === "write" &&
            event.step === "sessionTerminalized"
          ) {
            throw new Error("fail:sessionTerminalized");
          }
        },
      });

      await expect(
        abortPointMutationSessionAttempt(terminalization, {
          selector: selectorFromAnchor(anchor),
          executionClaim: executionClaimForAnchor(anchor),
          expectedSnapshotToken: anchor.snapshotToken,
        }),
      ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: "fail:sessionTerminalized",
          }),
        });
      await expect(attemptRowState(persistence, context.scopeId))
        .resolves.toEqual(before);
    });
  });
});

async function provisionContext(
  persistence: PostgresFlarexPersistence,
  label: string,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  ids: () => string,
): Promise<ActivationContext> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_activation_postgres_${label}`,
  );
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator, randomUuid: ids },
  ).ensure({
    deploymentId,
    projectId: `project_activation_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  return { deploymentId, scopeId, physicalLocator };
}

function createActivationPersistence(
  persistence: PostgresFlarexPersistence,
  ids: () => string,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionActivationPersistenceV1(
    resolutionPorts(persistence, targetOptions),
    {
      leaseDurationMilliseconds: 60_000,
      randomUuid: ids,
    },
  );
}

function createLoadPersistence(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionAttemptLoadPersistenceV1(
    resolutionPorts(persistence, targetOptions),
  );
}

function createTerminalizationPersistence(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionAttemptTerminalizationPersistenceV1(
    resolutionPorts(persistence, targetOptions),
  );
}

function createExecutionClaimAcquisition(
  persistence: PostgresFlarexPersistence,
  owner: string,
) {
  return createPointMutationExecutionClaimAcquisitionV1(
    resolutionPorts(persistence),
    {
      durationMilliseconds: 30_000,
      randomOwner: () => owner,
    },
  );
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

async function attemptRowState(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<Record<string, unknown>> {
  const result = await persistence.query<Record<string, unknown>>(
    `
      select s.lifecycle,
             s.attempt_fence::text as attempt_fence,
             s.updated_at::text as session_updated_at,
             l.attempt_fence::text as lease_attempt_fence,
             l.snapshot_epoch_uuid::text as snapshot_epoch_uuid,
             l.snapshot_commit_seq::text as snapshot_commit_seq,
             l.lease_expires_at::text as lease_expires_at
      from fx_system_tx_session s
      join fx_system_snapshot_lease l
        on l.scope_uuid = s.scope_uuid
       and l.session_id = s.session_id
      join fx_system_scope_clock c
        on c.scope_uuid = s.scope_uuid
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Attempt reload row is missing.");
  return row;
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

async function executionClaimRow(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<Readonly<{ readonly claim_owner: string; readonly claim_fence: string }>> {
  const result = await persistence.query<{
    claim_owner: string;
    claim_fence: string;
  }>(
    `select claim_owner::text, claim_fence::text
     from fx_system_tx_execution_claim
     where session_id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error("Expected one exact execution claim.");
  }
  return Object.freeze({ ...row });
}

async function insertExpiredOutcome(
  persistence: PostgresFlarexPersistence,
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

interface HeldScopeClock {
  readonly client: PoolClient;
  readonly blockerPid: number;
}

async function holdScopeClock(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<HeldScopeClock> {
  const client = await persistence.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `select 1 from fx_system_scope_clock where scope_id = $1 for update`,
      [scopeId],
    );
    const pid = await client.query<{ pid: number }>(
      "select pg_backend_pid()::int as pid",
    );
    const blockerPid = pid.rows[0]?.pid;
    if (blockerPid === undefined) {
      throw new Error("Scope-clock lock returned no backend PID.");
    }
    return Object.freeze({ client, blockerPid });
  } catch (cause) {
    await client.query("rollback").catch(() => undefined);
    client.release();
    throw cause;
  }
}

async function waitForBlockedScopeClock(
  persistence: PostgresFlarexPersistence,
  held: HeldScopeClock,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `select count(*)::int as blocked
       from pg_stat_activity
       where $1::int = any(pg_blocking_pids(pid))
         and datname = current_database()
         and wait_event_type = 'Lock'`,
      [held.blockerPid],
    );
    if ((result.rows[0]?.blocked ?? 0) >= 1) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for a blocked scope-clock lock.");
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
  if (!installed) throw new Error("Failed to install a client query fault.");
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

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
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
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        ),
    },
  };
}

function resolutionPortsWithRunner(
  persistence: PostgresFlarexPersistence,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1,
): PointMutationSessionActivationResolutionPortsV1 {
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

async function rowCounts(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
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
    return `52000000-0000-4000-8000-${suffix}`;
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
