import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import { createTestPGlite } from "../../support/pgliteSearchExtensions";
import { captureSessionStorage } from "./support/terminalStorageScenario";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { decodeReplacementScopeIdV1, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
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
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
} from "../../../src/database/schema";
import {
  PointMutationSessionAttemptLoadPersistenceV1Error,
} from "../../../src/execution/session/errors";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import {
  ExactRunningAttemptTransactionV1Error,
} from "../../../src/execution/session/errors";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  isLocatedExactRunningAttemptKernelV1,
} from "../../../src/execution/session/kernelContracts";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
} from "../../../src/execution/session/kernelContracts";
import { activatePointMutationSession } from "./support/attemptFixture";
import { pointMutationSessionActivationFixture } from "./support/activationEvidence";
import { setFlarexActivationClock } from "./support/authorityClock";
import { runEffect, runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import {
  type AttemptLoadContext,
  sharedLocator,
  selectorFromAnchor,
  resolutionPorts,
  deferredSignal,
} from "./support/attemptLoadFixture";

type ExportedAttemptKernelReadSyscallFacet = Extract<
  keyof typeof import("../../../src/execution/session/kernelTestApi"),
  "RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1"
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
      "attemptTailLocked",
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


  it.each(["defect", "interruption"] as const)(
    "exact-attempt admission retains a rejected Fail plus %s before body execution", async companion => {
      const context = await provisionContext(`admission_full_cause_${companion}`);
      const activated = await activate(context);
      if (activated.status !== "created") throw new Error("Expected a newly created exact attempt");
      const scopeUuid = projectScopeIdUuidV1(context.scopeId).scopeUuid;
      const persistentState = async () => ({
        session: await captureSessionStorage(persistence, activated.anchor),
        clock: await persistence.drizzle.select().from(fxSystemScopeClocks)
          .where(eq(fxSystemScopeClocks.scopeId, context.scopeId)),
        authority: await persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, context.scopeId)),
        leases: await persistence.drizzle.select().from(fxSystemSnapshotLeases)
          .where(eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid)),
        claims: await persistence.drizzle.select().from(fxSystemTransactionExecutionClaims)
          .where(eq(fxSystemTransactionExecutionClaims.scopeUuid, scopeUuid)),
        journals: await persistence.drizzle.select().from(fxSystemTransactionJournals)
          .where(eq(fxSystemTransactionJournals.scopeUuid, scopeUuid)),
      });
      const before = await persistentState();
      const failure = new PointMutationSessionAttemptLoadPersistenceV1Error({
        operation: "attemptLoadTransaction", cause: new Error("Rejected exact-attempt lock callback"),
      });
      const defect = new TypeError("Stored admission callback defect");
      const interruptor = 901;
      const cause = Cause.combine(Cause.fail(failure), companion === "defect" ? Cause.die(defect) : Cause.interrupt(interruptor));
      const lockSteps: string[] = [];
      const target = createPGliteLocatedPointMutationSessionActivationTargetV1(persistence, sharedLocator, {
        afterLoadLock: async step => {
          lockSteps.push(step);
          if (step === "attemptTailLocked") throw cause;
        },
      });
      const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(context.deploymentId, {
        scopeMetadata: persistence,
        provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared exact-attempt admission must not read receipts");
        } },
        scopeClockTargets: { resolve: async () => target },
      }));
      if (!isLocatedExactRunningAttemptKernelV1(located.target)) throw new Error("Missing genuine exact-attempt kernel");
      const exactTarget = located.target;
      let bodyCalls = 0;
      const transactionObserver = vi.spyOn(driver, "transaction");
      const exit = await (async () => {
        try {
          const outcome = await Effect.runPromiseExit(exactTarget[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1]({
            selector: selectorFromAnchor(activated.anchor), executionClaim: activated.executionClaim,
            preliminaryAuthority: located.authority,
          }, () => Effect.sync(() => { bodyCalls += 1; })));
          expect(transactionObserver).toHaveBeenCalledTimes(1);
          const settlement = transactionObserver.mock.results[0];
          if (settlement === undefined || settlement.type !== "return") throw new Error("Missing actual transaction settlement");
          await expect(settlement.value).rejects.toThrow("Effect exact-attempt work failed; roll back the transaction.");
          return outcome;
        } finally { transactionObserver.mockRestore(); }
      })();
      expect(bodyCalls).toBe(0);
      expect(lockSteps).toEqual(["clockLocked", "sessionLocked", "leaseLocked", "attemptTailLocked"]);
      if (Exit.isSuccess(exit)) throw new Error("Expected admission to preserve its full rejection Cause");
      expect(exit.cause.reasons).toHaveLength(2);
      const failures = exit.cause.reasons.filter(Cause.isFailReason);
      expect(failures).toHaveLength(1);
      const mapped = failures[0]?.error;
      expect(mapped).toBeInstanceOf(ExactRunningAttemptTransactionV1Error);
      if (!(mapped instanceof ExactRunningAttemptTransactionV1Error)) throw new Error("Missing exact-attempt Fail translation");
      expect(mapped.cause).toBe(failure);
      expect(mapped.callbackCause).toBeUndefined();
      const defects = exit.cause.reasons.filter(Cause.isDieReason);
      expect(defects).toHaveLength(companion === "defect" ? 1 : 0);
      for (const reason of defects) expect(reason.defect).toBe(defect);
      expect(exit.cause.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId))
        .toEqual(companion === "interruption" ? [interruptor] : []);
      expect(await persistentState()).toEqual(before);
    },
  );


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
});
