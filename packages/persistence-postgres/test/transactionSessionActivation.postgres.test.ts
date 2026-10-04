import { captureSessionStorage, expectSessionPayloadScrubbed } from "./terminalSessionStorageScenario";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { makeGrantRetentionPolicyV1Result } from "flarex-protocol/grant-retention-policy";
import { CommitSeqSchema, decodeReplacementScopeIdV1, FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema, StorageGenerationFenceSchema,
  projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, ScopeEpochSchema } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import type { PoolClient } from "pg";
import { describe, expect, it, vi, type MockInstance } from "vitest";

import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedRetainedHistoryFloorTarget,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { AppRowTransaction } from "../src/appRows";
import { rowsFromDriverExecuteResult } from "../src/driverExecuteResult";
import { fxControlScopes, fxSystemCommits, fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../src/schema";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  lockScopeClockForOrdinaryWriteInTransactionEffect, lockScopeClockForUpdateInTransactionEffect,
  requireFiniteExecutionAuthorityObservation } from "../src/scopeClock";
import { captureFiniteMetadataReservation, persistFiniteMetadataReservationInTransaction } from "../src/finiteMetadataReservation";
import { createRetainedHistoryFloorPublicationPort, createTestNoReconnectRetainedHistoryFloorPublicationPinFacet,
  publishRetainedHistoryFloorEffect } from "../src/retainedHistoryFloorObservation";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../src/postgresLocatedReadCommitted";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
} from "../src/scopeAuthorityResolution";
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
  recognizeFiniteMetadataReservationUpdate,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionActivationResultV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
} from "../src/transactionSessionActivation";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  isLocatedExactRunningAttemptKernelV1,
  type ExactRunningAttemptKernelInputV1,
} from "../src/transactionSessionAttemptKernel";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
  RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT,
  isLocatedFiniteRunningAttemptReadSyscallKernel,
} from "../src/transactionSessionReadSyscallKernel";
import {
  postgresUrl,
  createFileScopedPostgresFixture,
  createProtectedFileScopedPostgresFixture,
  createCoLocatedReadInstallationFixture,
  rollbackAndReleasePostgresClient,
  useFileScopedPostgresPersistence,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { getCoLocatedReadInstallationReferencesResult } from "../src/installationLifecycle";
import { prepareProtectedMetadata } from "../src/preparedMetadataEpoch";
import { withInstallationMaintenance } from "../src/postgresInstallationMaintenance";
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
  const withPostgresPersistence = useFileScopedPostgresPersistence();

  it("activates exact shops when a deployment has two scopes", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "shared_deployment_exact_scope",
        sharedLocator("shared-deployment-exact-scope"),
        ids,
      );
      const peerScopeId = decodeReplacementScopeIdV1(`scope_${ids()}`);
      await persistence.insertScopeMetadata({
        deploymentId: context.deploymentId,
        scopeId: peerScopeId,
        physicalLocator: context.physicalLocator,
      });
      await persistence.drizzle.transaction(async tx => {
      await tx.insert(fxSystemScopeClocks).values({ scopeId: peerScopeId });
      await tx.insert(fxSystemScopeExecutionAuthorities).values({
        scopeId: peerScopeId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        epoch: ScopeEpochSchema.make(`epoch_${ids()}`),
      });
    });
      await setFlarexActivationClock(persistence, peerScopeId);
      await expect(persistence.getScopeMetadataByDeploymentId(context.deploymentId))
        .rejects.toMatchObject({ name: "ScopeDeploymentAmbiguousError" });

      const activation = createActivationPersistence(persistence, ids);
      for (const scopeId of [context.scopeId, peerScopeId]) {
        const result = await activatePointMutationSession(
          activation,
          pointMutationSessionActivationFixture(context.deploymentId, scopeId),
        );
        expect(result.status).toBe("created");
        expect(result.anchor.scopeId).toBe(scopeId);
      }
    });
  });

  it("shares same-scope read admission while preserving the update-lock writer lane", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "read_admission_concurrency",
        sharedLocator("read-admission-concurrency"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const created = await Promise.all([
        "read-one",
        "read-two",
        "writer",
      ].map((requestKey) => activatePointMutationSession(
        activation,
        pointMutationSessionActivationFixture(
          context.deploymentId,
          context.scopeId,
          {
            evidence: {
              requestKey: TransactionRequestKeyV1Schema.make(requestKey),
            },
          },
        ),
      )));
      if (created.some((result) => result.status !== "created")) {
        throw new Error("Expected three independent running attempts.");
      }
      const [first, second, writerAttempt] = created;
      if (
        first?.status !== "created" ||
        second?.status !== "created" ||
        writerAttempt?.status !== "created"
      ) {
        throw new Error("Expected exact created-attempt evidence.");
      }

      const target = createPostgresLocatedPointMutationSessionActivationTargetV1(
        persistence,
        context.physicalLocator,
      );
      const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
        context.deploymentId,
        {
          scopeMetadata: persistence,
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => {
              throw new Error("Shared read admission must not read receipts.");
            },
          },
          scopeClockTargets: { resolve: async () => target },
        },
      ));
      if (!isLocatedExactRunningAttemptReadSyscallKernelV1(located.target)) {
        throw new Error("Expected the read exact-attempt facet.");
      }
      const exactTarget = located.target;
      if (!isLocatedExactRunningAttemptKernelV1(exactTarget)) {
        throw new Error("Expected the mutation exact-attempt facet.");
      }

      const firstEntered = deferred<number>();
      const secondEntered = deferred<number>();
      const writerEntered = deferred<void>();
      const releaseFirst = deferred<void>();
      const releaseSecond = deferred<void>();
      let writerDidEnter = false;
      const runRead = (
        attempt: typeof first,
        entered: ReturnType<typeof deferred<number>>,
        release: ReturnType<typeof deferred<void>>,
      ) => runEffect(exactTarget[
        RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
      ]({
        selector: selectorFromAnchor(attempt.anchor),
        executionClaim: attempt.executionClaim,
        preliminaryAuthority: located.authority,
      }, (tx) => Effect.promise(async () => {
        entered.resolve(await transactionBackendPid(tx));
        await release.promise;
      })));
      const firstRead = runRead(first, firstEntered, releaseFirst);
      const secondRead = runRead(second, secondEntered, releaseSecond);
      let writer: Promise<void> | undefined;
      try {
        const [firstPid, secondPid] = await Promise.all([
          waitForTransactionEntryOrFailure(
            firstEntered.promise,
            firstRead,
            "first shared reader",
          ),
          waitForTransactionEntryOrFailure(
            secondEntered.promise,
            secondRead,
            "second shared reader",
          ),
        ]);
        writer = runEffect(exactTarget[
          RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
        ]({
          selector: selectorFromAnchor(writerAttempt.anchor),
          executionClaim: writerAttempt.executionClaim,
          preliminaryAuthority: located.authority,
        }, () => Effect.sync(() => {
          writerDidEnter = true;
          writerEntered.resolve(undefined);
        })));
        const blocked = await waitForBlockedSharedScopeClockWriter(
          persistence,
          [firstPid, secondPid],
        );
        expect(
          blocked.blockers.some((pid) =>
            pid === firstPid || pid === secondPid
          ),
        ).toBe(true);
        expect(writerDidEnter).toBe(false);
        releaseFirst.resolve(undefined);
        await firstRead;
        const stillBlocked = await waitForBlockedSharedScopeClockWriter(
          persistence,
          [secondPid],
          blocked.pid,
        );
        expect(stillBlocked.blockers).not.toContain(firstPid);
        expect(writerDidEnter).toBe(false);
        releaseSecond.resolve(undefined);
        await Promise.all([secondRead, writer, writerEntered.promise]);
      } finally {
        releaseFirst.resolve(undefined);
        releaseSecond.resolve(undefined);
        await Promise.allSettled([
          firstRead,
          secondRead,
          ...(writer === undefined ? [] : [writer]),
        ]);
      }
    });
  }, 120_000);

  it("serializes exact same-request activation into one created and one busy anchor", async () => {
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
        await rollbackAndReleasePostgresClient(held.client);
      }
      await expect(pendingA).resolves.toMatchObject({
        kind: "acquired",
        mode: "execute",
        observation: { claimFence: 2n },
      });
    });
  }, 120_000);

  it("gives changed-evidence competition one winner under the scope lock", async () => {
    await withPostgresPersistence(async (persistence) => {
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

  it("omits callback facet evidence while reload and acquisition still reject hidden children", async () => {
    await withPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence, "checked_hidden_child", sharedLocator("checked-hidden-child"), ids,
      );
      const activated = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(context.deploymentId, context.scopeId),
      );
      if (activated.status !== "created") {
        throw new Error("Expected a newly created hidden-child attempt.");
      }
      await persistence.query(`
        insert into fx_system_tx_journal_receipt (
          scope_uuid, session_id, attempt_fence, last_syscall_sequence,
          operation_kind, request_codec_version, request_bytes, request_sha256,
          outcome_kind, outcome_codec_version, outcome_bytes, outcome_sha256,
          created_at, updated_at
        )
        select scope_uuid, session_id, attempt_fence, 1,
          'get', 2, decode('00', 'hex'), decode(repeat('00', 32), 'hex'),
          'missing', 2, decode('00', 'hex'), decode(repeat('00', 32), 'hex'),
          created_at, updated_at
        from fx_system_tx_session where session_id = $1
      `, [activated.anchor.sessionId]);
      const target = createPostgresLocatedPointMutationSessionActivationTargetV1(
        persistence, context.physicalLocator,
      );
      const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
        context.deploymentId,
        {
          scopeMetadata: persistence,
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => {
              throw new Error("Shared checked admission must not read receipts.");
            },
          },
          scopeClockTargets: { resolve: async () => target },
        },
      ));
      if (!isLocatedExactRunningAttemptReadSyscallKernelV1(located.target)) {
        throw new Error("Expected the private read-syscall admission facet.");
      }
      await runEffect(located.target[
        RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
      ]({
        selector: selectorFromAnchor(activated.anchor),
        executionClaim: activated.executionClaim,
        preliminaryAuthority: located.authority,
      }, (_tx, checked) => {
        expect(checked).not.toHaveProperty("attemptFacet");
        return Effect.succeed(undefined);
      }));
      const loaded = await loadPointMutationSessionAttempt(
        createPointMutationSessionAttemptLoadPersistenceV1(resolutionPorts(persistence)),
        selectorFromAnchor(activated.anchor),
      );
      expect(loaded.attemptFacet).toEqual({ kind: "nonPristine" });
      await expireExecutionClaim(persistence, activated.anchor.sessionId);
      await expect(runEffect(createExecutionClaimAcquisition(
        persistence, ids(),
      ).acquireEffect(selectorFromAnchor(activated.anchor)))).resolves.toMatchObject({
        kind: "acquired", mode: "abortOnly", reason: "dirtyOpen",
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
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
        "attemptTailLocked",
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "attemptTailLocked",
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

  it("locks the root before a held claim and reads time after the claim wait", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(persistence, "attempt_tail_wait",
        sharedLocator("attempt-tail-wait"), ids);
      const activated = await activatePointMutationSession(
        createActivationPersistence(persistence, ids),
        pointMutationSessionActivationFixture(context.deploymentId, context.scopeId));
      await persistence.query(`update fx_system_snapshot_lease
        set lease_expires_at = clock_timestamp() + interval '2 seconds'
        where session_id = $1`, [activated.anchor.sessionId]);
      const before = await attemptRowState(persistence, context.scopeId);
      const claimBefore = await executionClaimRow(persistence, activated.anchor.sessionId);
      const held = await persistence.pool.connect();
      let pending: Promise<unknown> | undefined;
      let outcome: Promise<void> | undefined;
      try {
        await held.query("begin");
        await held.query(`select 1 from fx_system_tx_execution_claim
          where session_id = $1 for update`, [activated.anchor.sessionId]);
        const pid = (await held.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("Missing held-claim backend PID");
        pending = loadPointMutationSessionAttempt(createLoadPersistence(persistence),
          selectorFromAnchor(activated.anchor));
        // Attach the rejection assertion before releasing the independent lock.
        outcome = expect(pending).rejects.toMatchObject({ issue: { reason: "activeAttemptExpired" } });
        await waitForBlockedAttemptTail(persistence, pid);
        // KEY SHARE conflicts with FOR UPDATE, but not FOR NO KEY UPDATE.
        await expect(persistence.query(`select 1 from fx_system_tx_journal
          where session_id = $1 for key share nowait`, [activated.anchor.sessionId]))
          .rejects.toMatchObject({ code: "55P03" });
        const deadline = Date.now() + 5_000;
        while (true) {
          const time = await persistence.query<{ expired: boolean }>(`select lease_expires_at <= clock_timestamp() as expired
            from fx_system_snapshot_lease where session_id = $1`, [activated.anchor.sessionId]);
          if (time.rows[0]?.expired === true) break;
          if (Date.now() >= deadline) throw new Error("Lease deadline did not cross while claim was held");
          await delay(25);
        }
        await held.query("rollback");
        await outcome;
        await expect(attemptRowState(persistence, context.scopeId)).resolves.toEqual(before);
        await expect(executionClaimRow(persistence, activated.anchor.sessionId)).resolves.toEqual(claimBefore);
      } finally {
        await rollbackAndReleasePostgresClient(held);
        await pending?.catch(() => undefined);
        await outcome?.catch(() => undefined);
      }
    });
  }, 120_000);

  it("uses database time only after the exact lease lock", async () => {
    await withPostgresPersistence(async (persistence) => {
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
    await withPostgresPersistence(async (persistence) => {
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
                  update fx_system_scope_execution_authority
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
    await withPostgresPersistence(async (persistence) => {
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
      const payloadBefore = await captureSessionStorage(persistence, anchor);
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

      expectSessionPayloadScrubbed(payloadBefore, await captureSessionStorage(persistence, anchor));
      expect(results[0]?.terminal).toEqual(results[1]?.terminal);
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
    await withPostgresPersistence(async (persistence) => {
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

  it("terminalizes an expired attempt whose snapshot is below the retained floor", async () => {
    await withPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "attempt_terminal_expired_below_floor",
        sharedLocator("attempt-terminal-expired-below-floor"),
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

      await expect(expirePointMutationSessionAttempt(
        createTerminalizationPersistence(persistence),
        selectorFromAnchor(anchor),
      )).resolves.toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "expired" },
      });
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 0,
        journals: 0,
        executionClaims: 0,
      });
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
    await withPostgresPersistence(async (persistence) => {
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
      const payloadBefore = await captureSessionStorage(persistence, anchor);
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
      expect(await captureSessionStorage(persistence, anchor)).toEqual(payloadBefore);
    });
  });
});

describePostgres("finite running authority barrier", () => {
  it("refuses a future terminal revocation counter without releasing its expired reservation", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await finiteBarrierFixture(persistence, "future_terminal_revocation", false);
      const anchor = fixture.activated.anchor;
      await persistence.query(`update fx_system_tx_session set authorization_revocation_epoch = 1
        where session_id = $1`, [anchor.sessionId]);
      await persistence.query(`update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00Z' where session_id = $1`, [anchor.sessionId]);
      const before = await attemptRowState(persistence, fixture.context.scopeId);
      const payloadBefore = await captureSessionStorage(persistence, anchor);
      await expect(expirePointMutationSessionAttempt(createTerminalizationPersistence(persistence), selectorFromAnchor(anchor)))
        .rejects.toMatchObject({ issue: { reason: "authorizationRevocationEpochChanged" } });
      expect(await attemptRowState(persistence, fixture.context.scopeId)).toEqual(before);
      expect(await captureSessionStorage(persistence, anchor)).toEqual(payloadBefore);
      expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({
        sessions: 1, leases: 1, journals: 1, executionClaims: 1,
      });
    });
  }, 120_000);

  for (const refusal of ["snapshot mismatch", "finishing lifecycle"] as const) {
    it(`refuses terminal abort ${refusal} before a held execution claim`, async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `terminal_early_${refusal}`, false);
        const anchor = fixture.activated.anchor;
        if (refusal === "finishing lifecycle") await persistence.query(`update fx_system_tx_session
          set lifecycle = 'finishing' where session_id = $1`, [anchor.sessionId]);
        const before = await attemptRowState(persistence, fixture.context.scopeId);
        const payloadBefore = await captureSessionStorage(persistence, anchor);
        const claimBefore = await executionClaimRow(persistence, anchor.sessionId);
        const events: string[] = [];
        const terminalization = createTerminalizationPersistence(persistence, {
          afterTerminalizationEvent: event => { events.push(`${event.phase}:${event.step}`); },
        });
        const holder = await persistence.pool.connect();
        let pending: Promise<unknown> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await holder.query("begin");
          const claim = await holder.query(`select session_id from fx_system_tx_execution_claim
            where session_id = $1 for update`, [anchor.sessionId]);
          expect(claim.rows).toHaveLength(1);
          pending = abortPointMutationSessionAttempt(terminalization, {
            selector: selectorFromAnchor(anchor), executionClaim: executionClaimForAnchor(anchor),
            expectedSnapshotToken: refusal === "snapshot mismatch"
              ? { ...anchor.snapshotToken, commitSeq: CommitSeqSchema.make(anchor.snapshotToken.commitSeq + 1n) }
              : anchor.snapshotToken,
          }).then(() => { throw new Error("Unexpected successful invalid terminal abort"); }, failure => failure);
          const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Earlier terminal refusal waited for the later claim gate")), 2_000);
          });
          expect(await Promise.race([pending, deadline])).toMatchObject(refusal === "snapshot mismatch"
            ? { _tag: "PointMutationSessionAuthorityCorruptionV1Error", issue: "attemptSnapshotChanged" }
            : { _tag: "PointMutationSessionAttemptTerminalizationV1Error",
              issue: { reason: "attemptNotTerminalizable", lifecycle: "finishing" } });
          expect(events).toEqual(["lock:clockLocked", "lock:sessionLocked", "lock:leaseLocked", "lock:journalRootLocked"]);
          expect(await attemptRowState(persistence, fixture.context.scopeId)).toEqual(before);
          expect(await captureSessionStorage(persistence, anchor)).toEqual(payloadBefore);
          expect(await executionClaimRow(persistence, anchor.sessionId)).toEqual(claimBefore);
          expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({
            sessions: 1, leases: 1, journals: 1, executionClaims: 1,
          });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          await rollbackAndReleasePostgresClient(holder);
          await pending?.catch(() => undefined);
        }
      });
    }, 120_000);
  }

  it("observes an idempotent terminal abort without acquiring the claim relation", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await finiteBarrierFixture(persistence, "terminal_idempotent_claim_gate", false);
      const anchor = fixture.activated.anchor;
      const terminalization = createTerminalizationPersistence(persistence);
      const input = { selector: selectorFromAnchor(anchor), executionClaim: executionClaimForAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken };
      const terminalized = await abortPointMutationSessionAttempt(terminalization, input);
      expect(terminalized).toMatchObject({ status: "terminalized", terminal: { lifecycle: "aborted" } });
      const before = await captureSessionStorage(persistence, anchor);
      const holder = await persistence.pool.connect();
      let pending: Promise<unknown> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await holder.query("begin");
        // A table gate also proves that no query of the now-empty claim
        // directory is needed to observe the authentic terminal disposition.
        await holder.query("lock table fx_system_tx_execution_claim in access exclusive mode");
        pending = abortPointMutationSessionAttempt(terminalization, input);
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Idempotent terminal observation acquired the claim relation")), 2_000);
        });
        expect(await Promise.race([pending, deadline])).toEqual({ ...terminalized, status: "observed" });
        expect(await captureSessionStorage(persistence, anchor)).toEqual(before);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await rollbackAndReleasePostgresClient(holder);
        await pending?.catch(() => undefined);
      }
      expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({
        sessions: 1, leases: 0, journals: 0, executionClaims: 0,
      });
    });
  }, 120_000);

  it("samples terminal abort time after the exact claim lock wait", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await finiteBarrierFixture(persistence, "terminal_claim_wait", false);
      const anchor = fixture.activated.anchor;
      const before = await attemptRowState(persistence, fixture.context.scopeId);
      const payloadBefore = await captureSessionStorage(persistence, anchor);
      const claimBefore = await executionClaimRow(persistence, anchor.sessionId);
      const held = await persistence.pool.connect();
      let pending: Promise<unknown> | undefined;
      let outcome: Promise<void> | undefined;
      try {
        await held.query("begin");
        await held.query("select 1 from fx_system_tx_execution_claim where session_id = $1 for update", [anchor.sessionId]);
        const pid = (await held.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("Missing terminal claim blocker PID");
        pending = abortPointMutationSessionAttempt(createTerminalizationPersistence(persistence), {
          selector: selectorFromAnchor(anchor), executionClaim: executionClaimForAnchor(anchor),
          expectedSnapshotToken: anchor.snapshotToken,
        });
        outcome = expect(pending).rejects.toMatchObject({ issue: { reason: "executionClaimUnavailable" } });
        await waitForAuthorityWaiter(persistence, pid, false);
        // Publish an expired claim only after the waiter reaches the row gate.
        // The old pre-wait time would still consider this same pin live.
        await held.query(`update fx_system_tx_execution_claim
          set claim_expires_at = clock_timestamp() + interval '2 seconds' where session_id = $1`, [anchor.sessionId]);
        const deadline = Date.now() + 5_000;
        while (true) {
          const clock = await held.query<{ expired: boolean }>(`select claim_expires_at <= clock_timestamp() as expired
            from fx_system_tx_execution_claim where session_id = $1`, [anchor.sessionId]);
          if (clock.rows[0]?.expired === true) break;
          if (Date.now() >= deadline) throw new Error("Claim did not expire while terminal cleanup waited");
          await delay(25);
        }
        await held.query("commit");
        await outcome;
        expect(await attemptRowState(persistence, fixture.context.scopeId)).toEqual(before);
        expect(await captureSessionStorage(persistence, anchor)).toEqual(payloadBefore);
        expect(await executionClaimRow(persistence, anchor.sessionId)).toEqual(claimBefore);
        expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({
          sessions: 1, leases: 1, journals: 1, executionClaims: 1,
        });
      } finally {
        await rollbackAndReleasePostgresClient(held);
        await pending?.catch(() => undefined);
        await outcome?.catch(() => undefined);
      }
    });
  }, 120_000);

  for (const operation of ["abort", "expire"] as const) {
    it(`releases a revoked finite reservation through exact ${operation} cleanup`, async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `revoked_${operation}`, false);
        const anchor = fixture.activated.anchor;
        const payloadBefore = await captureSessionStorage(persistence, anchor);
        const reserved = await persistence.query<{ reserved: boolean }>(`
          select metadata_watermark is not null
            and finite_metadata_reservation_bytes is not null
            and finite_metadata_reservation_sha256 is not null as reserved
          from fx_system_snapshot_lease where session_id = $1`, [anchor.sessionId]);
        expect(reserved.rows).toEqual([{ reserved: true }]);
        await persistence.drizzle.transaction(tx => runEffect(
          advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, fixture.context.scopeId)));
        await expectFiniteRefusalBeforeData(persistence, fixture, fixture.input, "authorizationRevocationEpochChanged");
        if (operation === "expire") await persistence.query(`update fx_system_snapshot_lease
          set lease_expires_at = '2000-01-01T00:00:00Z' where session_id = $1`, [anchor.sessionId]);
        const terminalization = createTerminalizationPersistence(persistence);
        const result = operation === "abort"
          ? await abortPointMutationSessionAttempt(terminalization, {
              selector: selectorFromAnchor(anchor), executionClaim: executionClaimForAnchor(anchor),
              expectedSnapshotToken: anchor.snapshotToken,
            })
          : await expirePointMutationSessionAttempt(terminalization, selectorFromAnchor(anchor));
        expect(result).toMatchObject({ status: "terminalized",
          terminal: { lifecycle: operation === "abort" ? "aborted" : "expired" } });
        expectSessionPayloadScrubbed(payloadBefore, await captureSessionStorage(persistence, anchor));
        expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({
          sessions: 1, leases: 0, journals: 0, executionClaims: 0,
        });
        const authority = await persistence.query<{ revocation: string; commit_seq: string }>(`
          select a.authorization_revocation_epoch::text as revocation, c.last_commit_seq::text as commit_seq
          from fx_system_scope_execution_authority a join fx_system_scope_clock c using(scope_id)
          where a.scope_id = $1`, [fixture.context.scopeId]);
        expect(authority.rows).toEqual([{ revocation: "1", commit_seq: "0" }]);
      });
    }, 120_000);
  }

  for (const [dimension, reason] of [
    ["generation", "unsupportedStorageGeneration"],
    ["fence", "storageGenerationFenceChanged"],
    ["epoch", "scopeEpochChanged"],
  ] as const) {
    it(`refuses changed ${dimension} before data and before later claim refusal`, async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `refuse_${dimension}`, false);
        const currentInput = await takeOverFiniteFixtureClaim(persistence, fixture);
        const nextFence = StorageGenerationFenceSchema.make(currentInput.preliminaryAuthority.storageGenerationFence + 1n);
        const nextEpoch = ScopeEpochSchema.make("epoch_64000000-0000-4000-8000-000000000902");
        await persistence.drizzle.update(fxSystemScopeExecutionAuthorities).set(
          dimension === "generation" ? { storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1") }
            : dimension === "fence" ? { storageGenerationFence: nextFence } : { epoch: nextEpoch },
        ).where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.context.scopeId));
        await expectFiniteRefusalBeforeData(persistence, fixture, currentInput, reason);
        // Add only later refusals: generation precedes fence/epoch; fence
        // precedes epoch; every authority refusal precedes the stale claim.
        if (dimension !== "epoch") await persistence.drizzle.update(fxSystemScopeExecutionAuthorities).set({
          ...(dimension === "generation" ? { storageGenerationFence: nextFence } : {}), epoch: nextEpoch,
        }).where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.context.scopeId));
        await expectFiniteRefusalBeforeData(persistence, fixture,
          { ...currentInput, executionClaim: fixture.input.executionClaim }, reason);
      });
    }, 120_000);
  }

  for (const dimension of ["owner", "fence"] as const) {
    it(`refuses an independently stale claim ${dimension} before data`, async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `refuse_claim_${dimension}`, false);
        const currentInput = await takeOverFiniteFixtureClaim(persistence, fixture);
        // Each stale component was issued by the real prior claim owner. Keep
        // all other components from the actual successful takeover observation.
        const executionClaim = { ...currentInput.executionClaim,
          ...(dimension === "owner" ? { claimOwner: fixture.input.executionClaim.claimOwner }
            : { claimFence: fixture.input.executionClaim.claimFence }),
        };
        await expectFiniteRefusalBeforeData(persistence, fixture,
          { ...currentInput, executionClaim }, "executionClaimUnavailable");
      });
    }, 120_000);
  }

  for (const profile of ["direct", "installed"] as const) {
  it.skipIf(profile === "installed" && !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    `allows sequencer publication while retaining authority through lease expiry and floor publication${profile === "installed" ? " (qualified installed)" : ""}`, async () => {
    await withFiniteKernelFixture("floor", profile, true, async (persistence, fixture) => {
      const entered = deferred<number>();
      const release = deferred<void>();
      const reading = runEffect(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
        fixture.input, (tx, context) => Effect.tryPromise({
          try: async () => {
            expect(Result.getOrThrow(requireFiniteExecutionAuthorityObservation(tx, context.authority)))
              .toBe(context.authority);
            expect(context.executionAuthorityGeneration).toBe("legacy_dynamic_worker_v1");
            expect(Object.keys(context.journalRoot)).toEqual([
              "scopeUuid", "sessionId", "attemptFence", "journalFormat",
              "executionProfile", "state", "lastSyscallSequence",
            ]);
            entered.resolve(await transactionBackendPid(tx));
            await release.promise;
            return context.anchor.snapshotToken.commitSeq;
          }, catch: cause => new Error("Finite barrier callback failed", { cause }),
        })));
      void reading.catch(() => undefined);
      let publication: Promise<unknown> | undefined;
      try {
        const readerPid = await waitForTransactionEntryOrFailure(entered.promise, reading, "finite floor barrier");
        // The actual ordinary writer takes authority SHARE and the sequencer's
        // exclusive publication lock; the original snapshot remains zero.
        await persistence.drizzle.transaction(async tx => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.context.scopeId));
          await tx.insert(fxSystemCommits).values({ scopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(fixture.context.scopeId)).scopeUuid,
            epochUuid: Result.getOrThrow(projectScopeEpochUuidV1Result(fixture.activated.anchor.snapshotToken.epoch)).epochUuid,
            commitSeq: CommitSeqSchema.make(1n), changeCount: 0,
            committedAt: sql`clock_timestamp() - interval '30 seconds'` });
          expect(clock.lastCommitSeq).toBe(0n);
          await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
            .where(eq(fxSystemScopeClocks.scopeId, fixture.context.scopeId));
        });
        const port = createRetainedHistoryFloorPublicationPort({ authority: {
          scopeMetadata: persistence, provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => { throw new Error("Shared scope has no split receipt"); },
          }, scopeClockTargets: { resolve: async locator => createPostgresLocatedRetainedHistoryFloorTarget(persistence, locator) },
        }, grantRetentionPolicy: Result.getOrThrow(makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 1_000, maximumFutureIssuedAtSkewMilliseconds: 0,
          maximumLiveSnapshotRetentionMilliseconds: 10_000,
        })), pinFacets: [createTestNoReconnectRetainedHistoryFloorPublicationPinFacet()] });
        publication = runEffect(publishRetainedHistoryFloorEffect(port, fixture.context.deploymentId));
        void publication.catch(() => undefined);
        await waitForAuthorityWaiter(persistence, readerPid);
        await waitForFiniteLeaseExpiry(persistence, fixture.activated.anchor.sessionId);
        expect((await persistence.query(`select oldest_available_commit_seq::text as floor
          from fx_system_scope_execution_authority where scope_id = $1`, [fixture.context.scopeId])).rows)
          .toEqual([{ floor: "0" }]);
        // Expiring the lease does not remove the authority lock held by SQL.
        await waitForAuthorityWaiter(persistence, readerPid);
        release.resolve(undefined);
        expect(await reading).toBe(0n);
        expect(await publication).toMatchObject({ disposition: "advanced", currentFloor: 1n });
        let enteredAgain = false;
        const failure = await runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
          fixture.input, () => { enteredAgain = true; return Effect.void; }));
        expect(failure).toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error",
          cause: { issue: "snapshotLeaseInvalid" } });
        expect(enteredAgain).toBe(false);
      } finally {
        release.resolve(undefined);
        await reading.catch(() => undefined);
        await publication?.catch(() => undefined);
      }
    });
  }, 120_000);
  }

  for (const profile of ["direct", "installed"] as const) {
  it.skipIf(profile === "installed" && !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    `holds revocation behind the finite reader and refuses the next frontier${profile === "installed" ? " (qualified installed)" : ""}`, async () => {
    await withFiniteKernelFixture("revocation", profile, false, async (persistence, fixture) => {
      const entered = deferred<number>();
      const release = deferred<void>();
      const reading = runEffect(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
        fixture.input, tx => Effect.tryPromise({ try: async () => {
          entered.resolve(await transactionBackendPid(tx)); await release.promise;
        }, catch: cause => new Error("Finite reader failed", { cause }) })));
      void reading.catch(() => undefined);
      let revocation: Promise<unknown> | undefined;
      try {
        const readerPid = await waitForTransactionEntryOrFailure(entered.promise, reading, "finite revocation barrier");
        revocation = persistence.drizzle.transaction(tx => runEffect(
          advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, fixture.context.scopeId)));
        void revocation.catch(() => undefined);
        await waitForAuthorityWaiter(persistence, readerPid);
        release.resolve(undefined); await reading; await revocation;
        let enteredAgain = false;
        expect(await runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
          fixture.input, () => { enteredAgain = true; return Effect.void; })))
          .toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error",
            cause: { issue: { reason: "authorizationRevocationEpochChanged" } } });
        expect(enteredAgain).toBe(false);
      } finally { release.resolve(undefined); await reading.catch(() => undefined); await revocation?.catch(() => undefined); }
    });
  }, 120_000);
  }

  for (const profile of ["direct", "installed"] as const) {
  it.skipIf(profile === "installed" && !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    `samples expiry after waiting for the live claim lock${profile === "installed" ? " (qualified installed)" : ""}`, async () => {
    await withFiniteKernelFixture("expiry", profile, true, async (persistence, fixture) => {
      const held = await persistence.pool.connect();
      let pending: Promise<unknown> | undefined;
      let entered = false;
      try {
        await held.query("begin");
        await held.query("select 1 from fx_system_tx_execution_claim where session_id = $1 for update",
          [fixture.activated.anchor.sessionId]);
        const pid = (await held.query<{ pid: number }>("select pg_backend_pid()::int as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("Missing blocker PID");
        pending = runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
          fixture.input, () => { entered = true; return Effect.void; }));
        await waitForAuthorityWaiter(persistence, pid, false);
        await waitForFiniteLeaseExpiry(persistence, fixture.activated.anchor.sessionId);
        await held.query("rollback");
        expect(await pending).toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error",
          cause: { issue: { reason: "activeAttemptExpired" } } });
        expect(entered).toBe(false);
      } finally { await rollbackAndReleasePostgresClient(held); await pending?.catch(() => undefined); }
    });
  }, 120_000);
  }

  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "validates qualified finite admission before compact locks and preserves isolation, Cause and maintenance drain", async () => {
    await withInstalledFiniteKernelFixture("composition", false, async (persistence, fixture, owner, controlOwner) => {
      const spies: MockInstance<PoolClient["query"]>[] = [];
      const observe = (client: PoolClient) => { spies.push(vi.spyOn(client, "query")); };
      persistence.pool.on("acquire", observe);
      try {
        const snapshot = await runEffect(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
          fixture.input, (tx, context) => Effect.sync(() => {
            expect(Result.getOrThrow(requireFiniteExecutionAuthorityObservation(tx, context.authority))).toBe(context.authority);
            expect(context.executionAuthorityGeneration).toBe("legacy_dynamic_worker_v1");
            expect(context.snapshotLease.finiteMetadataReservationBytes).toBeInstanceOf(Uint8Array);
            return context.anchor.snapshotToken;
          })));
        expect(snapshot).toEqual(fixture.activated.anchor.snapshotToken);
        const statements = spies.flatMap(spy => spy.mock.calls.map(call => {
          const query: unknown = call[0];
          return typeof query === "string" ? query : typeof query === "object" && query !== null &&
            "text" in query && typeof query.text === "string" ? query.text : "";
        }));
        const accepting = statements.filter(statement => statement.includes("fx_lock_finite_running_attempt"));
        const admissions = statements.filter(statement => statement.includes("fx_lock_finite_scope_observation"));
        expect(accepting).toHaveLength(1);
        expect(admissions).toHaveLength(1);
        const admission = admissions[0], compact = accepting[0];
        if (admission === undefined || compact === undefined) throw new Error("Missing actual finite admission statements");
        expect(admission).toContain("fx_lock_read_scope_placement");
        expect(admission).toContain("first_gate as materialized");
        expect(admission).not.toContain("fx_lock_finite_running_attempt");
        expect(compact).not.toContain("fx_lock_read_scope_placement");
        expect(statements.indexOf(admission)).toBeLessThan(statements.indexOf(compact));
        expect(statements.filter(statement => statement.includes("fx_lock_read_scope_placement"))).toHaveLength(1);
        expect(compact).not.toContain("sealed_journal_bytes");
        expect(compact).not.toContain("sealed_result_bytes");
        expect(admission).not.toContain("as scope_authority");
        expect(admission).not.toContain("as fx_system_scope_clock");
      } finally {
        persistence.pool.off("acquire", observe);
        for (const spy of spies) spy.mockRestore();
      }

      const peer = await provisionContext(owner.persistence, "installed_peer", fixture.context.physicalLocator, randomUUID);
      const peerDeployment = await owner.persistence.getDeploymentMetadata(peer.deploymentId);
      if (peerDeployment === null) throw new Error("Missing actual peer deployment");
      await controlOwner.persistence.insertDeploymentMetadata(peerDeployment);
      await controlOwner.persistence.insertScopeMetadata({ deploymentId: peer.deploymentId, scopeId: peer.scopeId,
        physicalLocator: peer.physicalLocator });
      let callbacks = 0;
      const peerFailure = await runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
        { ...fixture.input, selector: { ...fixture.input.selector, deploymentId: peer.deploymentId, scopeId: peer.scopeId } },
        () => { callbacks++; return Effect.void; }));
      expect(peerFailure).toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error",
        cause: { issue: { reason: "selectorScopeMismatch" } } });
      expect(callbacks).toBe(0);
      await expectFiniteRefusalBeforeData(persistence, fixture, { ...fixture.input,
        preliminaryAuthority: { ...fixture.input.preliminaryAuthority, storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1") } },
        "unsupportedStorageGeneration");

      const defect = new Error("Installed finite callback defect");
      const outcome = await Effect.runPromiseExit(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
        fixture.input, () => Effect.die(defect)));
      if (!Exit.isFailure(outcome)) throw new Error("Unexpected successful finite callback defect");
      expect(outcome.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);

      const entered = deferred<number>(), release = deferred<void>();
      let maintenanceWasEntered = false;
      const reading = runEffect(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](fixture.input,
        tx => Effect.tryPromise({ try: async () => { entered.resolve(await transactionBackendPid(tx)); await release.promise; },
          catch: cause => new Error("Installed finite held callback failed", { cause }) })));
      void reading.catch(() => undefined);
      let maintaining: Promise<unknown> | undefined;
      try {
        const readerPid = await waitForTransactionEntryOrFailure(entered.promise, reading, "installed finite drain");
        maintaining = runEffect(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName,
          () => Effect.sync(() => { maintenanceWasEntered = true; })));
        void maintaining.catch(() => undefined);
        await waitForAuthorityWaiter(owner.persistence, readerPid, false);
        release.resolve(undefined);
        await reading;
        await maintaining;
        expect(maintenanceWasEntered).toBe(true);
        expect((await owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
        const failure = await runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
          fixture.input, () => { callbacks++; return Effect.void; }));
        expect(failure).toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error",
          cause: { _tag: "InstalledScopeAuthorityError", reason: "resourceFailure", cause: { cause: { code: "55000" } } } });
        expect(callbacks).toBe(0);
      } finally { release.resolve(undefined); await reading.catch(() => undefined); await maintaining?.catch(() => undefined); }
    });
  }, 180_000);

  for (const fault of ["clockTimestamp", "metadataSequence"] as const) {
    it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
      `preserves installed ${fault} corruption before claim waits and stale generation refusal`, async () => {
      await withInstalledFiniteKernelFixture(`corrupt_${fault}`, false, async (persistence, fixture, owner) => {
        if (fault === "clockTimestamp") {
          await owner.persistence.query(`update fx_system_scope_clock set updated_at = 'infinity' where scope_id = $1`, [fixture.context.scopeId]);
        } else {
          // Privileged stored-corruption fault: retain the exact decoder proof
          // even when a constraint has been deliberately removed after startup.
          await owner.persistence.query(`alter table fx_system_scope_clock
            drop constraint fx_system_scope_clock_last_metadata_sequence_non_negative_check`);
          await owner.persistence.query(`update fx_system_scope_clock set last_metadata_sequence = -1 where scope_id = $1`, [fixture.context.scopeId]);
        }
        await expectInstalledRefusalBeforeClaimRelease(fixture, owner.persistence, {
          _tag: "ExactRunningAttemptTransactionV1Error", cause: {
            _tag: "ScopeClockCorruptionError", scopeId: fixture.context.scopeId,
            reason: fault === "clockTimestamp" ? "updated timestamp is invalid" : "metadata sequence is invalid",
          },
        });
        let callbacks = 0;
        const failure = await runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT]({ ...fixture.input,
          preliminaryAuthority: { ...fixture.input.preliminaryAuthority, storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1") } },
          () => { callbacks++; return Effect.void; }));
        expect(failure).toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error", cause: {
          _tag: "ScopeClockCorruptionError", scopeId: fixture.context.scopeId,
          reason: fault === "clockTimestamp" ? "updated timestamp is invalid" : "metadata sequence is invalid",
        } });
        expect(callbacks).toBe(0);
        expect((await persistence.query(`select count(*)::int as leases from fx_system_snapshot_lease
          where session_id = $1`, [fixture.activated.anchor.sessionId])).rows).toEqual([{ leases: 1 }]);
      });
    }, 180_000);
  }

  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "refuses installed locator drift before compact execution-claim waits", async () => {
    await withInstalledFiniteKernelFixture("locator_wait", false, async (_persistence, fixture, owner, controlOwner) => {
      await controlOwner.persistence.drizzle.update(fxControlScopes).set({ physicalLocator: {
        ...fixture.context.physicalLocator, databaseKey: `${fixture.context.physicalLocator.databaseKey}_drift`,
      } }).where(eq(fxControlScopes.scopeId, fixture.context.scopeId));
      await expectInstalledRefusalBeforeClaimRelease(fixture, owner.persistence, {
        _tag: "ExactRunningAttemptTransactionV1Error", cause: {
          _tag: "TrustedScopeAuthorityResolutionError", failure: { reason: "scopeClockTargetPlacementMismatch" },
        },
      });
    });
  }, 180_000);

  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
    "observes the actual sequencer after a retained-floor authority wait in installed finite admission", async () => {
    await withInstalledFiniteKernelFixture("floor_wait", true, async (persistence, fixture, owner) => {
      const entered = deferred<number>(), release = deferred<void>();
      // Controlled valid transition fixture under the real UPDATE clock owner.
      // The separate publication test exercises retention-policy calculation.
      const writing = owner.persistence.drizzle.transaction(async tx => {
        const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, fixture.context.scopeId));
        expect(clock.lastCommitSeq).toBe(0n);
        entered.resolve(await transactionBackendPid(tx));
        await release.promise;
        await tx.insert(fxSystemCommits).values({ scopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(fixture.context.scopeId)).scopeUuid,
          epochUuid: Result.getOrThrow(projectScopeEpochUuidV1Result(fixture.activated.anchor.snapshotToken.epoch)).epochUuid,
          commitSeq: CommitSeqSchema.make(1n), changeCount: 0, committedAt: sql`clock_timestamp() - interval '30 seconds'` });
        await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
          .where(eq(fxSystemScopeClocks.scopeId, fixture.context.scopeId));
        await tx.update(fxSystemScopeExecutionAuthorities).set({ oldestAvailableCommitSeq: CommitSeqSchema.make(1n) })
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.context.scopeId));
      });
      void writing.catch(() => undefined);
      let reading: Promise<unknown> | undefined;
      let callbacks = 0;
      try {
        const writerPid = await waitForTransactionEntryOrFailure(entered.promise, writing, "installed authority transition");
        reading = runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](fixture.input,
          () => { callbacks++; return Effect.void; }));
        // Observe as the actual reader login: the ordinary owner cannot see
        // another restricted role's pg_stat_activity wait-event fields.
        await waitForAuthorityWaiter(persistence, writerPid, false);
        await waitForFiniteLeaseExpiry(owner.persistence, fixture.activated.anchor.sessionId);
        release.resolve(undefined);
        await writing;
        expect(await reading).toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error", cause: { issue: "snapshotLeaseInvalid" } });
        expect(callbacks).toBe(0);
        expect((await persistence.query(`select c.last_commit_seq::text as sequence, a.oldest_available_commit_seq::text as floor
          from fx_system_scope_clock c join fx_system_scope_execution_authority a using(scope_id)
          where c.scope_id = $1`, [fixture.context.scopeId])).rows).toEqual([{ sequence: "1", floor: "1" }]);
      } finally { release.resolve(undefined); await writing.catch(() => undefined); await reading?.catch(() => undefined); }
    });
  }, 180_000);
});

async function withFiniteKernelFixture(label: string, profile: "direct" | "installed", expireSoon: boolean,
  work: (persistence: PostgresFlarexPersistence, fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>) => Promise<void>) {
  if (profile === "direct") return withTemporaryPostgresPersistence(async persistence =>
    work(persistence, await finiteBarrierFixture(persistence, label, expireSoon)));
  return withInstalledFiniteKernelFixture(label, expireSoon, work);
}

async function withInstalledFiniteKernelFixture(label: string, expireSoon: boolean,
  work: (persistence: PostgresFlarexPersistence, fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>,
    owner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>,
    controlOwner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>) => Promise<void>) {
  const disposals: Array<() => Promise<void>> = [];
  try {
    const targetOwner = await createFileScopedPostgresFixture();
    disposals.unshift(targetOwner.dispose);
    const controlOwner = await createFileScopedPostgresFixture();
    disposals.unshift(controlOwner.dispose);
    const fixture = await finiteBarrierFixture(targetOwner.persistence, label, false,
      { ...sharedLocator(`installed-finite-${label}`), schemaName: targetOwner.schemaName });
    // Placement is owned by the actual control installation; the existing
    // target owner created the real paired roots/session/claim/reservation.
    const deployment = await targetOwner.persistence.getDeploymentMetadata(fixture.context.deploymentId);
    if (deployment === null) throw new Error("Missing actual finite fixture deployment");
    await controlOwner.persistence.insertDeploymentMetadata(deployment);
    await controlOwner.persistence.insertScopeMetadata({ deploymentId: fixture.context.deploymentId,
      scopeId: fixture.context.scopeId, physicalLocator: fixture.context.physicalLocator });
    const targetRuntime = await createProtectedFileScopedPostgresFixture("managed", targetOwner);
    disposals.unshift(targetRuntime.dispose);
    const controlRuntime = await createProtectedFileScopedPostgresFixture("managed", controlOwner);
    disposals.unshift(controlRuntime.dispose);
    const pair = await createCoLocatedReadInstallationFixture({ target: targetRuntime,
      control: controlRuntime, controlOwner });
    const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, targetRuntime.persistence.drizzle));
    const controlProtection = await runEffect(prepareProtectedMetadata(targetRuntime.persistence.drizzle, refs.controlInstallation));
    const target = createPostgresLocatedPointMutationSessionActivationTargetV1(targetRuntime.persistence,
      fixture.context.physicalLocator, { managedInstallation: { installation: pair.installation, controlProtection } });
    if (!isLocatedExactRunningAttemptKernelV1(target) || !isLocatedFiniteRunningAttemptReadSyscallKernel(target))
      throw new Error("Expected installed full and compact attempt facets");
    if (expireSoon) await targetOwner.persistence.query(`update fx_system_snapshot_lease
      set lease_expires_at = clock_timestamp() + interval '2 seconds' where session_id = $1`, [fixture.activated.anchor.sessionId]);
    await work(targetRuntime.persistence, { ...fixture, target }, targetOwner, controlOwner);
  } finally {
    const failures: unknown[] = [];
    for (const dispose of disposals) {
      const settled = await Promise.allSettled([dispose()]);
      for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
    }
    if (failures.length > 0) throw new AggregateError(failures, "Installed finite fixture cleanup failed");
  }
}

async function finiteBarrierFixture(persistence: PostgresFlarexPersistence, label: string, expireSoon = true,
  physicalLocator = sharedLocator(`finite-barrier-${label}`)) {
  const ids = uuidFactory();
  const context = await provisionContext(persistence, `finite_barrier_${label}`, physicalLocator, ids);
  const activated = await activatePointMutationSession(createActivationPersistence(persistence, ids),
    pointMutationSessionActivationFixture(context.deploymentId, context.scopeId, { executionProfile: "finiteRoot" }));
  const target = createPostgresLocatedPointMutationSessionActivationTargetV1(persistence, context.physicalLocator);
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(context.deploymentId, {
    scopeMetadata: persistence, provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => { throw new Error("Shared scope has no split receipt"); },
    }, scopeClockTargets: { resolve: async () => target },
  }));
  if (!isLocatedExactRunningAttemptKernelV1(located.target) || !isLocatedFiniteRunningAttemptReadSyscallKernel(located.target))
    throw new Error("Expected full and finite attempt owner facets");
  const input = { selector: selectorFromAnchor(activated.anchor), preliminaryAuthority: located.authority,
    executionClaim: executionClaimForAnchor(activated.anchor) };
  // Controlled reservation fixture: canonical owner writes authentic attempt
  // pins under the full kernel. Application admission is covered separately.
  await runEffect(located.target[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1](input, (tx, full) => Effect.gen(function* () {
    expect(full.executionAuthorityGeneration).toBe("legacy_dynamic_worker_v1");
    const schemaVersionId = CatalogSchemaVersionIdSchema.make("schema_activation_v1");
    const reservation = yield* captureFiniteMetadataReservation({ deploymentId: context.deploymentId,
      scopeId: context.scopeId, sessionId: full.anchor.sessionId, attemptFence: full.anchor.attemptFence,
      storageGeneration: "flarexdb_v1", storageGenerationFence: full.anchor.storageGenerationFence,
      snapshotToken: full.anchor.snapshotToken, schemaVersionId, metadataWatermark: MetadataSequenceSchema.make(0n),
      application: { revisionId: "controlled_barrier_fixture", activationSequence: "1", headSha256: "a".repeat(64),
        activationSha256: "b".repeat(64), schemaVersionId, manifestSha256: "c".repeat(64) }, binding: null });
    const updated = yield* persistFiniteMetadataReservationInTransaction(tx, reservation);
    yield* Effect.fromResult(recognizeFiniteMetadataReservationUpdate(tx, full.snapshotLease, updated));
  })));
  if (expireSoon) await persistence.query(`update fx_system_snapshot_lease
    set lease_expires_at = clock_timestamp() + interval '2 seconds' where session_id = $1`, [activated.anchor.sessionId]);
  return { context, activated, target: located.target, input };
}

async function expectInstalledRefusalBeforeClaimRelease(
  fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>, owner: PostgresFlarexPersistence,
  expected: Readonly<Record<string, unknown>>) {
  const holder = await owner.pool.connect();
  let pending: Promise<unknown> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let callbacks = 0;
  try {
    await holder.query("begin");
    const held = await holder.query(`select session_id from fx_system_tx_execution_claim
      where session_id = $1 for update`, [fixture.activated.anchor.sessionId]);
    expect(held.rows).toHaveLength(1);
    pending = runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](fixture.input,
      () => { callbacks++; return Effect.void; }));
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Installed admission waited for a later execution-claim lock")), 2_000);
    });
    // The holder remains locked until finally. A later-lock regression fails
    // this bounded witness, then releases the blocker and drains the request.
    expect(await Promise.race([pending, deadline])).toMatchObject(expected);
    expect(callbacks).toBe(0);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await rollbackAndReleasePostgresClient(holder);
    await pending?.catch(() => undefined);
  }
}

async function takeOverFiniteFixtureClaim(persistence: PostgresFlarexPersistence,
  fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>) {
  // The entry owner can execute while its issued claim is live. A finite
  // takeover deliberately grants abort-only authority even for an open root:
  // durable rows cannot prove that a lost evaluator had no tentative children.
  await runEffect(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](
    fixture.input, () => Effect.void));
  await expireExecutionClaim(persistence, fixture.activated.anchor.sessionId);
  const acquired = await runEffect(createExecutionClaimAcquisition(persistence,
    "64000000-0000-4000-8000-000000000901").acquireEffect(fixture.input.selector));
  if (acquired.kind !== "acquired" || acquired.mode !== "abortOnly" || acquired.reason !== "dirtyOpen")
    throw new Error("Expected the genuine finite abort-only execution-claim takeover");
  expect(acquired.observation.claimOwner).not.toBe(fixture.input.executionClaim.claimOwner);
  expect(acquired.observation.claimFence).toBeGreaterThan(fixture.input.executionClaim.claimFence);
  const input = { ...fixture.input, executionClaim: {
    claimOwner: acquired.observation.claimOwner, claimFence: acquired.observation.claimFence,
    claimedAt: acquired.observation.claimedAt,
  } };
  return input;
}

async function expectFiniteRefusalBeforeData(persistence: PostgresFlarexPersistence,
  fixture: Awaited<ReturnType<typeof finiteBarrierFixture>>, input: ExactRunningAttemptKernelInputV1, reason: string) {
  const inventory = () => persistence.query(`select to_jsonb(s) as session, to_jsonb(l) as lease,
      to_jsonb(j) as journal, to_jsonb(c) as claim from fx_system_tx_session s
    join fx_system_snapshot_lease l using(scope_uuid,session_id,attempt_fence)
    join fx_system_tx_journal j using(scope_uuid,session_id,attempt_fence)
    join fx_system_tx_execution_claim c using(scope_uuid,session_id,attempt_fence)
    where s.scope_uuid = $1 and s.session_id = $2`,
    [Result.getOrThrow(projectScopeIdUuidV1Result(fixture.context.scopeId)).scopeUuid, fixture.activated.anchor.sessionId]);
  const before = await inventory();
  expect(before.rows).toHaveLength(1);
  let reachedData = false;
  const failure = await runFailure(fixture.target[RUN_FINITE_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT](input,
    () => { reachedData = true; return Effect.void; }));
  expect(failure).toMatchObject({ _tag: "ExactRunningAttemptTransactionV1Error", cause: { issue: { reason } } });
  expect(reachedData).toBe(false);
  expect(await inventory()).toEqual(before);
}

async function waitForAuthorityWaiter(persistence: PostgresFlarexPersistence, blockerPid: number, authorityWriter = true) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ waiting: boolean }>(`select exists(select 1 from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
        and $1::int = any(pg_blocking_pids(pid))
        and ($2::boolean = false or query like '%fx_system_scope_execution_authority%')) as waiting`,
    [blockerPid, authorityWriter]);
    if (result.rows[0]?.waiting === true) return;
    await delay(25);
  }
  throw new Error("No expected blocked authority transaction");
}

async function waitForFiniteLeaseExpiry(persistence: PostgresFlarexPersistence, sessionId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = await persistence.query<{ expired: boolean }>(`select lease_expires_at <= clock_timestamp() as expired
      from fx_system_snapshot_lease where session_id = $1`, [sessionId]);
    if (row.rows[0]?.expired === true) return;
    await delay(25);
  }
  throw new Error("Lease did not expire while its owner was blocked");
}

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
    await rollbackAndReleasePostgresClient(client);
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

async function waitForBlockedAttemptTail(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(`select count(*)::int as blocked
      from pg_stat_activity where datname = current_database()
        and wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))
        -- The function name follows 2kB of native projections and is truncated
        -- by the default activity buffer. This leading projection is stable.
        and query like 'select attempt_tail.disposition,%'`, [blockerPid]);
    if ((result.rows[0]?.blocked ?? 0) > 0) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for the running-attempt tail claim lock");
}

interface BlockedPostgresWriter {
  readonly pid: number;
  readonly blockers: readonly number[];
}

async function waitForBlockedSharedScopeClockWriter(
  persistence: PostgresFlarexPersistence,
  candidateBlockerPids: readonly number[],
  expectedWriterPid?: number,
): Promise<BlockedPostgresWriter> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{
      pid: number;
      blockers: number[];
    }>(
      `select pid::int as pid, pg_blocking_pids(pid)::int[] as blockers
       from pg_stat_activity
       where datname = current_database()
         and wait_event_type = 'Lock'
         and cardinality(pg_blocking_pids(pid)) > 0
         and query like '%fx_system_scope_clock%'
         and ($1::int is null or pid = $1::int)
         and exists (
           select 1
           from unnest($2::int[]) candidate(blocker_pid)
           where candidate.blocker_pid = any(pg_blocking_pids(pid))
         )`,
      [expectedWriterPid ?? null, candidateBlockerPids],
    );
    if (result.rows.length === 1) {
      const row = result.rows[0];
      if (
        row !== undefined &&
        Number.isInteger(row.pid) &&
        row.pid > 0 &&
        Array.isArray(row.blockers) &&
        row.blockers.every((pid) => Number.isInteger(pid) && pid > 0)
      ) {
        return Object.freeze({
          pid: row.pid,
          blockers: Object.freeze([...row.blockers]),
        });
      }
      throw new Error("Postgres returned invalid blocked-writer evidence.");
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for the shared scope-clock writer.");
}

async function transactionBackendPid(
  tx: AppRowTransaction,
): Promise<number> {
  const result = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid()::int as pid`,
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw new Error("Postgres returned an invalid backend PID row set.");
  });
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) {
    throw new Error("Postgres did not return a backend PID.");
  }
  const pid = Reflect.get(row, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("Postgres returned an invalid backend PID.");
  }
  return pid;
}

async function waitForTransactionEntryOrFailure<Result>(
  entry: Promise<Result>,
  operation: Promise<unknown>,
  label: string,
): Promise<Result> {
  return Promise.race([
    entry,
    operation.then(
      () => Promise.reject(new Error(`${label} settled before admission.`)),
      (cause) => Promise.reject(cause),
    ),
    delay(5_000).then(() => Promise.reject(
      new Error(`Timed out waiting for ${label} admission.`),
    )),
  ]);
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
