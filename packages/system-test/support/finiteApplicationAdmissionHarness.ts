import { createApplicationMutationGrantVerificationKernelV1 } from "@flarex/executor/internal/application-mutation-grant-verification-kernel";
import { createPointMutationExecutionClaimVaultV1 } from "@flarex/executor/internal/point-mutation-execution-claim-v1";
import { createFinitePointMutationExecution } from "@flarex/executor/point-mutation-initial-execution";
import { createPointMutationJournalV1 } from "@flarex/executor/point-mutation-journal";
import { PointMutationJournalAttemptUnavailableV1Error } from "@flarex/executor/internal/point-mutation-journal-errors";
import { createApplicationPointMutationSessionActivationV1 } from "@flarex/executor/point-mutation-session";
import { deriveApplicationSyscallValidator } from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { createPointMutationAttemptReplacementPortV1 } from "@flarex/persistence-postgres/internal/point-commit-construction";
import { createApplicationMutationSessionActivationPersistenceV1, createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1 } from "@flarex/persistence-postgres/internal/session-construction";
import { createPointMutationExecutionClaimLivenessV1 } from "@flarex/persistence-postgres/transaction-execution-claim-liveness";
import { SessionJournalAttemptUnavailableV1Error } from "@flarex/persistence-postgres/internal/session-journal";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { Effect, Exit } from "effect";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from "flarex-backend/artifact-runtime";
import { makeApplicationPointMutationRunner } from "flarex-backend/internal/application-point-mutation-runner";
import { expect } from "vitest";
import { FINITE_INDEXED_QUERY_OPTIONS, inventory, makeFiniteIndexedQueriesHarness } from "../../persistence-postgres/test/execution/journal/finiteIndexedQueriesScenario";
import { revokeFiniteApplicationScope } from "../../persistence-postgres/test/execution/journal/finiteApplicationAdmissionScenario";
import { observeFiniteAdmissionCleanupFault, expectFiniteAdmissionCleanupReasons } from "../../persistence-postgres/test/execution/journal/finiteApplicationAdmissionCauseFault";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../../persistence-postgres/test/execution/session/support/activationEvidence";
import { MiniflareApplicationWorkerLoader } from "./applicationNativeQueryHarness";
import { makeApplicationMutationTestLive } from "./applicationNativeMutationHarness";

export const FINITE_APPLICATION_WORKER_ADMISSION_OPTIONS = {
  ...FINITE_INDEXED_QUERY_OPTIONS, runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY, includeAdmissionReadTwice: true,
};
type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;

/** Composition only. The genuine dispatcher owns the claim, heartbeat,
 * terminalization, result freeze and publication. The observer commits a real
 * revocation before delegating the original second capability exactly once. */
export const proveFiniteApplicationWorkerAdmission = Effect.fn("SystemTest.finiteApplicationAdmission")(
  function* (native: Fixture, revoke: boolean, faultMode: "none" | "cleanup" = "none") {
    const cleanupFault = faultMode === "cleanup" ? yield* Effect.acquireRelease(Effect.sync(observeFiniteAdmissionCleanupFault),
      observation => Effect.sync(() => observation.restore())) : undefined;
    let pointReads = 0;
    const loader = yield* Effect.acquireRelease(Effect.sync(() => new MiniflareApplicationWorkerLoader(async method => {
      if (method !== "readPointDocument") return;
      pointReads += 1;
      if (pointReads === 2 && revoke) {
        await Effect.runPromise(revokeFiniteApplicationScope(native));
        cleanupFault?.arm();
      }
    })), owner => Effect.promise(() => owner.dispose()));
    const live = yield* Effect.promise(() => makeApplicationMutationTestLive(native, loader));
    const harness = yield* makeFiniteIndexedQueriesHarness(native, "users:readTwice");
    const evidence = yield* harness.prepareEvidence({ body: harness.alphaId });
    const validator = yield* deriveApplicationSyscallValidator({ scopeId: native.authority.scopeId,
      schemaVersionId: harness.prepared.schema.schemaVersionId, schemaManifest: harness.prepared.schema.manifest });
    const executionClaims = createPointMutationExecutionClaimVaultV1();
    const originalPersistenceFailures: unknown[] = [];
    let successfulPointDeliveries = 0;
    const observedStore = { ...harness.store,
      runApplicationPointOperationEffect: (...args: Parameters<typeof harness.store.runApplicationPointOperationEffect>) =>
        harness.store.runApplicationPointOperationEffect(...args).pipe(Effect.onExit(exit => Effect.sync(() => {
          if (Exit.isSuccess(exit)) successfulPointDeliveries += 1;
          else for (const reason of exit.cause.reasons) if (reason._tag === "Fail") originalPersistenceFailures.push(reason.error);
        }))),
    };
    const journal = createPointMutationJournalV1(observedStore, executionClaims.admission, validator, [], "finiteRoot");
    let heartbeats = 0;
    let publications = 0;
    const liveness = createPointMutationExecutionClaimLivenessV1(native.sessionAuthority, {
      claimDurationMilliseconds: 600_000, leaseRenewalDurationMilliseconds: 600_000,
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      finiteApplication: { prepared: harness.preparedAdmission, context: harness.admissionContext },
    });
    const dispatcher = createFinitePointMutationExecution({ journal, executionClaims,
      activation: createApplicationPointMutationSessionActivationV1(createApplicationMutationSessionActivationPersistenceV1(native.sessionAuthority,
        { leaseDurationMilliseconds: 600_000 }), executionClaims.issuer, journal),
      contextFactory: live.executionContextFactory,
      runner: makeApplicationPointMutationRunner(live.applicationRunner),
      publisher: { publishFinite: command => Effect.sync(() => { publications += 1; }).pipe(Effect.andThen(harness.publisher.publishFinite(command))),
        resolveFinite: command => harness.publisher.resolveFinite(command) },
      replacement: createPointMutationAttemptReplacementPortV1(native.sessionAuthority, {
        leaseDurationMilliseconds: 600_000, executionClaimDurationMilliseconds: 600_000,
      }),
      terminalization: createPointMutationSessionAttemptTerminalizationPersistenceV1(native.sessionAuthority),
      liveness: { heartbeatIntervalMilliseconds: 200_000, persistence: { ...liveness,
        renewEffect: (...args: Parameters<typeof liveness.renewEffect>) =>
          Effect.sync(() => { heartbeats += 1; }).pipe(Effect.andThen(liveness.renewEffect(...args))) } },
      recovery: { acquisition: createPointMutationExecutionClaimAcquisitionV1(native.sessionAuthority, { durationMilliseconds: 600_000 }),
        applicationGrantKernel: createApplicationMutationGrantVerificationKernelV1({ deploymentId: evidence.deploymentId,
          keys: [evidence.verificationKey], grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 }) },
    });
    const before = yield* Effect.promise(() => inventory(native));
    const result = yield* Effect.exit(dispatcher.executePreparedFiniteAttempt({ deploymentId: evidence.deploymentId,
      scopeId: evidence.scopeId, preparedAdmission: harness.preparedAdmission, admissionContext: harness.admissionContext,
      evidence: evidence.evidence }));
    expect(loader.loads).toBe(1);
    expect(pointReads).toBe(2);
    expect(loader.documentIds).toEqual([harness.alphaId, harness.alphaId]);
    expect(heartbeats).toBe(0);
    const after = yield* Effect.promise(() => inventory(native));
    if (revoke) {
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Revoked known read returned a Worker value"));
      // Keep the complete trusted Cause; assertions never rebuild one failure
      // from a possible combined journal/host/cleanup failure.
      expect(result.cause.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "Fail",
        error: expect.objectContaining({ _tag: "PointMutationJournalAttemptUnavailableV1Error",
          issue: { reason: "authorizationRevocationEpochChanged" } }) })]));
      expect(result.cause.reasons.some(reason => reason._tag === "Fail" &&
        reason.error instanceof PointMutationJournalAttemptUnavailableV1Error && originalPersistenceFailures.includes(reason.error.cause))).toBe(true);
      expect(successfulPointDeliveries).toBe(1);
      if (cleanupFault !== undefined) {
        expectFiniteAdmissionCleanupReasons(result.cause, cleanupFault);
        expect(originalPersistenceFailures).toHaveLength(1);
        expect(originalPersistenceFailures.some(failure => failure instanceof SessionJournalAttemptUnavailableV1Error &&
          cleanupFault.captureCauses.some(captureCause => captureCause.reasons.some(reason =>
            reason._tag === "Fail" && failure.cause === reason.error)))).toBe(true);
      }
      expect(publications).toBe(0);
      expect({ ...after, clock: [] }).toEqual({ ...before, clock: [] });
    } else {
      expect(result).toMatchObject({ _tag: "Success", value: { kind: "published" } });
      expect(publications).toBe(1);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    }
    return { result, pointReads, heartbeats, publications, successfulPointDeliveries };
  },
);
