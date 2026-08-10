import { eq } from "drizzle-orm";
import {
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { Effect, Exit, Fiber } from "effect";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";

import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
} from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../src/schema";
import {
  PointMutationSessionAttemptLoadV1Error,
  PointMutationSessionAttemptLoadPersistenceV1Error,
  PointMutationSessionAttemptTerminalizationPersistenceV1Error,
  PointMutationSessionAttemptTerminalizationV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
} from "../src/transactionSessionActivation";
import {
  ExactRunningAttemptTransactionV1Error,
} from "../src/transactionSessionAttemptKernel";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
} from "../src/transactionSessionReadSyscallKernel";
import {
  abortPointMutationSessionAttempt,
  activatePointMutationSession,
  executionClaimForAnchor,
  expirePointMutationSessionAttempt,
  loadPointMutationSessionAttempt,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "./effectTestRuntime";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "attempt-load-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

type RootAttemptLoadExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionAttemptLoadPersistenceV1"
>;

type RootAttemptTerminalizationExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionAttemptTerminalizationPersistenceV1"
>;

type ExportedAttemptKernelReadSyscallFacet = Extract<
  keyof typeof import("../src/transactionSessionAttemptKernel"),
  "RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1"
>;

interface AttemptLoadContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>;
}

interface AttemptRowState extends Record<string, unknown> {
  readonly lifecycle: string;
  readonly attempt_fence: string;
  readonly session_updated_at: string;
  readonly lease_attempt_fence: string | null;
  readonly snapshot_epoch_uuid: string | null;
  readonly snapshot_commit_seq: string | null;
  readonly lease_expires_at: string | null;
}

describe("O03-B exact point-mutation attempt authority", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
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
      anchor: activated.anchor,
      executionPin: { schemaVersionId: "schema_activation_v1" },
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
      "journalRootLocked",
      "executionClaimLocked",
      "clockLocked",
      "sessionLocked",
      "leaseLocked",
      "journalRootLocked",
      "executionClaimLocked",
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

  it("admits a private exact-attempt read syscall and rolls back callback failure", async () => {
    expectTypeOf<ExportedAttemptKernelReadSyscallFacet>().toEqualTypeOf<never>();
    const context = await provisionContext("read_syscall_admission");
    const activated = await activate(context);
    if (activated.status !== "created") {
      throw new Error("Expected a newly created read-syscall attempt.");
    }
    const lockSteps: string[] = [];
    const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
      persistence,
      sharedLocator,
      {
        afterLoadLock: (step) => {
          lockSteps.push(step);
        },
      },
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
    expect(
      isLocatedExactRunningAttemptReadSyscallKernelV1(located.target),
    ).toBe(true);
    if (!isLocatedExactRunningAttemptReadSyscallKernelV1(located.target)) {
      throw new Error("Expected the private read-syscall admission facet.");
    }
    const input = {
      selector: selectorFromAnchor(activated.anchor),
      executionClaim: activated.executionClaim,
      preliminaryAuthority: located.authority,
    };
    await expect(runEffect(located.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
    ](input, (_tx, exact) => Effect.succeed({
      sessionId: exact.anchor.sessionId,
      attemptFence: exact.anchor.attemptFence,
    })))).resolves.toEqual({
      sessionId: activated.anchor.sessionId,
      attemptFence: activated.anchor.attemptFence,
    });
    expect(lockSteps).toEqual([
      "clockLocked",
      "sessionLocked",
      "leaseLocked",
      "journalRootLocked",
      "executionClaimLocked",
    ]);

    const callbackFailure = new Error("read syscall callback rejected");
    await expect(runFailure(located.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
    ](input, (tx) => Effect.gen(function*() {
      yield* Effect.promise(() => tx
        .update(fxSystemTransactionJournals)
        .set({ readDocuments: 1 })
        .where(eq(
          fxSystemTransactionJournals.sessionId,
          activated.anchor.sessionId,
        )));
      return yield* Effect.fail(callbackFailure);
    })))).resolves.toBe(callbackFailure);
    const root = await persistence.query<{ read_documents: number }>(
      `select read_documents from fx_system_tx_journal where session_id = $1`,
      [activated.anchor.sessionId],
    );
    expect(root.rows).toEqual([{ read_documents: 0 }]);
  });

  it("defers read-syscall interruption until its bounded transaction settles", async () => {
    const context = await provisionContext("read_syscall_interruption");
    const activated = await activate(context);
    if (activated.status !== "created") {
      throw new Error("Expected a newly created interruption attempt.");
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
    const entered = deferredSignal();
    const release = deferredSignal();
    const fiber = Effect.runFork(located.target[
      RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
    ]({
      selector: selectorFromAnchor(activated.anchor),
      executionClaim: activated.executionClaim,
      preliminaryAuthority: located.authority,
    }, () => Effect.promise(async () => {
      entered.resolve();
      await release.promise;
    })));
    await entered.promise;
    let interruptionSettled = false;
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
            `update fx_system_scope_clock
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
            `update fx_system_scope_clock
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
            `update fx_system_scope_clock
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
        insert into fx_system_tx_journal_latest_receipt (
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
          1,
          decode('00', 'hex'),
          decode(repeat('00', 32), 'hex'),
          'missing',
          1,
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
          if (step === "journalRootLocked") throw transactionCause;
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
      issue: { reason: "selectorScopeMismatch" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    await expect(loadPointMutationSessionAttempt(loader, {
      ...selector,
      deploymentId: other.deploymentId,
    })).rejects.toMatchObject({
      issue: { reason: "selectorScopeMismatch" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
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
      `update fx_system_tx_session set lifecycle = 'aborted' where session_id = $1`,
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
        update fx_system_scope_clock
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
        update fx_system_scope_clock
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

  it("atomically aborts an exact attempt and observes its first terminal state", async () => {
    expectTypeOf<RootAttemptTerminalizationExport>().toEqualTypeOf<never>();
    const context = await provisionContext("terminal_abort");
    const anchor = (await activate(context)).anchor;
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
      `update fx_system_tx_session set lifecycle = 'committed' where session_id = $1`,
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
      `update fx_system_tx_session set lifecycle = 'aborted' where session_id = $1`,
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
      `update fx_system_scope_clock
       set authorization_revocation_epoch = authorization_revocation_epoch + 1
       where scope_id = $1`,
      [drift.scopeId],
    );
    await expect(expirePointMutationSessionAttempt(
      terminalization,
      selectorFromAnchor(driftAnchor),
    ))
      .rejects.toMatchObject({
        issue: { reason: "authorizationRevocationEpochChanged" },
      } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect((await rowState(persistence, drift.scopeId)).lease_attempt_fence)
      .toBe("1");

    const generationDrift = await provisionContext(
      "terminal_generation_fence_drift",
    );
    const generationDriftAnchor = (await activate(generationDrift)).anchor;
    await persistence.query(
      `update fx_system_scope_clock
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
    }
  });
});

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

function resolutionPorts(
  persistence: PGliteFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  afterResolve: () => void = () => undefined,
): PointMutationSessionActivationResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared attempt load must not read provisioning receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> => {
        afterResolve();
        return createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        );
      },
    },
  };
}

async function rowState(
  persistence: PGliteFlarexPersistence,
  scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>,
): Promise<AttemptRowState> {
  const result = await persistence.query<AttemptRowState>(
    `
      select s.lifecycle,
             s.attempt_fence::text as attempt_fence,
             s.updated_at::text as session_updated_at,
             l.attempt_fence::text as lease_attempt_fence,
             l.snapshot_epoch_uuid::text as snapshot_epoch_uuid,
             l.snapshot_commit_seq::text as snapshot_commit_seq,
             l.lease_expires_at::text as lease_expires_at
      from fx_system_tx_session s
      left join fx_system_snapshot_lease l
        on l.scope_uuid = s.scope_uuid
       and l.session_id = s.session_id
      join fx_system_scope_clock c
        on c.scope_uuid = s.scope_uuid
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Missing attempt row for ${scopeId}.`);
  return row;
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
