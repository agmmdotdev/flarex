import { createTestPGlite } from "../../support/pgliteSearchExtensions";
import { eq, sql } from "drizzle-orm";
import { fxSystemTransactionSessions, fxSystemScopeExecutionAuthorities, fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../../src/database/schema";
import { finiteApplicationMetadataScenario } from "../../application/finiteApplicationMetadataScenario";
import { createMigratedPGlitePersistence, migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import type { PGlite } from "@electric-sql/pglite";
import { ScopeEpochSchema, decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { Cause, Effect, Exit, Fiber } from "effect";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../../src/database/pglite";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../../src/scope/scopeAuthorityResolution";
import {
  PointMutationSessionAttemptLoadV1Error,
  PointMutationSessionAttemptLoadPersistenceV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
} from "../../../src/execution/session/errors";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import {
  createPointMutationSessionAttemptLoadPersistenceV1,
} from "../../../src/execution/session/attemptLoad";
import {
  ExactRunningAttemptTransactionV1Error,
} from "../../../src/execution/session/errors";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
} from "../../../src/execution/session/kernelContracts";
import { activatePointMutationSession, loadPointMutationSessionAttempt } from "./support/attemptFixture";
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

type RootAttemptLoadExport = Extract<
  keyof typeof import("../../../src"),
  "createPointMutationSessionAttemptLoadPersistenceV1"
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


  it("reports an out-of-JS-range running finite date as typed corruption during exact reload without writes", async () => {
    const persistence = await createMigratedPGlitePersistence(undefined, "finiteCapture");
    await finiteApplicationMetadataScenario(persistence, { afterMetadata: async entry => {
      const anchor = entry.context.anchor;
      expect(anchor.executionProfile).toBe("finiteRoot");
      const loader = createPointMutationSessionAttemptLoadPersistenceV1(entry.sessionAuthority);
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
    } });
  }, 120_000);

  it("keeps exact reload private, read-only, freshly resolved, and lock ordered", async () => {
    expectTypeOf<RootAttemptLoadExport>().toEqualTypeOf<never>();
    const context = await provisionContext("read_only");
    const activated = await activate(context);
    const selector = selectorFromAnchor(activated.anchor);
    const before = await rowState(persistence, context.scopeId);
    const lockSteps: string[] = [];
    let targetResolutions = 0;
    const ports = resolutionPorts(persistence, {
      afterLoadLock: (step) => {
        lockSteps.push(step);
      },
    }, () => {
      targetResolutions += 1;
    });
    const firstLoader = createPointMutationSessionAttemptLoadPersistenceV1(
      ports,
    );
    expect(targetResolutions).toBe(0);

    const first = await loadPointMutationSessionAttempt(firstLoader, selector);
    const afterFirst = await rowState(persistence, context.scopeId);
    const restartedLoader = createPointMutationSessionAttemptLoadPersistenceV1(
      ports,
    );
    const second = await loadPointMutationSessionAttempt(
      restartedLoader,
      Object.freeze({ ...selector }),
    );

    expect(first).toEqual({
      status: "loaded",
      lastMetadataSequence: 0n,
      anchor: activated.anchor,
      executionPin: { schemaVersionId: "schema_activation_v1", functionPath: "messages:create",
        functionKind: "mutation", executionModule: "flarex/_generated/execution.mjs" },
      attemptFacet: { kind: "pristineOpen" },
    });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.anchor)).toBe(true);
    expect(Object.isFrozen(first.anchor.snapshotToken)).toBe(true);
    expect(afterFirst).toEqual(before);
    expect(await rowState(persistence, context.scopeId)).toEqual(before);
    expect(targetResolutions).toBe(2);
    expect(lockSteps).toEqual([
      "clockLocked",
      "sessionLocked",
      "leaseLocked",
      "attemptTailLocked",
      "clockLocked",
      "sessionLocked",
      "leaseLocked",
      "attemptTailLocked",
    ]);

    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 7 where scope_id = $1`,
      [context.scopeId],
    );
    const afterCommitAdvance = await loadPointMutationSessionAttempt(
      restartedLoader,
      selector,
    );
    expect(afterCommitAdvance.anchor.snapshotToken.commitSeq).toBe(0n);
  });


  it("transports only checked session scalars and observes pristine children only on exact reload", async () => {
    const context = await provisionContext("checked_projection");
    const activated = await activate(context);
    if (activated.status !== "created") {
      throw new Error("Expected a newly created checked-projection attempt.");
    }
    const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
      persistence,
      sharedLocator,
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
    const queryFields: string[][] = [];
    const queryTexts: string[] = [];
    const runTransaction = driver.transaction.bind(driver);
    const observeTransaction: typeof driver.transaction = (work) =>
      runTransaction(async (tx) => {
        const queryObserver = vi.spyOn(tx, "query");
        try {
          return await work(tx);
        } finally {
          queryTexts.push(...queryObserver.mock.calls.map(([query]) => query));
          const results = await Promise.all(queryObserver.mock.results
            .filter((result) => result.type === "return")
            .map((result) => result.value));
          queryFields.push(...results.map((result) =>
            result.fields.map((field) => field.name)));
          queryObserver.mockRestore();
        }
      });
    const transactionObserver = vi.spyOn(driver, "transaction")
      .mockImplementation(observeTransaction);
    try {
      await runEffect(located.target[
        RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
      ]({
        selector: selectorFromAnchor(activated.anchor),
        executionClaim: activated.executionClaim,
        preliminaryAuthority: located.authority,
      }, (_tx, checked) => {
        expect(checked).not.toHaveProperty("attemptFacet");
        expect(checked.executionAuthorityGeneration).toBe("legacy_dynamic_worker_v1");
        return Effect.succeed(undefined);
      }));
      const checkedFields = queryFields.splice(0);
      expect(checkedFields).toHaveLength(6);
      const tailQueries = queryTexts.splice(0).filter(query => query.includes("fx_lock_running_attempt_tail"));
      expect(tailQueries).toHaveLength(1);
      expect(tailQueries[0]).toMatch(/from fx_lock_running_attempt_tail\(/i);
      expect(checkedFields.find((fields) => fields.includes("protocol_version")))
        .toEqual([
          "execution_profile",
          "execution_authority_generation",
          "function_path", "function_kind", "execution_module",
          "session_id", "attempt_fence", "storage_generation",
          "storage_generation_fence", "authorization_revocation_epoch",
          "authorization_grant_expires_at", "hard_expires_at", "created_at",
          "updated_at", "protocol_version", "lifecycle", "schema_version_id",
          "identity_access_policy_sha256", "request_key",
        ]);
      expect(checkedFields.some((fields) =>
        fields.length === 5 && fields.every((field) => field === "exists")))
        .toBe(false);

      const loaded = await loadPointMutationSessionAttempt(
        createPointMutationSessionAttemptLoadPersistenceV1(
          resolutionPorts(persistence),
        ),
        selectorFromAnchor(activated.anchor),
      );
      expect(loaded.attemptFacet).toEqual({ kind: "pristineOpen" });
      const reloadFields = queryFields.splice(0);
      expect(reloadFields.filter((fields) =>
        fields.length === 5 && fields.every((field) => field === "exists")))
        .toHaveLength(1);
      expect(reloadFields.filter((fields) =>
        fields.includes("protocol_version")))
        .toEqual([checkedFields.find((fields) => fields.includes("protocol_version"))]);
    } finally {
      transactionObserver.mockRestore();
    }
  });


  it("rejects stale epoch, generation fence, and revocation on read admission", async () => {
    const cases = [
      {
        label: "epoch",
        reason: "scopeEpochChanged",
        mutate: async (scopeId: AttemptLoadContext["scopeId"]) => {
          const epoch = ScopeEpochSchema.make(
            "epoch_72000000-0000-4000-8000-999999999991",
          );
          await persistence.query(
            `update fx_system_scope_execution_authority
             set epoch = $2
             where scope_id = $1`,
            [scopeId, epoch],
          );
        },
      },
      {
        label: "generation",
        reason: "storageGenerationFenceChanged",
        mutate: async (scopeId: AttemptLoadContext["scopeId"]) => {
          await persistence.query(
            `update fx_system_scope_execution_authority
             set storage_generation_fence = storage_generation_fence + 1
             where scope_id = $1`,
            [scopeId],
          );
        },
      },
      {
        label: "revocation",
        reason: "authorizationRevocationEpochChanged",
        mutate: async (scopeId: AttemptLoadContext["scopeId"]) => {
          await persistence.query(
            `update fx_system_scope_execution_authority
             set authorization_revocation_epoch =
               authorization_revocation_epoch + 1
             where scope_id = $1`,
            [scopeId],
          );
        },
      },
    ] as const;

    for (const current of cases) {
      const context = await provisionContext(`read_syscall_${current.label}`);
      const activated = await activate(context);
      if (activated.status !== "created") {
        throw new Error("Expected a newly created stale-authority attempt.");
      }
      const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
        persistence,
        sharedLocator,
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
        throw new Error("Expected the private read-syscall admission facet.");
      }
      await current.mutate(context.scopeId);
      const failure = await runFailure(located.target[
        RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
      ]({
        selector: selectorFromAnchor(activated.anchor),
        executionClaim: activated.executionClaim,
        preliminaryAuthority: located.authority,
      }, () => Effect.void));
      expect(failure).toBeInstanceOf(ExactRunningAttemptTransactionV1Error);
      expect(failure).toMatchObject({
        cause: { issue: { reason: current.reason } },
        callbackCause: undefined,
      });
    }
  });


  it("classifies an exact open root with hidden child evidence as non-pristine", async () => {
    const context = await provisionContext("hidden_child");
    const activated = await activate(context);
    await persistence.query(
      `
        insert into fx_system_tx_journal_receipt (
          scope_uuid,
          session_id,
          attempt_fence,
          last_syscall_sequence,
          operation_kind,
          request_codec_version,
          request_bytes,
          request_sha256,
          outcome_kind,
          outcome_codec_version,
          outcome_bytes,
          outcome_sha256,
          created_at,
          updated_at
        )
        select
          session.scope_uuid,
          session.session_id,
          session.attempt_fence,
          1,
          'get',
          2,
          decode('00', 'hex'),
          decode(repeat('00', 32), 'hex'),
          'missing',
          2,
          decode('00', 'hex'),
          decode(repeat('00', 32), 'hex'),
          session.created_at,
          session.updated_at
        from fx_system_tx_session session
        where session.session_id = $1
      `,
      [activated.anchor.sessionId],
    );
    const loaded = await loadPointMutationSessionAttempt(
      createPointMutationSessionAttemptLoadPersistenceV1(
        resolutionPorts(persistence),
      ),
      selectorFromAnchor(activated.anchor),
    );
    expect(loaded.attemptFacet).toEqual({ kind: "nonPristine" });
  });


  it("maps authority and transaction rejection into the typed Effect channel", async () => {
    const context = await provisionContext("typed_failures");
    const anchor = (await activate(context)).anchor;
    const selector = selectorFromAnchor(anchor);
    const cause = new Error("attempt load metadata unavailable");
    const basePorts = resolutionPorts(persistence);
    const authorityFailure = createPointMutationSessionAttemptLoadPersistenceV1({
      ...basePorts,
      scopeMetadata: {
        getScopeMetadata: async () => {
          throw cause;
        },
        getScopeMetadataByDeploymentId: async () => {
          throw cause;
        },
      },
    });

    const metadataFailure = await runFailure(
      authorityFailure.loadEffect(selector),
    );
    expect(metadataFailure).toBeInstanceOf(
      PointMutationSessionAttemptLoadPersistenceV1Error,
    );
    expect(metadataFailure).toMatchObject({
      _tag: "PointMutationSessionAttemptLoadPersistenceV1Error",
      operation: "scopeMetadataRead",
      cause,
    });

    const transactionCause = new Error("attempt load transaction unavailable");
    const transactionFailure = createPointMutationSessionAttemptLoadPersistenceV1(
      resolutionPorts(persistence, {
        afterLoadLock: (step) => {
          if (step === "attemptTailLocked") throw transactionCause;
        },
      }),
    );
    const failure = await runFailure(transactionFailure.loadEffect(selector));
    expect(failure).toBeInstanceOf(
      PointMutationSessionAttemptLoadPersistenceV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PointMutationSessionAttemptLoadPersistenceV1Error",
      operation: "attemptLoadTransaction",
      cause: transactionCause,
    });
  });


  it("does not observe interruption until the load transaction settles", async () => {
    const context = await provisionContext("transaction_interruption");
    const anchor = (await activate(context)).anchor;
    const before = await rowState(persistence, context.scopeId);
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const loader = createPointMutationSessionAttemptLoadPersistenceV1(
      resolutionPorts(persistence, {
        afterLoadLock: async (step) => {
          if (step !== "sessionLocked") return;
          entered.resolve();
          await release.promise;
        },
      }),
    );

    const fiber = Effect.runFork(loader.loadEffect(selectorFromAnchor(anchor)));
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
    expect(await rowState(persistence, context.scopeId)).toEqual(before);
  });


  it("rejects selector identity, lifecycle, expiry, and authority failures", async () => {
    const primary = await provisionContext("failures_primary");
    const other = await provisionContext("failures_other");
    const activated = await activate(primary);
    const selector = selectorFromAnchor(activated.anchor);
    const loader = createPointMutationSessionAttemptLoadPersistenceV1(
      resolutionPorts(persistence),
    );

    await expect(loadPointMutationSessionAttempt(loader, {
      ...selector,
      scopeId: other.scopeId,
    })).rejects.toMatchObject({
      failure: { reason: "scopeDeploymentMismatch", scopeId: other.scopeId },
    });
    await expect(loadPointMutationSessionAttempt(loader, {
      ...selector,
      deploymentId: other.deploymentId,
    })).rejects.toMatchObject({
      failure: { reason: "scopeDeploymentMismatch", scopeId: primary.scopeId },
    });
    await expect(loadPointMutationSessionAttempt(loader, {
      ...selector,
      sessionId: TransactionSessionIdV1Schema.make(
        "72000000-0000-4000-8000-999999999999",
      ),
    })).rejects.toMatchObject({
      issue: { reason: "sessionMissing" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    await expect(loadPointMutationSessionAttempt(loader, {
      ...selector,
      attemptFence: TransactionAttemptFenceSchema.make(2n),
    })).rejects.toMatchObject({
      issue: { reason: "staleAttemptFence" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const terminal = await provisionContext("terminal");
    const terminalAnchor = (await activate(terminal)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [terminalAnchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'aborted', validated_args_json = null, validated_args_canonical_bytes = null, authorization_grant_json = null, authorization_grant_canonical_bytes = null, application_execution_authority_json = null, application_execution_authority_canonical_bytes = null where session_id = $1`,
      [terminalAnchor.sessionId],
    );
    await expect(loadPointMutationSessionAttempt(
      loader,
      selectorFromAnchor(terminalAnchor),
    ))
      .rejects.toMatchObject({
        issue: { reason: "attemptNotRunning", lifecycle: "aborted" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const missingLease = await provisionContext("missing_lease");
    const missingLeaseAnchor = (await activate(missingLease)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [missingLeaseAnchor.sessionId],
    );
    await expect(loadPointMutationSessionAttempt(
      loader,
      selectorFromAnchor(missingLeaseAnchor),
    ))
      .rejects.toMatchObject({
        issue: "snapshotLeaseMissing",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const expired = await provisionContext("expired");
    const expiredAnchor = (await activate(expired)).anchor;
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where session_id = $1
      `,
      [expiredAnchor.sessionId],
    );
    await expect(loadPointMutationSessionAttempt(
      loader,
      selectorFromAnchor(expiredAnchor),
    ))
      .rejects.toMatchObject({
        issue: { reason: "activeAttemptExpired" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const fenceDrift = await provisionContext("fence_drift");
    const fenceDriftAnchor = (await activate(fenceDrift)).anchor;
    await persistence.query(
      `
        update fx_system_scope_execution_authority
        set storage_generation_fence = 2
        where scope_id = $1
      `,
      [fenceDrift.scopeId],
    );
    await expect(loadPointMutationSessionAttempt(
      loader,
      selectorFromAnchor(fenceDriftAnchor),
    ))
      .rejects.toMatchObject({
        issue: { reason: "storageGenerationFenceChanged" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const revocationDrift = await provisionContext("revocation_drift");
    const revocationAnchor = (await activate(revocationDrift)).anchor;
    await persistence.query(
      `
        update fx_system_scope_execution_authority
        set authorization_revocation_epoch = 1
        where scope_id = $1
      `,
      [revocationDrift.scopeId],
    );
    await expect(loadPointMutationSessionAttempt(
      loader,
      selectorFromAnchor(revocationAnchor),
    ))
      .rejects.toMatchObject({
        issue: { reason: "authorizationRevocationEpochChanged" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const snapshotAhead = await provisionContext("snapshot_ahead");
    const snapshotAheadAnchor = (await activate(snapshotAhead)).anchor;
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set snapshot_commit_seq = 1
        where session_id = $1
      `,
      [snapshotAheadAnchor.sessionId],
    );
    await expect(loadPointMutationSessionAttempt(
      loader,
      selectorFromAnchor(snapshotAheadAnchor),
    ))
      .rejects.toMatchObject({
        issue: "snapshotAheadOfScopeClock",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);
  });
});
