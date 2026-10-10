import { eq, sql } from "drizzle-orm";
import { fxSystemTransactionSessions, fxSystemScopeExecutionAuthorities, fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../../src/database/schema";
import { PointMutationSessionAuthorityCorruptionV1Error } from "../../../src/execution/session/errors";
import { withInstalledFiniteKernelFixture } from "./support/postgresFiniteFixture";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit } from "effect";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../../../src/database/postgres";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
} from "../../../src/scope/scopeAuthorityResolution";
import {
  PointMutationSessionAttemptLoadV1Error,
} from "../../../src/execution/session/errors";
import {
  createPointMutationSessionAttemptLoadPersistenceV1,
} from "../../../src/execution/session/attemptLoad";
import type {
  PointMutationSessionActivationResolutionPortsV1,
} from "../../../src/execution/session/constructionContracts";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  isLocatedExactRunningAttemptKernelV1,
} from "../../../src/execution/session/kernelContracts";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
} from "../../../src/execution/session/kernelContracts";
import {
  postgresUrl,
  rollbackAndReleasePostgresClient,
  useFileScopedPostgresPersistence,
  withTemporaryPostgresPersistence,
} from "../../support/postgresHelpers";
import { runEffect, runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import { activatePointMutationSession, loadPointMutationSessionAttempt } from "./support/attemptFixture";
import { pointMutationSessionActivationFixture } from "./support/activationEvidence";
import {
  provisionContext,
  createActivationPersistence,
  createLoadPersistence,
  createExecutionClaimAcquisition,
  selectorFromAnchor,
  attemptRowState,
  expireExecutionClaim,
  executionClaimRow,
  rowCounts,
  sharedLocator,
  uuidFactory,
  resolutionPorts,
} from "./support/postgresFixture";
import {
  waitForBlockedAttemptTail,
  waitForBlockedSharedScopeClockWriter,
  transactionBackendPid,
  waitForTransactionEntryOrFailure,
  deferred,
} from "./support/postgresLocks";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O03-B session authority", () => {
  const withPostgresPersistence = useFileScopedPostgresPersistence();


  it.skipIf(!process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("reports an out-of-JS-range running finite date as typed corruption during exact reload without writes", async () => {
    await withInstalledFiniteKernelFixture("attemptLoad_running_date_outside_js_range", false, async (_runtime, fixture, owner) => {
      const persistence = owner.persistence;
      const anchor = fixture.activated.anchor;
      const ports = { ...resolutionPorts(persistence), scopeSessionTargets: { resolve: async () => fixture.target } };
      expect(anchor.executionProfile).toBe("finiteRoot");
      const loader = createPointMutationSessionAttemptLoadPersistenceV1(ports);
      expect(await runEffect(loader.loadEffect(selectorFromAnchor(anchor)))).toMatchObject({ status: "loaded", attemptFacet: { kind: "nonPristine" } });
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
      const exit = await Effect.runPromiseExit(loader.loadEffect(selectorFromAnchor(anchor)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const failures = exit.cause.reasons.filter(Cause.isFailReason);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.error).toBeInstanceOf(PointMutationSessionAuthorityCorruptionV1Error);
        expect(failures[0]?.error).toMatchObject({ _tag: "PointMutationSessionAuthorityCorruptionV1Error", issue: "sessionRecordInvalid" });
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
});
