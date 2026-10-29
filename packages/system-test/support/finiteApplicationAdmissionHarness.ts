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
import { and, eq } from "drizzle-orm";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from "flarex-backend/artifact-runtime";
import { makeApplicationPointMutationRunner } from "flarex-backend/internal/application-point-mutation-runner";
import { expect } from "vitest";
import { FINITE_INDEXED_QUERY_OPTIONS, inventory, makeFiniteIndexedQueriesHarness } from "../../persistence-postgres/test/execution/journal/finiteIndexedQueriesScenario";
import { revokeFiniteApplicationScope } from "../../persistence-postgres/test/execution/journal/finiteApplicationAdmissionScenario";
import { observeFiniteAdmissionCleanupFault, expectFiniteAdmissionCleanupReasons } from "../../persistence-postgres/test/execution/journal/finiteApplicationAdmissionCauseFault";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../../persistence-postgres/test/execution/session/support/activationEvidence";
import { MiniflareApplicationWorkerLoader } from "./applicationNativeQueryHarness";
import { makeApplicationMutationTestLive } from "./applicationNativeMutationHarness";
import { finiteMetadataContractKey } from "../../persistence-postgres/src/execution/finiteMetadataDependencies";
import { readFrozenFiniteAttempt } from "../../persistence-postgres/src/testing/sessionJournalInspection";
import { fxSystemMetadataContractObservations, fxSystemScopeExecutionAuthorities } from "../../persistence-postgres/src/database/schema";
import { PointCommitConflictV1Error, PointCommitCorruptionV1Error } from "../../persistence-postgres/src/commit/point/errors";

export const FINITE_APPLICATION_WORKER_ADMISSION_OPTIONS = {
  ...FINITE_INDEXED_QUERY_OPTIONS, runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY, includeAdmissionReadTwice: true,
};
type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
export type FiniteApplicationCatalogChange = "args" | "returns" | "partition" | "visibilityExpansion" | "membershipOrdinal" | "aba" | "unrelatedSchema" | "unrelatedSchemaReadOnly";

/** Composition only. The genuine dispatcher owns the claim, heartbeat,
 * terminalization, result freeze and publication. The observer commits a real
 * revocation before delegating the original second capability exactly once. */
export const proveFiniteApplicationWorkerAdmission = Effect.fn("SystemTest.finiteApplicationAdmission")(
  function* (native: Fixture, revoke: boolean, faultMode: "none" | "cleanup" = "none", catalogChange?: FiniteApplicationCatalogChange) {
    const schemaOnlyChange = catalogChange === "unrelatedSchema" || catalogChange === "unrelatedSchemaReadOnly";
    // Prepare the control's initial catalog through the same canonical writers.
    // Adding the genuine createInternal export later shifts readTwice's implicit
    // ordinal without changing its function contract or source artifact.
    if (catalogChange === "membershipOrdinal" || catalogChange === "partition") {
      const active = yield* native.activation.readActive();
      yield* Effect.promise(() => native.moveHead({ expectedActiveHead: active.expectedActiveHead,
        manifest: { ...active.basis.manifest,
          ...(catalogChange === "membershipOrdinal" ? {
            functions: active.basis.manifest.functions.filter(fn => fn.path !== "users:createInternal"),
          } : { schema: { ...active.basis.manifest.schema, tables: active.basis.manifest.schema.tables.map(table =>
            table.name === "users" ? { ...table, placement: { kind: "partitionBy" as const, field: "_id" } } : table) } }),
        } }));
    }
    const originalActive = catalogChange === undefined ? undefined : yield* native.activation.readActive();
    const executionGroup = { namespace: "execution", ownerKey: "application",
      contractKey: finiteMetadataContractKey("executionGroup", "legacy_dynamic_worker_v1") } as const;
    const observation = () => native.target.drizzle.select().from(fxSystemMetadataContractObservations).where(and(
      eq(fxSystemMetadataContractObservations.scopeId, native.authority.scopeId),
      eq(fxSystemMetadataContractObservations.namespace, executionGroup.namespace),
      eq(fxSystemMetadataContractObservations.ownerKey, executionGroup.ownerKey),
      eq(fxSystemMetadataContractObservations.contractKey, executionGroup.contractKey)));
    const revocation = () => native.target.drizzle.select({ epoch: fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch })
      .from(fxSystemScopeExecutionAuthorities).where(eq(fxSystemScopeExecutionAuthorities.scopeId, native.authority.scopeId));
    const originalGroup = catalogChange === undefined ? undefined : (yield* Effect.promise(observation))[0];
    const originalRevocation = catalogChange === undefined ? undefined : yield* Effect.promise(revocation);
    let catalogProjection: Readonly<{ intermediate: NonNullable<typeof originalGroup>; current: NonNullable<typeof originalGroup> }> | undefined;
    const changeCatalog = Effect.fn("SystemTest.activateSameSourceCatalog")(function* () {
      if (catalogChange === undefined || originalActive === undefined || originalGroup === undefined) return;
      const manifest = originalActive.basis.manifest;
      const child = manifest.functions.find(fn => fn.path === "users:createInternal");
      const root = manifest.functions.find(fn => fn.path === "users:readTwice");
      if (root === undefined || child === undefined && catalogChange !== "membershipOrdinal")
        return yield* Effect.die(new Error("Missing authentic Worker catalog members"));
      const changed = { ...manifest,
        ...(schemaOnlyChange ? { schema: { ...manifest.schema,
          tables: [...manifest.schema.tables, { tableId: 2, name: "zzUnrelatedCatalogControl",
            validator: { type: "object" as const, value: {} }, placement: { kind: "global" as const } }] } } : {
          functions: catalogChange === "membershipOrdinal" ? [...manifest.functions, {
            path: "users:createInternal", moduleName: "users", exportName: "createInternal", kind: "mutation" as const,
            visibility: "internal" as const, args: { type: "any" as const }, returns: null, partition: null,
          }].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) : manifest.functions.map(fn =>
            fn !== child ? fn : { ...fn,
              ...(catalogChange === "args" || catalogChange === "aba" ? { args: { type: "string" as const } } : {}),
              ...(catalogChange === "returns" ? { returns: { type: "any" as const } } : {}),
              ...(catalogChange === "partition" ? { partition: { type: "partitionCreateRoot" as const,
                table: "users", partitionField: "_id" as const } } : {}),
              ...(catalogChange === "visibilityExpansion" ? { visibility: "public" as const } : {}),
            }),
        }) };
      let next = yield* Effect.promise(() => native.moveHead({ manifest: changed, expectedActiveHead: originalActive.expectedActiveHead }));
      const intermediate = (yield* Effect.promise(observation))[0];
      if (catalogChange === "aba") next = yield* Effect.promise(() => native.moveHead({ manifest,
        expectedActiveHead: next.expectedActiveHead }));
      expect(next.basis.manifest.sourceArtifact).toEqual(manifest.sourceArtifact);
      expect(next.basis.manifest.functions.find(fn => fn.path === root.path)).toEqual(root);
      expect(yield* Effect.promise(revocation)).toEqual(originalRevocation);
      const current = (yield* Effect.promise(observation))[0];
      if (current === undefined || intermediate === undefined) return yield* Effect.die(new Error("Missing actual catalog observation"));
      catalogProjection = { intermediate, current };
    });
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
    const evidence = yield* harness.prepareEvidence({ body: harness.alphaId,
      ...(catalogChange === "unrelatedSchemaReadOnly" ? { readOnly: true } : {}) });
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
      publisher: { publishFinite: command => Effect.gen(function* () {
        publications += 1;
        if (catalogChange !== undefined) {
          const frozen = readFrozenFiniteAttempt(command.frozenAttempt);
          if (frozen === undefined) return yield* Effect.die(new Error("Missing genuine frozen Worker contribution"));
          expect(frozen.graph.metadataDependencies).toEqual(expect.arrayContaining([
            expect.objectContaining({ ...executionGroup, observed: expect.objectContaining({ kind: "present" }) }),
            expect.objectContaining({ namespace: "execution", ownerKey: "application",
              contractKey: finiteMetadataContractKey("function", "users:readTwice") }),
          ]));
          yield* changeCatalog();
        }
        return yield* harness.publisher.publishFinite(command);
      }),
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
    // Inspect observations after the genuine publisher settles. With the old
    // group algorithm publication can succeed, exposing the missing dependency
    // through the authentic result instead of a pre-publication assertion.
    if (catalogChange !== undefined) {
      if (catalogProjection === undefined || originalGroup === undefined) {
        if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
        return yield* Effect.die(new Error("Missing completed catalog activation witness"));
      }
      const { intermediate, current } = catalogProjection;
      if (schemaOnlyChange) expect(current).toEqual(originalGroup);
      else {
        expect(intermediate.semanticSha256Hex).not.toBe(originalGroup.semanticSha256Hex);
        expect(current.lastChangedMetadataSequence).toBeGreaterThan(originalGroup.lastChangedMetadataSequence);
        if (catalogChange === "aba") expect(current.semanticSha256Hex).toBe(originalGroup.semanticSha256Hex);
        else expect(current.semanticSha256Hex).not.toBe(originalGroup.semanticSha256Hex);
      }
    }
    if (catalogChange !== undefined && !schemaOnlyChange) {
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Changed Worker catalog published its original body"));
      expect(result.cause.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "Fail",
        error: expect.any(PointCommitConflictV1Error) })]));
      expect(result.cause.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ _tag: "Fail",
        error: expect.objectContaining({ conflict: expect.objectContaining({ kind: "metadata", ...executionGroup }) }) })]));
      expect(successfulPointDeliveries).toBe(3);
      expect(publications).toBe(1);
      expect({ ...after, clock: [] }).toEqual({ ...before, clock: [] });
    } else if (catalogChange === "unrelatedSchema") {
      // The same-source group is unchanged, but this handler writes. The
      // independent candidate guard still refuses its original write schema.
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Changed candidate accepted the original write"));
      expect(result.cause.reasons.some(reason => reason._tag === "Fail" &&
        reason.error instanceof PointCommitCorruptionV1Error && reason.error.reason === "candidateSchemaValidationInvalid")).toBe(true);
      expect(successfulPointDeliveries).toBe(3);
      expect(publications).toBe(1);
      expect({ ...after, clock: [] }).toEqual({ ...before, clock: [] });
    } else if (revoke) {
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
      expect(successfulPointDeliveries).toBe(catalogChange === "unrelatedSchemaReadOnly" ? 2 : 3);
      expect(publications).toBe(1);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    }
    return { result, pointReads, heartbeats, publications, successfulPointDeliveries };
  },
);
