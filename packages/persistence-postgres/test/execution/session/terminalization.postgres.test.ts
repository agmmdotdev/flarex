import { useFileScopedPersistence } from "../../support/fileScopedPersistenceFixture";
import { createPointMutationSessionAttemptTerminalizationPersistenceV1 } from "../../../src/execution/session/terminalization";
import { PointMutationSessionAttemptTerminalizationV1Error } from "../../../src/execution/session/errors";
import { resolutionPorts } from "./support/postgresFixture";
import { fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../../src/database/schema";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit } from "effect";
import { fxSystemTransactionSessions, fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { PointMutationSessionAuthorityCorruptionV1Error } from "../../../src/execution/session/errors";
import { captureSessionStorage, expectSessionPayloadScrubbed } from "./support/terminalStorageScenario";
import { setTimeout as delay } from "node:timers/promises";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../../src/scope/scopeClock";
import {
  postgresUrl,
  createFileScopedPostgresFixture,
  rollbackAndReleasePostgresClient,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";
import {
  abortPointMutationSessionAttempt,
  activatePointMutationSession,
  executionClaimForAnchor,
  expirePointMutationSessionAttempt,
} from "./support/attemptFixture";
import { pointMutationSessionActivationFixture } from "./support/activationEvidence";
import {
  provisionContext,
  createActivationPersistence,
  createTerminalizationPersistence,
  selectorFromAnchor,
  finiteAttemptRowState,
  finiteExecutionClaimRow,
  attemptRowState,
  rowCounts,
  sharedLocator,
  uuidFactory,
} from "./support/postgresFixture";
import { deferred } from "./support/postgresLocks";
import {
  finiteBarrierFixture,
  expectFiniteRefusalBeforeData,
  waitForAuthorityWaiter,
} from "./support/postgresFiniteFixture";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O03-B session authority", () => {
  const withPostgresPersistence = useFileScopedPostgresPersistence();


  for (const mode of ["ownerThrows", "fenceThrows", "invalidOwner"] as const) {
    it(`short-circuits nested abort claim capture failures before native admission: ${mode}`, async () => {
      await withPostgresPersistence(async persistence => {
        const ids = uuidFactory();
        const context = await provisionContext(persistence, `terminal_nested_claim_${mode}`, sharedLocator("terminal-nested-claim"), ids);
        const anchor = (await activatePointMutationSession(createActivationPersistence(persistence, ids),
          pointMutationSessionActivationFixture(context.deploymentId, context.scopeId))).anchor;
        const beforeSession = await persistence.drizzle.select({ stored: sql<string>`to_jsonb(${fxSystemTransactionSessions})::text` })
          .from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
        const beforePayload = await captureSessionStorage(persistence, anchor);
        const beforeClock = await persistence.getScopeClock(anchor.scopeId);
        const beforeAuthority = await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId));
        const childTables = [fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims];
        const beforeChildren = await Promise.all(childTables.map(table => persistence.drizzle.select().from(table)
          .where(eq(table.sessionId, anchor.sessionId))));
        const ports = resolutionPorts(persistence);
        let authorityReads = 0;
        let targetReads = 0;
        const terminalization = createPointMutationSessionAttemptTerminalizationPersistenceV1({ ...ports,
          scopeMetadata: {
            getScopeMetadata: async scopeId => { authorityReads++; return ports.scopeMetadata.getScopeMetadata(scopeId); },
            getScopeMetadataByDeploymentId: async deploymentId => { authorityReads++; return ports.scopeMetadata.getScopeMetadataByDeploymentId(deploymentId); },
          },
          scopeSessionTargets: { resolve: async physicalLocator => { targetReads++; return ports.scopeSessionTargets.resolve(physicalLocator); } },
        });
        const reads: string[] = [];
        const getterCause = new Error(`nested abort claim getter: ${mode}`);
        const authenticClaim = executionClaimForAnchor(anchor);
        const executionClaim = { ...authenticClaim };
        Object.defineProperties(executionClaim, {
          claimOwner: { enumerable: true, get: () => {
            reads.push("claimOwner");
            if (mode === "ownerThrows") throw getterCause;
            return mode === "invalidOwner" ? "invalid-owner" : authenticClaim.claimOwner;
          } },
          claimFence: { enumerable: true, get: () => {
            reads.push("claimFence");
            if (mode === "fenceThrows") throw getterCause;
            return authenticClaim.claimFence;
          } },
        });
        const input = { selector: selectorFromAnchor(anchor), expectedSnapshotToken: anchor.snapshotToken, executionClaim };
        Object.defineProperties(input, {
          selector: { enumerable: true, get: () => { reads.push("selector"); return selectorFromAnchor(anchor); } },
          expectedSnapshotToken: { enumerable: true, get: () => { reads.push("expectedSnapshotToken"); return anchor.snapshotToken; } },
          executionClaim: { enumerable: true, get: () => { reads.push("executionClaim"); return executionClaim; } },
        });
        const exit = await Effect.runPromiseExit(terminalization.abortEffect(input));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons).toHaveLength(1);
          const failures = exit.cause.reasons.filter(Cause.isFailReason);
          expect(failures).toHaveLength(1);
          expect(failures[0]?.error).toBeInstanceOf(PointMutationSessionAttemptTerminalizationV1Error);
          expect(failures[0]?.error).toMatchObject({ issue: { reason: "invalidAbortExecutionClaim",
            cause: mode === "invalidOwner" ? expect.objectContaining({ message: "Abort execution claim is invalid." }) : getterCause } });
          if (mode !== "invalidOwner" && failures[0]?.error instanceof PointMutationSessionAttemptTerminalizationV1Error)
            expect("cause" in failures[0].error.issue && failures[0].error.issue.cause).toBe(getterCause);
          expect(exit.cause.reasons.filter(Cause.isDieReason)).toHaveLength(0);
          expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toHaveLength(0);
        }
        // Ordinary invalid owner decoding remains eager: it still reads the fence.
        expect(reads).toEqual(["selector", "expectedSnapshotToken", "executionClaim", "claimOwner",
          ...(mode === "ownerThrows" ? [] : ["claimFence"])]);
        expect(authorityReads).toBe(0);
        expect(targetReads).toBe(0);
        expect(await persistence.drizzle.select({ stored: sql<string>`to_jsonb(${fxSystemTransactionSessions})::text` })
          .from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId))).toEqual(beforeSession);
        expect(await captureSessionStorage(persistence, anchor)).toEqual(beforePayload);
        expect(await persistence.getScopeClock(anchor.scopeId)).toEqual(beforeClock);
        expect(await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId))).toEqual(beforeAuthority);
        expect(await Promise.all(childTables.map(table => persistence.drizzle.select().from(table)
          .where(eq(table.sessionId, anchor.sessionId))))).toEqual(beforeChildren);
      });
    }, 120_000);
  }

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
    await withPostgresPersistence(async (persistence) => {
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
      const deadline = new AbortController();
      let pendingB: ReturnType<typeof abortPointMutationSessionAttempt> | undefined;
      let resultB;
      try {
        await Promise.race([
          entered.promise,
          pendingA.then(() => {
            throw new Error("Expected the first terminalization to pause at its session lock.");
          }),
        ]);
        pendingB = abortPointMutationSessionAttempt(terminalizationB, {
          selector: selectorFromAnchor(anchorB),
          executionClaim: executionClaimForAnchor(anchorB),
          expectedSnapshotToken: anchorB.snapshotToken,
        });
        resultB = await Promise.race([
          pendingB,
          delay(5_000, undefined, { signal: deadline.signal }).then(() => {
            throw new Error("Independent-scope terminalization timed out.");
          }),
        ]);
      } finally {
        release.resolve();
        deadline.abort();
        await Promise.allSettled(pendingB === undefined ? [pendingA] : [pendingA, pendingB]);
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
  const withFinitePersistence = useFileScopedPersistence(
    () => createFileScopedPostgresFixture({}, {}, "finiteCapture"),
    postgresUrl !== null,
  );

  it("reports an out-of-JS-range stored finite terminal date as typed corruption without writes", async () => {
    await withFinitePersistence(async persistence => {
      const fixture = await finiteBarrierFixture(persistence, "terminal_date_outside_js_range", false);
      const anchor = fixture.activated.anchor;
      expect(anchor.executionProfile).toBe("finiteRoot");
      const terminalization = createTerminalizationPersistence(persistence);
      const input = { selector: selectorFromAnchor(anchor), executionClaim: executionClaimForAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken };
      const terminalized = await runEffect(terminalization.abortEffect(input));
      expect(terminalized).toMatchObject({ status: "terminalized", terminal: { lifecycle: "aborted" } });
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
      if (storedTimestamp === undefined) throw new Error("Missing actual finite terminal timestamp");
      expect(storedTimestamp.nativeFinite).toBe(true);
      expect(storedTimestamp.exactTimestamp).toBe(true);
      expect(Number.isNaN(storedTimestamp.updatedAt.getTime())).toBe(true);
      const beforeSession = await finiteAttemptRowState(persistence, fixture.context.scopeId);
      const beforeClock = await persistence.getScopeClock(anchor.scopeId);
      if (beforeClock === null) throw new Error("Missing actual finite terminal scope clock");
      const beforeAuthority = await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId));
      expect(beforeAuthority).toHaveLength(1);
      const beforeCounts = await rowCounts(persistence, fixture.context.scopeId);
      expect(beforeCounts).toEqual({ sessions: 1, leases: 0, journals: 0, executionClaims: 0 });
      const exit = await Effect.runPromiseExit(terminalization.abortEffect(input));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const failures = exit.cause.reasons.filter(Cause.isFailReason);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.error).toBeInstanceOf(PointMutationSessionAuthorityCorruptionV1Error);
        expect(failures[0]?.error).toMatchObject({
          _tag: "PointMutationSessionAuthorityCorruptionV1Error",
          issue: "sessionRecordInvalid",
        });
        expect(exit.cause.reasons.filter(Cause.isDieReason)).toHaveLength(0);
        expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toHaveLength(0);
      }
      expect(await finiteAttemptRowState(persistence, fixture.context.scopeId)).toEqual(beforeSession);
      expect(await persistence.getScopeClock(anchor.scopeId)).toEqual(beforeClock);
      expect(await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId))).toEqual(beforeAuthority);
      expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual(beforeCounts);
    });
  }, 120_000);

  it("refuses a future terminal revocation counter without releasing its expired reservation", async () => {
    await withFinitePersistence(async persistence => {
      const fixture = await finiteBarrierFixture(persistence, "future_terminal_revocation", false);
      const anchor = fixture.activated.anchor;
      await persistence.query(`update fx_system_tx_session set authorization_revocation_epoch = 1
        where session_id = $1`, [anchor.sessionId]);
      await persistence.query(`update fx_system_tx_session
        set finite_claimed_at=clock_timestamp()-interval '3 minutes',
            finite_claim_expires_at=clock_timestamp()-interval '2 minutes', finite_lease_expires_at=clock_timestamp()-interval '1 minute' where session_id=$1`, [anchor.sessionId]);
      const before = await finiteAttemptRowState(persistence, fixture.context.scopeId);
      const payloadBefore = await captureSessionStorage(persistence, anchor);
      await expect(expirePointMutationSessionAttempt(createTerminalizationPersistence(persistence), selectorFromAnchor(anchor)))
        .rejects.toMatchObject({ _tag: "PointMutationSessionAuthorityCorruptionV1Error", issue: "sessionRecordInvalid" });
      expect(await finiteAttemptRowState(persistence, fixture.context.scopeId)).toEqual(before);
      expect(await captureSessionStorage(persistence, anchor)).toEqual(payloadBefore);
      expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({
        sessions: 1, leases: 0, journals: 0, executionClaims: 0,
      });
    });
  }, 120_000);


  for (const refusal of ["snapshot mismatch", "finishing lifecycle"] as const) {
    it(`refuses exact anchor terminal abort ${refusal} without writes`, async () => {
      await withFinitePersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `terminal_early_${refusal}`, false);
        const anchor = fixture.activated.anchor;
        if (refusal === "finishing lifecycle") await persistence.query(`update fx_system_tx_session
          set lifecycle = 'finishing' where session_id = $1`, [anchor.sessionId]);
        const before = await captureSessionStorage(persistence, anchor);
        await expect(abortPointMutationSessionAttempt(createTerminalizationPersistence(persistence), {
          selector: selectorFromAnchor(anchor), executionClaim: executionClaimForAnchor(anchor),
          expectedSnapshotToken: refusal === "snapshot mismatch"
            ? { ...anchor.snapshotToken, commitSeq: CommitSeqSchema.make(anchor.snapshotToken.commitSeq + 1n) }
            : anchor.snapshotToken,
        })).rejects.toMatchObject(refusal === "snapshot mismatch"
          ? { _tag: "PointMutationSessionAuthorityCorruptionV1Error", issue: "attemptSnapshotChanged" }
          : { _tag: "PointMutationSessionAttemptTerminalizationV1Error", issue: { reason: "attemptNotTerminalizable", lifecycle: "finishing" } });
        expect(await captureSessionStorage(persistence, anchor)).toEqual(before);
        expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({ sessions: 1, leases: 0, journals: 0, executionClaims: 0 });
      });
    }, 120_000);
  }


  it("observes an idempotent terminal abort without acquiring the claim relation", async () => {
    await withFinitePersistence(async persistence => {
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
    await withFinitePersistence(async persistence => {
      const fixture = await finiteBarrierFixture(persistence, "terminal_claim_wait", false);
      const anchor = fixture.activated.anchor;
      const before = await finiteAttemptRowState(persistence, fixture.context.scopeId);
      const payloadBefore = await captureSessionStorage(persistence, anchor);
      const claimBefore = await finiteExecutionClaimRow(persistence, anchor.sessionId);
      const held = await persistence.pool.connect();
      let pending: Promise<unknown> | undefined;
      let outcome: Promise<void> | undefined;
      try {
        await held.query("begin");
        await held.query("select 1 from fx_system_tx_session where session_id = $1 for update", [anchor.sessionId]);
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
        await held.query(`update fx_system_tx_session
          set finite_claim_expires_at = clock_timestamp() + interval '2 seconds' where session_id = $1`, [anchor.sessionId]);
        const deadline = Date.now() + 5_000;
        while (true) {
          const clock = await held.query<{ expired: boolean }>(`select finite_claim_expires_at <= clock_timestamp() as expired
            from fx_system_tx_session where session_id = $1`, [anchor.sessionId]);
          if (clock.rows[0]?.expired === true) break;
          if (Date.now() >= deadline) throw new Error("Claim did not expire while terminal cleanup waited");
          await delay(25);
        }
        const changedAnchor = await held.query(`select to_jsonb(s) as session from fx_system_tx_session s where session_id=$1`, [anchor.sessionId]);
        await held.query("commit");
        await outcome;
        expect(await finiteAttemptRowState(persistence, fixture.context.scopeId)).toEqual(changedAnchor.rows[0]);
        const payloadAfter = await captureSessionStorage(persistence, anchor);
        expect(payloadAfter.validatedArgsJson).toEqual(payloadBefore.validatedArgsJson);
        expect(await finiteExecutionClaimRow(persistence, anchor.sessionId)).toEqual(claimBefore);
        expect(await rowCounts(persistence, fixture.context.scopeId)).toEqual({
          sessions: 1, leases: 0, journals: 0, executionClaims: 0,
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
      await withFinitePersistence(async persistence => {
        const fixture = await finiteBarrierFixture(persistence, `revoked_${operation}`, false);
        const anchor = fixture.activated.anchor;
        const reserved = await persistence.query<{ reserved: boolean }>(`
          select finite_metadata_watermark is not null
            and finite_attempt_bytes is not null
            and finite_attempt_sha256 is not null as reserved
          from fx_system_tx_session where session_id = $1`, [anchor.sessionId]);
        expect(reserved.rows).toEqual([{ reserved: true }]);
        await persistence.drizzle.transaction(tx => runEffect(
          advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, fixture.context.scopeId)));
        await expectFiniteRefusalBeforeData(persistence, fixture, fixture.input, "authorizationRevocationEpochChanged");
        if (operation === "expire") await persistence.query(`update fx_system_tx_session
          set finite_claimed_at=clock_timestamp()-interval '3 minutes',
            finite_claim_expires_at=clock_timestamp()-interval '2 minutes', finite_lease_expires_at=clock_timestamp()-interval '1 minute' where session_id=$1`, [anchor.sessionId]);
        const payloadBefore = await captureSessionStorage(persistence, anchor);
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
});
