import { eq, sql } from "drizzle-orm";
import { fxSystemTransactionSessions, fxSystemScopeExecutionAuthorities, fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../../src/database/schema";
import { PointMutationSessionAuthorityCorruptionV1Error } from "../../../src/execution/session/errors";
import { PointMutationExecutionClaimAcquisitionCorruptionV1Error } from "../../../src/execution/claims/transactionExecutionClaimErrors";
import { Cause, Effect, Exit } from "effect";
import { withInstalledFiniteKernelFixture } from "../session/support/postgresFiniteFixture";
import { expireFiniteExecutionClaim } from "../session/support/postgresFixture";
import { setTimeout as delay } from "node:timers/promises";
import { TransactionAttemptFenceSchema } from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";
import {
  PointMutationExecutionClaimAcquisitionResourceV1Error,
} from "../../../src/execution/claims/transactionExecutionClaimErrors";
import {
  createPointMutationExecutionClaimAcquisitionV1,
} from "../../../src/execution/claims/acquisition";
import {
  postgresUrl,
  rollbackAndReleasePostgresClient,
  useFileScopedPostgresPersistence,
  withTemporaryPostgresPersistence,
} from "../../support/postgresHelpers";
import { runEffect, runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import { activatePointMutationSession } from "../session/support/attemptFixture";
import { pointMutationSessionActivationFixture } from "../session/support/activationEvidence";
import {
  provisionContext,
  createActivationPersistence,
  createExecutionClaimAcquisition,
  selectorFromAnchor,
  expireExecutionClaim,
  executionClaimRow,
  insertExpiredOutcome,
  sharedLocator,
  uuidFactory,
  resolutionPorts,
  resolutionPortsWithRunner,
} from "../session/support/postgresFixture";
import {
  holdScopeClock,
  waitForBlockedScopeClock,
  installClientQueryFault,
} from "../session/support/postgresLocks";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O03-B session authority", () => {
  const withPostgresPersistence = useFileScopedPostgresPersistence();


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("reports an out-of-JS-range running finite date as typed corruption during recovery acquisition without writes", async () => {
    await withInstalledFiniteKernelFixture("acquisition_running_date_outside_js_range", false, async (_runtime, fixture, owner) => {
      const persistence = owner.persistence;
      const anchor = fixture.activated.anchor;
      const ports = { ...resolutionPorts(persistence), scopeSessionTargets: { resolve: async () => fixture.target } };
      expect(anchor.executionProfile).toBe("finiteRoot");
      const acquisition = createPointMutationExecutionClaimAcquisitionV1(ports, { durationMilliseconds: 60_000 });
      await expireFiniteExecutionClaim(persistence, anchor.sessionId);
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
});
