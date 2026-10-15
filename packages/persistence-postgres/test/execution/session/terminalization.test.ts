import { createTestPGlite } from "../../support/pgliteSearchExtensions";
import {
  CAPTURE_FINITE_STORAGE,
  captureFiniteStorageEffect,
} from "../../../src/execution/finiteStorageCapture";
import {
  captureFiniteAttemptAnchor,
  readFiniteAttemptAnchorRow,
} from "../../../src/execution/finiteAttemptAnchor";
import { captureFiniteMetadataReservation } from "../../../src/execution/finiteMetadataReservation";
import { finiteApplicationMetadataScenario } from "../../application/finiteApplicationMetadataScenario";
import { createMigratedPGlitePersistence, migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import { captureSessionStorage, expectSessionPayloadScrubbed } from "./support/terminalStorageScenario";
import type { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { TransactionAttemptFenceSchema } from "flarex-protocol/transaction-session";
import { Cause, Effect, Exit, Fiber } from "effect";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../../src/database/pglite";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../../src/scope/scopeAuthorityResolution";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
  fxSystemScopeExecutionAuthorities,
} from "../../../src/database/schema";
import {
  PointMutationSessionAttemptTerminalizationPersistenceV1Error,
  PointMutationSessionAttemptTerminalizationV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
} from "../../../src/execution/session/errors";
import {
  createPointMutationExecutionClaimAcquisitionV1,
} from "../../../src/execution/claims/acquisition";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import {
  createPointMutationSessionAttemptLoadPersistenceV1,
} from "../../../src/execution/session/attemptLoad";
import {
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
} from "../../../src/execution/session/terminalization";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
} from "../../../src/execution/session/constructionContracts";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../../src/scope/scopeClock";
import {
  abortPointMutationSessionAttempt,
  activatePointMutationSession,
  executionClaimForAnchor,
  expirePointMutationSessionAttempt,
} from "./support/attemptFixture";
import { pointMutationSessionActivationFixture } from "./support/activationEvidence";
import { setFlarexActivationClock } from "./support/authorityClock";
import { runEffect, runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import {
  type AttemptLoadContext,
  sharedLocator,
  selectorFromAnchor,
  resolutionPorts,
  rowState,
  deferredSignal,
} from "./support/attemptLoadFixture";

type RootAttemptTerminalizationExport = Extract<
  keyof typeof import("../../../src"),
  "createPointMutationSessionAttemptTerminalizationPersistenceV1"
>;

describe("O03-B exact point-mutation attempt authority", () => {
  let driver: PGlite;

  let persistence: PGliteFlarexPersistence;

  let uuidCounter = 1;


  beforeAll(async () => {
    driver = await createTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    persistence = await createPGlitePersistence({ db: driver });
  });


  afterAll(async () => {
    await driver.close();
  });


  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `72000000-0000-4000-8000-${suffix}`;
  }


  async function provisionContext(label: string): Promise<AttemptLoadContext> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_attempt_load_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => nextUuid(),
      },
    ).ensure({
      deploymentId,
      projectId: `project_attempt_load_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return { deploymentId, scopeId };
  }


  async function activate(context: AttemptLoadContext) {
    return activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        resolutionPorts(persistence),
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid: () => nextUuid(),
        },
      ),
      pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ),
    );
  }


  function terminalizationPersistence(
    options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  ) {
    return createPointMutationSessionAttemptTerminalizationPersistenceV1(
      resolutionPorts(persistence, options),
    );
  }


  for (const mode of ["ownerThrows", "fenceThrows", "invalidOwner"] as const) {
    it(`short-circuits nested abort claim capture failures before native admission: ${mode}`, async () => {
        const context = await provisionContext(`terminal_nested_claim_${mode}`);
        const anchor = (await activate(context)).anchor;
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

    }, 120_000);
  }

  it("atomically aborts an exact attempt and observes its first terminal state", async () => {
    expectTypeOf<RootAttemptTerminalizationExport>().toEqualTypeOf<never>();
    const context = await provisionContext("terminal_abort");
    const anchor = (await activate(context)).anchor;
    const payloadBefore = await captureSessionStorage(persistence, anchor);
    const selector = selectorFromAnchor(anchor);
    const events: string[] = [];
    const terminalization = terminalizationPersistence({
      afterTerminalizationEvent: (event) => {
        events.push(`${event.phase}:${event.step}`);
      },
    });

    const aborted = await abortPointMutationSessionAttempt(terminalization, {
      selector,
      executionClaim: executionClaimForAnchor(anchor),
      expectedSnapshotToken: anchor.snapshotToken,
    });
    const terminalStorage = await captureSessionStorage(persistence, anchor);
    expectSessionPayloadScrubbed(payloadBefore, terminalStorage);
    const firstTerminalizedAt = aborted.terminal.terminalizedAt;

    expect(aborted).toMatchObject({
      status: "terminalized",
      terminal: {
        ...selector,
        lifecycle: "aborted",
      },
    });
    expect(Object.isFrozen(aborted)).toBe(true);
    expect(Object.isFrozen(aborted.terminal)).toBe(true);
    expect(events).toEqual([
      "lock:clockLocked",
      "lock:sessionLocked",
      "lock:leaseLocked",
      "lock:journalRootLocked",
      "lock:executionClaimLocked",
      "write:journalDeleted",
      "write:leaseDeleted",
      "write:sessionTerminalized",
    ]);
    const stored = await rowState(persistence, context.scopeId);
    expect(stored).toMatchObject({
      lifecycle: "aborted",
      attempt_fence: "1",
      lease_attempt_fence: null,
      snapshot_epoch_uuid: null,
      snapshot_commit_seq: null,
      lease_expires_at: null,
    });
    expect(Date.parse(stored.session_updated_at)).toBe(
      Date.parse(firstTerminalizedAt),
    );

    events.length = 0;
    const repeatedAbort = await abortPointMutationSessionAttempt(
      terminalization,
      {
        selector,
        executionClaim: executionClaimForAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken,
      },
    );
    const repeatedExpiry = await expirePointMutationSessionAttempt(
      terminalization,
      selector,
    );
    expect(repeatedAbort).toEqual({
      status: "observed",
      terminal: aborted.terminal,
    });
    expect(repeatedExpiry).toEqual(repeatedAbort);
    expect(events).toEqual([
      "lock:clockLocked",
      "lock:sessionLocked",
      "lock:clockLocked",
      "lock:sessionLocked",
    ]);
    expect(await rowState(persistence, context.scopeId)).toEqual(stored);
    expect(await captureSessionStorage(persistence, anchor)).toEqual(terminalStorage);

    const finishing = await provisionContext("terminal_finishing");
    const finishingAnchor = (await activate(finishing)).anchor;
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'finishing' where session_id = $1`,
      [finishingAnchor.sessionId],
    );
    await expect(
      abortPointMutationSessionAttempt(terminalization, {
        selector: selectorFromAnchor(finishingAnchor),
        executionClaim: executionClaimForAnchor(finishingAnchor),
        expectedSnapshotToken: finishingAnchor.snapshotToken,
      }),
    ).rejects.toMatchObject({
      issue: { reason: "attemptNotTerminalizable", lifecycle: "finishing" },
    } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);

    const committed = await provisionContext("terminal_committed");
    const committedAnchor = (await activate(committed)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [committedAnchor.sessionId],
    );
    await persistence.query(
      `delete from fx_system_tx_journal where session_id = $1`,
      [committedAnchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'committed', validated_args_json = null, validated_args_canonical_bytes = null, authorization_grant_json = null, authorization_grant_canonical_bytes = null, application_execution_authority_json = null, application_execution_authority_canonical_bytes = null where session_id = $1`,
      [committedAnchor.sessionId],
    );
    await expect(
      expirePointMutationSessionAttempt(
        terminalization,
        selectorFromAnchor(committedAnchor),
      ),
    ).resolves.toMatchObject({
      status: "observed",
      terminal: { lifecycle: "committed" },
    });
  });


  it("rejects an old execution owner from abort after an exact takeover", async () => {
    const context = await provisionContext("terminal_stale_execution_claim");
    const anchor = (await activate(context)).anchor;
    const oldClaim = executionClaimForAnchor(anchor);
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [anchor.sessionId],
    );
    const acquisition = createPointMutationExecutionClaimAcquisitionV1(
      resolutionPorts(persistence),
      {
        durationMilliseconds: 30_000,
        randomOwner: () => "82000000-0000-4000-8000-000000009991",
      },
    );
    await expect(runEffect(acquisition.acquireEffect(
      selectorFromAnchor(anchor),
    ))).resolves.toMatchObject({
      kind: "acquired",
      mode: "execute",
      observation: { claimFence: 2n },
    });

    await expect(runFailure(terminalizationPersistence().abortEffect({
      selector: selectorFromAnchor(anchor),
      executionClaim: oldClaim,
      expectedSnapshotToken: anchor.snapshotToken,
    }))).resolves.toMatchObject({
      _tag: "PointMutationSessionAttemptTerminalizationV1Error",
      issue: { reason: "executionClaimUnavailable" },
    });
  });


  it("maps terminalization authority rejection into the typed Effect channel", async () => {
    const context = await provisionContext("terminal_typed_authority_failure");
    const anchor = (await activate(context)).anchor;
    const cause = new Error("terminalization metadata unavailable");
    const ports = resolutionPorts(persistence);
    const terminalization =
      createPointMutationSessionAttemptTerminalizationPersistenceV1({
        ...ports,
        scopeMetadata: {
          getScopeMetadata: async () => {
            throw cause;
          },
          getScopeMetadataByDeploymentId: async () => {
            throw cause;
          },
        },
      });

    const failure = await runFailure(
      terminalization.abortEffect({
        selector: selectorFromAnchor(anchor),
        executionClaim: executionClaimForAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken,
      }),
    );

    expect(failure).toBeInstanceOf(
      PointMutationSessionAttemptTerminalizationPersistenceV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PointMutationSessionAttemptTerminalizationPersistenceV1Error",
      operation: "scopeMetadataRead",
      cause,
    });
  });


  it("short-circuits invalid abort input before authority resolution", async () => {
    const context = await provisionContext("terminal_invalid_input");
    const anchor = (await activate(context)).anchor;
    const ports = resolutionPorts(persistence);
    let authorityReads = 0;
    const terminalization =
      createPointMutationSessionAttemptTerminalizationPersistenceV1({
        ...ports,
        scopeMetadata: {
          getScopeMetadata: async (scopeId) => {
            authorityReads += 1;
            return ports.scopeMetadata.getScopeMetadata(scopeId);
          },
          getScopeMetadataByDeploymentId: async (deploymentId) => {
            authorityReads += 1;
            return ports.scopeMetadata.getScopeMetadataByDeploymentId(
              deploymentId,
            );
          },
        },
      });
    const input = {
      selector: selectorFromAnchor(anchor),
      executionClaim: executionClaimForAnchor(anchor),
      expectedSnapshotToken: anchor.snapshotToken,
    };
    Object.defineProperty(input, "selector", {
      enumerable: true,
      get: () => {
        throw new Error("selector getter failed");
      },
    });

    const failure = await runFailure(terminalization.abortEffect(input));

    expect(failure).toMatchObject({
      issue: {
        reason: "invalidSelector",
        cause: expect.any(Error),
      },
    } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect(authorityReads).toBe(0);
  });


  it("does not observe interruption until terminalization commits atomically", async () => {
    const context = await provisionContext("terminal_interruption");
    const anchor = (await activate(context)).anchor;
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const terminalization = terminalizationPersistence({
      afterTerminalizationEvent: async (event) => {
        if (event.phase !== "write" || event.step !== "journalDeleted") return;
        entered.resolve();
        await release.promise;
      },
    });

    const fiber = Effect.runFork(
      terminalization.abortEffect({
        selector: selectorFromAnchor(anchor),
        executionClaim: executionClaimForAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken,
      }),
    );
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
    expect(await rowState(persistence, context.scopeId)).toMatchObject({
      lifecycle: "aborted",
      lease_attempt_fence: null,
    });
  });


  it("uses post-lock database time to distinguish live abort from expiry", async () => {
    const live = await provisionContext("terminal_live_expiry");
    const liveAnchor = (await activate(live)).anchor;
    const liveSelector = selectorFromAnchor(liveAnchor);
    const terminalization = terminalizationPersistence();
    const before = await rowState(persistence, live.scopeId);

    await expect(expirePointMutationSessionAttempt(
      terminalization,
      liveSelector,
    )).rejects.toMatchObject({
      issue: { reason: "attemptStillLive" },
    });
    expect(await rowState(persistence, live.scopeId)).toEqual(before);

    await persistence.query(
      `update fx_system_snapshot_lease
       set lease_expires_at = '2000-01-01T00:00:00.000Z'
       where session_id = $1`,
      [liveAnchor.sessionId],
    );
    await expect(expirePointMutationSessionAttempt(
      terminalization,
      liveSelector,
    )).resolves.toMatchObject({
      status: "terminalized",
      terminal: { lifecycle: "expired" },
    });

    const lateAbort = await provisionContext("terminal_late_abort");
    const lateAbortAnchor = (await activate(lateAbort)).anchor;
    await persistence.query(
      `update fx_system_snapshot_lease
       set lease_expires_at = '2000-01-01T00:00:00.000Z'
       where session_id = $1`,
      [lateAbortAnchor.sessionId],
    );
    await expect(
      abortPointMutationSessionAttempt(terminalization, {
        selector: selectorFromAnchor(lateAbortAnchor),
        executionClaim: executionClaimForAnchor(lateAbortAnchor),
        expectedSnapshotToken: lateAbortAnchor.snapshotToken,
      }),
    ).resolves.toMatchObject({
      status: "terminalized",
      terminal: { lifecycle: "expired" },
    });
  });


  it("terminalizes an expired attempt whose snapshot is below the retained floor", async () => {
    const context = await provisionContext("terminal_expired_below_floor");
    const anchor = (await activate(context)).anchor;
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
      terminalizationPersistence(),
      selectorFromAnchor(anchor),
    )).resolves.toMatchObject({
      status: "terminalized",
      terminal: { lifecycle: "expired" },
    });
    await expect(rowState(persistence, context.scopeId)).resolves
      .toMatchObject({
        lifecycle: "expired",
        lease_attempt_fence: null,
        snapshot_epoch_uuid: null,
        snapshot_commit_seq: null,
        lease_expires_at: null,
      });
  });


  it("reports an out-of-JS-range stored finite terminal date as typed corruption without writes", async () => {
    const persistence = await createMigratedPGlitePersistence(undefined, "finiteCapture");
    await finiteApplicationMetadataScenario(persistence, { afterMetadata: async entry => {
      const anchor = entry.context.anchor;
      expect(anchor.executionProfile).toBe("finiteRoot");
      const terminalization = createPointMutationSessionAttemptTerminalizationPersistenceV1(entry.sessionAuthority);
      const input = { selector: selectorFromAnchor(anchor), executionClaim: entry.context.executionClaim,
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
      const beforeSession = await persistence.drizzle.select({
        stored: sql<string>`to_jsonb(${fxSystemTransactionSessions})::text`,
      }).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
      expect(beforeSession).toHaveLength(1);
      const beforeClock = await persistence.getScopeClock(anchor.scopeId);
      if (beforeClock === null) throw new Error("Missing actual finite terminal scope clock");
      const beforeAuthority = await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId));
      expect(beforeAuthority).toHaveLength(1);
      for (const table of [fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims])
        expect(await persistence.drizzle.select().from(table).where(eq(table.sessionId, anchor.sessionId))).toEqual([]);
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
      expect(await persistence.drizzle.select({
        stored: sql<string>`to_jsonb(${fxSystemTransactionSessions})::text`,
      }).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId))).toEqual(beforeSession);
      expect(await persistence.getScopeClock(anchor.scopeId)).toEqual(beforeClock);
      expect(await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId))).toEqual(beforeAuthority);
      for (const table of [fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims])
        expect(await persistence.drizzle.select().from(table).where(eq(table.sessionId, anchor.sessionId))).toEqual([]);
    } });
  }, 120_000);

  for (const operation of ["abort", "expire"] as const) {
    it(`releases a revoked finite reservation through exact ${operation} cleanup`, async () => {
      const persistence = await createMigratedPGlitePersistence(undefined, "finiteCapture");
      await finiteApplicationMetadataScenario(persistence, { afterMetadata: async entry => {
        const anchor = entry.context.anchor;
        const reservation = entry.context.finiteAttempt.reservation;
        if (reservation === null) throw new Error("Missing actual confirmed finite metadata reservation");
        const retainedReservation = await runEffect(captureFiniteMetadataReservation(reservation));
        const finiteAnchor = await runEffect(captureFiniteAttemptAnchor({ snapshotToken: anchor.snapshotToken, reservation: retainedReservation }));
        await runEffect(readFiniteAttemptAnchorRow(entry.context.session, finiteAnchor));
        const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(anchor.deploymentId, entry.authorityPorts));
        if (!(CAPTURE_FINITE_STORAGE in located.target)) throw new Error("Missing genuine finite storage owner");
        const input = { selector: selectorFromAnchor(anchor), preliminaryAuthority: located.authority,
          executionClaim: entry.context.executionClaim, finiteAnchor,
          finiteApplicationReadDemand: entry.finiteApplicationReadDemand };
        const before = await captureSessionStorage(persistence, anchor);
        expect(before.executionProfile).toBe("finiteRoot");
        expect(before.finiteAttemptBytes?.byteLength).toBeGreaterThan(0);
        expect(before.finiteAttemptSha256?.byteLength).toBe(32);
        expect(before.finiteLeaseExpiresAt).not.toBeNull();
        const beforeClock = await persistence.getScopeClock(anchor.scopeId);
        if (beforeClock === null) throw new Error("Missing actual finite scope clock");
        const beforeAuthority = (await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId)))[0];
        if (beforeAuthority === undefined) throw new Error("Missing actual finite execution authority");
        await persistence.drizzle.transaction(tx => runEffect(
          advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, anchor.scopeId)));
        let callbacks = 0;
        const refusal = await runFailure(captureFiniteStorageEffect(located.target, input,
          { kind: "transactionTime" }).pipe(Effect.tap(() => Effect.sync(() => { callbacks += 1; }))));
        expect(refusal).toMatchObject({ _tag: "FiniteStorageCaptureError", reason: "authorizationRevocationEpochChanged" });
        expect(callbacks).toBe(0);
        expect(await captureSessionStorage(persistence, anchor)).toEqual(before);
        if (operation === "expire") await persistence.drizzle.update(fxSystemTransactionSessions).set({
          finiteClaimedAt: sql`clock_timestamp() - interval '3 minutes'`,
          finiteClaimExpiresAt: sql`clock_timestamp() - interval '2 minutes'`,
          finiteLeaseExpiresAt: sql`clock_timestamp() - interval '1 minute'`,
        }).where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
        const beforeTerminal = await captureSessionStorage(persistence, anchor);
        const terminalization = createPointMutationSessionAttemptTerminalizationPersistenceV1(entry.sessionAuthority);
        const result = operation === "abort"
          ? await abortPointMutationSessionAttempt(terminalization, { selector: selectorFromAnchor(anchor),
              executionClaim: entry.context.executionClaim, expectedSnapshotToken: anchor.snapshotToken })
          : await expirePointMutationSessionAttempt(terminalization, selectorFromAnchor(anchor));
        expect(result).toMatchObject({ status: "terminalized",
          terminal: { lifecycle: operation === "abort" ? "aborted" : "expired" } });
        const terminal = await captureSessionStorage(persistence, anchor);
        // Finite terminal evidence retains its embedded anchor and lease/claim
        // scalars. The terminal lifecycle releases their execution authority.
        expectSessionPayloadScrubbed(beforeTerminal, terminal);
        expect(terminal.finiteAttemptBytes).toEqual(before.finiteAttemptBytes);
        expect(terminal.finiteAttemptSha256).toEqual(before.finiteAttemptSha256);
        for (const table of [fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims])
          expect(await persistence.drizzle.select().from(table).where(eq(table.sessionId, anchor.sessionId))).toEqual([]);
        const loader = createPointMutationSessionAttemptLoadPersistenceV1(entry.sessionAuthority);
        expect(await runFailure(loader.loadEffect(selectorFromAnchor(anchor)))).toMatchObject({
          _tag: "PointMutationSessionAttemptLoadV1Error", issue: { reason: "attemptNotRunning" },
        });
        const afterAuthority = (await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, anchor.scopeId)))[0];
        expect(afterAuthority?.authorizationRevocationEpoch).toBe(beforeAuthority.authorizationRevocationEpoch + 1n);
        expect((await persistence.getScopeClock(anchor.scopeId))?.lastCommitSeq).toBe(beforeClock.lastCommitSeq);
      } });
    });
  }


  it("refuses a future terminal revocation counter without releasing its expired lease", async () => {
    const context = await provisionContext("terminal_future_revocation");
    const anchor = (await activate(context)).anchor;
    await persistence.query(`update fx_system_tx_session set authorization_revocation_epoch = 1
      where session_id = $1`, [anchor.sessionId]);
    await persistence.query(`update fx_system_snapshot_lease
      set lease_expires_at = '2000-01-01T00:00:00Z' where session_id = $1`, [anchor.sessionId]);
    const before = await rowState(persistence, context.scopeId);
    const payloadBefore = await captureSessionStorage(persistence, anchor);
    await expect(expirePointMutationSessionAttempt(terminalizationPersistence(), selectorFromAnchor(anchor)))
      .rejects.toMatchObject({ issue: { reason: "authorizationRevocationEpochChanged" } } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect(await rowState(persistence, context.scopeId)).toEqual(before);
    expect(await captureSessionStorage(persistence, anchor)).toEqual(payloadBefore);
  });


  it("fails closed on invalid lifecycle, active-child, snapshot, fence, and authority state", async () => {
    const terminalization = terminalizationPersistence();

    const missingLease = await provisionContext("terminal_missing_lease");
    const missingLeaseAnchor = (await activate(missingLease)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [missingLeaseAnchor.sessionId],
    );
    await expect(expirePointMutationSessionAttempt(
      terminalization,
      selectorFromAnchor(missingLeaseAnchor),
    ))
      .rejects.toMatchObject({
        issue: "snapshotLeaseMissing",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const terminalLease = await provisionContext("terminal_lease_present");
    const terminalLeaseAnchor = (await activate(terminalLease)).anchor;
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'aborted', validated_args_json = null, validated_args_canonical_bytes = null, authorization_grant_json = null, authorization_grant_canonical_bytes = null, application_execution_authority_json = null, application_execution_authority_canonical_bytes = null where session_id = $1`,
      [terminalLeaseAnchor.sessionId],
    );
    await expect(expirePointMutationSessionAttempt(
      terminalization,
      selectorFromAnchor(terminalLeaseAnchor),
    ))
      .rejects.toMatchObject({
        issue: "terminalSnapshotLeasePresent",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    for (const lifecycle of ["created", "committing", "retrying"] as const) {
      const transitional = await provisionContext(
        `terminal_transitional_${lifecycle}`,
      );
      const transitionalAnchor = (await activate(transitional)).anchor;
      await persistence.query(
        `update fx_system_tx_session set lifecycle = $2 where session_id = $1`,
        [transitionalAnchor.sessionId, lifecycle],
      );
      await expect(
        expirePointMutationSessionAttempt(
          terminalization,
          selectorFromAnchor(transitionalAnchor),
        ),
      ).rejects.toMatchObject({
        issue: { reason: "attemptNotTerminalizable", lifecycle },
      } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    }

    const changedSnapshot = await provisionContext("terminal_snapshot_changed");
    const changedSnapshotAnchor = (await activate(changedSnapshot)).anchor;
    await persistence.query(
      `update fx_system_snapshot_lease set snapshot_commit_seq = 1
       where session_id = $1`,
      [changedSnapshotAnchor.sessionId],
    );
    await setFlarexActivationClock(persistence, changedSnapshot.scopeId, {
      lastCommitSeq: 1n,
    });
    await expect(
      abortPointMutationSessionAttempt(terminalization, {
        selector: selectorFromAnchor(changedSnapshotAnchor),
        executionClaim: executionClaimForAnchor(changedSnapshotAnchor),
        expectedSnapshotToken: changedSnapshotAnchor.snapshotToken,
      }),
    ).rejects.toMatchObject({
      issue: "attemptSnapshotChanged",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const stale = await provisionContext("terminal_stale_fence");
    const staleAnchor = (await activate(stale)).anchor;
    const staleLeases = await persistence.drizzle
      .select()
      .from(fxSystemSnapshotLeases)
      .where(eq(fxSystemSnapshotLeases.sessionId, staleAnchor.sessionId));
    const staleLease = staleLeases[0];
    const staleJournals = await persistence.drizzle
      .select()
      .from(fxSystemTransactionJournals)
      .where(eq(fxSystemTransactionJournals.sessionId, staleAnchor.sessionId));
    const staleJournal = staleJournals[0];
    if (staleLease === undefined || staleJournal === undefined) {
      throw new Error("Stale-fence fixture is missing its active attempt.");
    }
    const newerFence = TransactionAttemptFenceSchema.make(2n);
    await persistence.drizzle.transaction(async (tx) => {
      await tx
        .delete(fxSystemSnapshotLeases)
        .where(eq(fxSystemSnapshotLeases.sessionId, staleAnchor.sessionId));
      await tx
        .delete(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, staleAnchor.sessionId));
      await tx
        .update(fxSystemTransactionSessions)
        .set({ attemptFence: newerFence })
        .where(eq(fxSystemTransactionSessions.sessionId, staleAnchor.sessionId));
      await tx.insert(fxSystemSnapshotLeases).values({
        ...staleLease,
        attemptFence: newerFence,
      });
      await tx.insert(fxSystemTransactionJournals).values({
        ...staleJournal,
        attemptFence: newerFence,
      });
    });
    await expect(
      expirePointMutationSessionAttempt(
        terminalization,
        selectorFromAnchor(staleAnchor),
      ),
    ).rejects.toMatchObject({
      issue: { reason: "staleAttemptFence" },
    } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect(await rowState(persistence, stale.scopeId)).toMatchObject({
      attempt_fence: "2",
      lease_attempt_fence: "2",
    });

    const drift = await provisionContext("terminal_authority_drift");
    const driftAnchor = (await activate(drift)).anchor;
    await persistence.query(
      `update fx_system_scope_execution_authority
       set authorization_revocation_epoch = authorization_revocation_epoch + 1
       where scope_id = $1`,
      [drift.scopeId],
    );
    await expect(expirePointMutationSessionAttempt(
      terminalization,
      selectorFromAnchor(driftAnchor),
    ))
      .rejects.toMatchObject({
        issue: { reason: "attemptStillLive", effectiveExpiresAt: driftAnchor.leaseExpiresAt },
      } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect((await rowState(persistence, drift.scopeId)).lease_attempt_fence)
      .toBe("1");

    const generationDrift = await provisionContext(
      "terminal_generation_fence_drift",
    );
    const generationDriftAnchor = (await activate(generationDrift)).anchor;
    await persistence.query(
      `update fx_system_scope_execution_authority
       set storage_generation_fence = storage_generation_fence + 1
       where scope_id = $1`,
      [generationDrift.scopeId],
    );
    await expect(
      expirePointMutationSessionAttempt(
        terminalization,
        selectorFromAnchor(generationDriftAnchor),
      ),
    ).rejects.toMatchObject({
      issue: { reason: "storageGenerationFenceChanged" },
    } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect(
      (await rowState(persistence, generationDrift.scopeId)).lease_attempt_fence,
    ).toBe("1");
  });


  it("preserves the maximum signed-int64 fence through exact terminalization", async () => {
    const context = await provisionContext("terminal_max_fence");
    const anchor = (await activate(context)).anchor;
    const sessions = await persistence.drizzle
      .select()
      .from(fxSystemTransactionSessions)
      .where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
    const leases = await persistence.drizzle
      .select()
      .from(fxSystemSnapshotLeases)
      .where(eq(fxSystemSnapshotLeases.sessionId, anchor.sessionId));
    const journals = await persistence.drizzle
      .select()
      .from(fxSystemTransactionJournals)
      .where(eq(fxSystemTransactionJournals.sessionId, anchor.sessionId));
    const claims = await persistence.drizzle
      .select()
      .from(fxSystemTransactionExecutionClaims)
      .where(eq(
        fxSystemTransactionExecutionClaims.sessionId,
        anchor.sessionId,
      ));
    const session = sessions[0];
    const lease = leases[0];
    const journal = journals[0];
    const claim = claims[0];
    if (
      session === undefined ||
      lease === undefined ||
      journal === undefined ||
      claim === undefined
    ) {
      throw new Error("Maximum-fence fixture is missing its active attempt.");
    }
    const maximumFence = TransactionAttemptFenceSchema.make(
      9_223_372_036_854_775_807n,
    );
    await persistence.drizzle.transaction(async (tx) => {
      await tx
        .delete(fxSystemSnapshotLeases)
        .where(eq(fxSystemSnapshotLeases.sessionId, anchor.sessionId));
      await tx
        .delete(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, anchor.sessionId));
      await tx
        .update(fxSystemTransactionSessions)
        .set({ attemptFence: maximumFence })
        .where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
      await tx.insert(fxSystemSnapshotLeases).values({
        ...lease,
        attemptFence: maximumFence,
      });
      await tx.insert(fxSystemTransactionJournals).values({
        ...journal,
        attemptFence: maximumFence,
      });
      await tx.insert(fxSystemTransactionExecutionClaims).values({
        ...claim,
        attemptFence: maximumFence,
      });
    });
    const selector = Object.freeze({
      ...selectorFromAnchor(anchor),
      attemptFence: maximumFence,
    });

    const result = await abortPointMutationSessionAttempt(
      terminalizationPersistence(),
      {
        selector,
        executionClaim: executionClaimForAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken,
      },
    );

    expect(result.terminal.attemptFence).toBe(maximumFence);
    expect(result.terminal.lifecycle).toBe("aborted");
    expect(await rowState(persistence, context.scopeId)).toMatchObject({
      lifecycle: "aborted",
      attempt_fence: maximumFence.toString(),
      lease_attempt_fence: null,
    });
  });


  it("rolls back the exact lease and terminal anchor after either write", async () => {
    for (const failureStep of [
      "leaseDeleted",
      "sessionTerminalized",
    ] as const) {
      const context = await provisionContext(`terminal_rollback_${failureStep}`);
      const anchor = (await activate(context)).anchor;
      const payloadBefore = await captureSessionStorage(persistence, anchor);
      const before = await rowState(persistence, context.scopeId);
      const cause = new Error(`fail:${failureStep}`);
      const terminalization = terminalizationPersistence({
        afterTerminalizationEvent: (event) => {
          if (event.phase === "write" && event.step === failureStep) {
            throw cause;
          }
        },
      });

      const failure = await runFailure(
        terminalization.abortEffect({
          selector: selectorFromAnchor(anchor),
          executionClaim: executionClaimForAnchor(anchor),
          expectedSnapshotToken: anchor.snapshotToken,
        }),
      );
      expect(failure).toBeInstanceOf(
        PointMutationSessionAttemptTerminalizationPersistenceV1Error,
      );
      expect(failure).toMatchObject({
        operation: "attemptAbortTransaction",
        cause,
      });
      expect(await rowState(persistence, context.scopeId)).toEqual(before);
      expect(await captureSessionStorage(persistence, anchor)).toEqual(payloadBefore);
    }
  });
});
