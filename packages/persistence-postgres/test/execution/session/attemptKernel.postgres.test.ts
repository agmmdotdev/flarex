import { captureSessionStorage } from "./support/terminalStorageScenario";
import { eq } from "drizzle-orm";
import { Cause, Effect, Exit } from "effect";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { describe, expect, it, vi } from "vitest";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../../../src/database/postgres";
import {
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals,
} from "../../../src/database/schema";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../../src/scope/scopeAuthorityResolution";
import {
  PointMutationSessionAttemptLoadPersistenceV1Error,
} from "../../../src/execution/session/errors";
import {
  ExactRunningAttemptTransactionV1Error,
} from "../../../src/execution/session/errors";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  isLocatedExactRunningAttemptKernelV1,
} from "../../../src/execution/session/kernelContracts";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";
import { activatePointMutationSession } from "./support/attemptFixture";
import { pointMutationSessionActivationFixture } from "./support/activationEvidence";
import {
  provisionContext,
  createActivationPersistence,
  selectorFromAnchor,
  sharedLocator,
  uuidFactory,
} from "./support/postgresFixture";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O03-B session authority", () => {
  const withPostgresPersistence = useFileScopedPostgresPersistence();


  it.each(["defect", "interruption"] as const)(
    "exact-attempt admission retains a rejected Fail plus %s before body execution", async companion => {
      await withPostgresPersistence(async persistence => {
        const ids = uuidFactory();
        const context = await provisionContext(persistence, `admission_full_cause_${companion}`,
          sharedLocator(`admission-full-cause-${companion}`), ids);
        const activated = await activatePointMutationSession(createActivationPersistence(persistence, ids),
          pointMutationSessionActivationFixture(context.deploymentId, context.scopeId));
        if (activated.status !== "created") throw new Error("Expected a newly created exact attempt");
        const scopeUuid = (await runEffect(Effect.fromResult(projectScopeIdUuidV1Result(context.scopeId)))).scopeUuid;
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
        const defect = new TypeError("Stored native admission callback defect");
        const interruptor = 902;
        const cause = Cause.combine(Cause.fail(failure), companion === "defect" ? Cause.die(defect) : Cause.interrupt(interruptor));
        const lockSteps: string[] = [];
        const target = createPostgresLocatedPointMutationSessionActivationTargetV1(persistence, context.physicalLocator, {
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
        const transactionObserver = vi.spyOn(persistence.drizzle, "transaction");
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
      });
    },
  );
});
