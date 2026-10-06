import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { APPLICATION_EXECUTION_METADATA_OWNER } from "../../persistence-postgres/src/finiteMetadataDependencies";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/pointCommitErrors";
import { PointMutationAttemptReplacementFiniteEntryError } from "../../persistence-postgres/src/pointCommitTransaction";
import { PointMutationExecutionClaimAcquisitionStaleV1Error } from "../../persistence-postgres/src/transactionSessionActivation";
import type { FiniteMetadataReservation } from "../../persistence-postgres/src/finiteMetadataReservation";
import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/finiteAttemptAnchor";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { fxAppRowRevisions, fxSystemCommits, fxSystemMetadataContractObservations,
  fxSystemScopeExecutionAuthorities, fxSystemTransactionSessions } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { admittedCommerceEventGroup } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { MiniflareApplicationAnalysisWorkerLoader, makeStandardApplicationCurrentAnalysisV1 } from "../../system-test/support/standardApplicationCurrentAnalysisHarness";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { changedMixedMutationExecutableSource } from "./support/mixedMutationApplicationSource";
import { rebindMixedMutationApplication } from "./support/mixedMutationApplicationRebinding";

const WorkerSuccess = Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) });
const ReturnedIds = Schema.Struct({ id: Schema.String, created: Schema.Struct({ id: Schema.String }) });
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
const signedExecutionFields = { authority: fxSystemTransactionSessions.applicationExecutionAuthorityJson,
  canonicalBytes: fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes,
  sha256: fxSystemTransactionSessions.applicationExecutionAuthoritySha256 };

describe.each(drivers)("whole Worker metadata ABA retry on %s", driver => {
  it("reruns the root once at the same data snapshot after restoring the exact signed pins", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let freshReservation: FiniteMetadataReservation | undefined;
    let freshSession: typeof fxSystemTransactionSessions.$inferSelect | undefined;
    fixture = await createMixedMutationProductFixture({ driver,
      suffix: `metadata-aba-retry-${driver}`, payloadProfile: "success", hooks: {
        afterProductBorrow: method => method !== "update" || fixture.retryContexts.length === 0 ? Effect.void : Effect.tryPromise({
          try: async () => {
            const [session] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
              .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
            if (session === undefined) throw new Error("Missing fresh compact attempt anchor");
            const anchor = await Effect.runPromise(readFiniteAttemptAnchorRow(session));
            if (anchor.reservation === null) throw new Error("Missing fresh real entry reservation");
            freshReservation = anchor.reservation;
            freshSession = session;
          }, catch: cause => commerceError("resourceFailure", cause),
        }),
      } });
    const loader = new MiniflareApplicationAnalysisWorkerLoader();
    try {
      const { application, currency } = fixture;
      const scopeId = fixture.activation.anchor.scopeId;
      const sessionId = fixture.activation.anchor.sessionId;
      const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
      const originalActive = await Effect.runPromise(application.activation.readActive());
      const beforeClock = await currency.persistence.getScopeClock(scopeId);
      if (beforeClock === null) throw new Error("Missing initial real scope clock");
      const authorityFields = { epoch: fxSystemScopeExecutionAuthorities.epoch,
        revocation: fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch };
      const authorityBefore = await currency.persistence.drizzle.select(authorityFields).from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
      const pinnedFields = { schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
        functionPath: fxSystemTransactionSessions.functionPath, functionKind: fxSystemTransactionSessions.functionKind,
        executionModule: fxSystemTransactionSessions.executionModule, sourcePackageHash: fxSystemTransactionSessions.sourcePackageHash,
        grantSha256: fxSystemTransactionSessions.authorizationGrantSha256, requestSha256: fxSystemTransactionSessions.requestSha256,
        executionAuthoritySha256: fxSystemTransactionSessions.applicationExecutionAuthoritySha256 };
      const pinsBefore = await currency.persistence.drizzle.select(pinnedFields).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      const [signedBefore] = await currency.persistence.drizzle.select(signedExecutionFields).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      if (signedBefore === undefined || signedBefore.authority === null || signedBefore.canonicalBytes === null || signedBefore.sha256 === null)
        throw new Error("Missing original signed execution authority");
      expect(signedBefore.authority.activationSequence).toBe(originalActive.basis.activationSequence.toString());
      expect(signedBefore.authority.activeHeadSha256).toBe(encodeBytesToLowercaseHex(originalActive.basis.headSha256));
      const headersBefore = await currency.persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const originalValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      const originalIds = Schema.decodeUnknownSync(ReturnedIds)(originalValue);
      const publication = await fixture.prepareOccPublication(originalValue);
      const [originalSession] = await currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      if (originalSession === undefined) throw new Error("Missing original compact attempt anchor");
      const originalAnchor = await Effect.runPromise(readFiniteAttemptAnchorRow(originalSession));
      if (originalAnchor.reservation === null) throw new Error("Missing original authenticated metadata reservation");
      const initialMetadataWatermark = originalAnchor.reservation.metadataWatermark;
      expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns())).toEqual([1]);

      const changedSource = await changedMixedMutationExecutableSource(fixture);
      const changed = await application.registerRevision({ requestKey: `metadata-aba-changed-${driver}`,
        analysis: makeStandardApplicationCurrentAnalysisV1(changedSource, loader, `metadata-aba-${driver}`) });
      expect(changed.manifest.schema.tables.map(table => ({ name: table.name, validator: table.validator })))
        .toEqual(originalActive.basis.manifest.schema.tables.map(table => ({ name: table.name, validator: table.validator })));
      expect(changed.manifest.schema.indexes).toEqual(originalActive.basis.manifest.schema.indexes);
      const functionContracts = (functions: typeof changed.manifest.functions) => functions.map(fn => ({ path: fn.path,
        kind: fn.kind, visibility: fn.visibility, args: fn.args, returns: fn.returns }));
      expect(functionContracts(changed.manifest.functions)).toEqual(functionContracts(originalActive.basis.manifest.functions));
      expect(changed.manifest.schema).toEqual(originalActive.basis.manifest.schema);
      const unchangedSchema = await application.preparePublishedSchema(changed.manifest);
      expect(unchangedSchema.schemaVersionId).toBe(originalActive.basis.schemaVersionId);
      const ready = await Effect.runPromise(application.readiness.settle({ deploymentId: currency.deploymentId,
        scopeId, revisionId: changed.publication.revisionId }));
      expect(ready.status).toBe("ready");
      expect(await Effect.runPromise(application.activation.activate({ revisionId: changed.publication.revisionId,
        expectedActiveHead: originalActive.expectedActiveHead }))).toMatchObject({ status: "activated", disposition: "inserted" });
      const changedActive = await Effect.runPromise(application.activation.readActive());
      expect(changedActive.basis.manifest.sourceArtifact.rootSha256).not.toBe(originalActive.basis.manifest.sourceArtifact.rootSha256);
      expect(await Effect.runPromise(application.activation.activate({ revisionId: originalActive.basis.revisionId,
        expectedActiveHead: changedActive.expectedActiveHead }))).toMatchObject({ status: "activated", disposition: "inserted" });
      const restored = await Effect.runPromise(application.activation.readActive());
      expect(restored.basis.revisionId).toBe(originalActive.basis.revisionId);
      expect(restored.basis.schemaVersionId).toBe(originalActive.basis.schemaVersionId);
      expect(restored.basis.manifest.sourceArtifact.rootSha256).toBe(originalActive.basis.manifest.sourceArtifact.rootSha256);
      expect(restored.basis.activationSequence).toBeGreaterThan(originalActive.basis.activationSequence);
      expect(restored.basis.headSha256).not.toEqual(originalActive.basis.headSha256);
      expect(await currency.persistence.drizzle.select(signedExecutionFields).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId))).toEqual([signedBefore]);
      const rebound = await rebindMixedMutationApplication(fixture, `metadata-aba-rebind-${driver}`);
      const afterMetadataClock = await currency.persistence.getScopeClock(scopeId);
      if (afterMetadataClock === null) throw new Error("Missing restored real scope clock");
      expect(afterMetadataClock.lastCommitSeq).toBe(beforeClock.lastCommitSeq);
      expect(afterMetadataClock.lastMetadataSequence).toBeGreaterThan(initialMetadataWatermark);
      expect(await currency.persistence.drizzle.select(authorityFields).from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId))).toEqual(authorityBefore);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)))
        .toEqual(headersBefore);
      const executionFacts = await currency.persistence.drizzle.select().from(fxSystemMetadataContractObservations).where(and(
        eq(fxSystemMetadataContractObservations.scopeId, scopeId),
        eq(fxSystemMetadataContractObservations.namespace, APPLICATION_EXECUTION_METADATA_OWNER.namespace),
        eq(fxSystemMetadataContractObservations.ownerKey, APPLICATION_EXECUTION_METADATA_OWNER.ownerKey)));
      expect(executionFacts.some(fact => fact.present && fact.lastChangedMetadataSequence > initialMetadataWatermark)).toBe(true);

      const conflict = await Effect.runPromise(publication).then(() => null, cause => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      if (!(conflict instanceof PointCommitConflictV1Error) || conflict.conflict.kind !== "metadata")
        throw new Error("Expected genuine metadata publication conflict", { cause: conflict });
      expect(conflict.snapshotCommitSeq).toBe(conflict.currentCommitSeq);
      expect(conflict.conflict.capturedMetadataWatermark).toBe(initialMetadataWatermark);
      expect(conflict.conflict.lastChangedMetadataSequence).toBeGreaterThan(initialMetadataWatermark);
      expect(await fixture.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      expect(fixture.retryContexts).toHaveLength(1);
      const fresh = fixture.retryContexts[0];
      if (fresh === undefined) throw new Error("Missing whole-root retry context");
      expect(fresh.snapshotToken).toEqual(fixture.activation.anchor.snapshotToken);
      expect(fresh.attemptFence).toBe(fixture.activation.anchor.attemptFence + 1n);
      expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns())).toEqual([1, 1]);
      expect(fixture.nativeInvokeCount.get("update")).toBe(2);
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(2);
      const freshIds = Schema.decodeUnknownSync(ReturnedIds)(fixture.retryReturnedValues[0]);
      expect(freshIds.id).not.toBe(originalIds.id);
      expect(freshIds.created.id).not.toBe(originalIds.created.id);
      for (const id of [freshIds.id, freshIds.created.id]) {
        const identity = decodeAppDocumentIdentityV1(id);
        const rows = await currency.persistence.drizzle.select().from(fxAppRowRevisions).where(and(
          eq(fxAppRowRevisions.scopeUuid, scopeUuid), eq(fxAppRowRevisions.tableId, identity.tableId)));
        expect(rows).toHaveLength(1);
      }
      const freshGroup = admittedCommerceEventGroup({ scopeUuid, sessionId, attemptFence: fresh.attemptFence });
      const events = await currency.persistence.drizzle.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      expect(events.filter(event => event.envelope.group === freshGroup)).toHaveLength(1);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)))
        .toHaveLength(headersBefore.length + 1);
      if (freshReservation === undefined) throw new Error("Fresh Worker did not observe its authentic entry reservation");
      expect(freshReservation.metadataWatermark).toBeGreaterThan(initialMetadataWatermark);
      expect(freshReservation.metadataWatermark).toBeGreaterThanOrEqual(conflict.conflict.lastChangedMetadataSequence);
      expect(freshReservation.attemptFence).toBe(fresh.attemptFence);
      expect(freshReservation.schemaVersionId).toBe(originalActive.basis.schemaVersionId);
      expect(freshReservation.application.activationSequence).toBe(restored.basis.activationSequence.toString());
      expect(freshReservation.application.headSha256).toBe(encodeBytesToLowercaseHex(restored.basis.headSha256));
      if (freshSession === undefined) throw new Error("Fresh Worker did not observe its original signed authority");
      expect({ authority: freshSession.applicationExecutionAuthorityJson,
        canonicalBytes: freshSession.applicationExecutionAuthorityCanonicalBytes,
        sha256: freshSession.applicationExecutionAuthoritySha256 }).toEqual(signedBefore);
      expect(await currency.persistence.drizzle.select(pinnedFields).from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId))).toEqual(pinsBefore);
      expect(await rebound.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId, title: fixture.seed.newTitle });
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { try { await loader.dispose(); } finally { await fixture.close(); } }
  }, 240_000);

  it("durably aborts an incompatible executable retry and refuses cold redispatch after restoring the original program", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `metadata-incompatible-retry-${driver}`, payloadProfile: "success" });
    const loader = new MiniflareApplicationAnalysisWorkerLoader();
    try {
      const { application, currency } = fixture;
      const scopeId = fixture.activation.anchor.scopeId;
      const sessionId = fixture.activation.anchor.sessionId;
      const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
      const originalActive = await Effect.runPromise(application.activation.readActive());
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      const publication = await fixture.prepareOccPublication(value);
      const changedSource = await changedMixedMutationExecutableSource(fixture);
      const changed = await application.registerRevision({ requestKey: `metadata-incompatible-${driver}`,
        analysis: makeStandardApplicationCurrentAnalysisV1(changedSource, loader, `metadata-incompatible-${driver}`) });
      expect(changed.manifest.schema).toEqual(originalActive.basis.manifest.schema);
      expect((await application.preparePublishedSchema(changed.manifest)).schemaVersionId).toBe(originalActive.basis.schemaVersionId);
      expect(await Effect.runPromise(application.readiness.settle({ deploymentId: currency.deploymentId,
        scopeId, revisionId: changed.publication.revisionId }))).toMatchObject({ status: "ready" });
      expect(await Effect.runPromise(application.activation.activate({ revisionId: changed.publication.revisionId,
        expectedActiveHead: originalActive.expectedActiveHead }))).toMatchObject({ status: "activated", disposition: "inserted" });
      const current = await Effect.runPromise(application.activation.readActive());
      expect(current.basis.manifest.sourceArtifact.rootSha256).not.toBe(originalActive.basis.manifest.sourceArtifact.rootSha256);
      const conflict = await Effect.runPromise(publication).then(() => null, cause => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      if (!(conflict instanceof PointCommitConflictV1Error) || conflict.conflict.kind !== "metadata")
        throw new Error("Expected real incompatible-executable metadata conflict", { cause: conflict });
      const inspect = async () => ({
        sessions: await currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
          .where(eq(fxSystemTransactionSessions.sessionId, sessionId)),
        rows: await currency.persistence.drizzle.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)),
        commits: await currency.persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)),
        events: await currency.persistence.drizzle.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)),
      });
      const before = await inspect();
      expect(before.sessions).toHaveLength(1);
      const originalSession = before.sessions[0];
      if (originalSession === undefined) throw new Error("Missing original incompatible-executable attempt");
      expect(originalSession).toMatchObject({ lifecycle: "retrying", attemptFence: fixture.activation.anchor.attemptFence,
        finiteClaimFence: fixture.activation.executionClaim.claimFence + 1n });
      for (const value of [originalSession.validatedArgsJson, originalSession.authorizationGrantJson,
        originalSession.applicationExecutionAuthorityJson]) expect(value).not.toBeNull();
      expect(originalSession.applicationExecutionAuthoritySha256).not.toBeNull();
      for (const bytes of [originalSession.validatedArgsCanonicalBytes, originalSession.authorizationGrantCanonicalBytes,
        originalSession.applicationExecutionAuthorityCanonicalBytes]) {
        if (bytes === null) throw new Error("Missing original canonical evidence to scrub");
        expect(bytes.byteLength).toBeGreaterThan(0);
      }
      const callsBefore = Object.fromEntries(fixture.nativeInvokeCount);
      const retryFailure = await fixture.retryWholeAttempt(conflict).then(() => null, cause => cause);
      expect(retryFailure).toBeInstanceOf(PointMutationAttemptReplacementFiniteEntryError);
      expect(retryFailure).toMatchObject({ cause: { _tag: "ApplicationMutationAdmissionError",
        reason: "invalidExecutionAuthority", retryable: false } });
      const closed = await inspect();
      expect(closed).toEqual({ ...before, sessions: [{ ...originalSession, lifecycle: "aborted",
        finiteClaimFence: fixture.activation.executionClaim.claimFence + 2n,
        validatedArgsJson: null, validatedArgsCanonicalBytes: null,
        authorizationGrantJson: null, authorizationGrantCanonicalBytes: null,
        applicationExecutionAuthorityJson: null, applicationExecutionAuthorityCanonicalBytes: null }] });
      expect(fixture.retryContexts).toHaveLength(0);
      expect(fixture.retryReturnedValues).toHaveLength(0);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(callsBefore);
      expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns())).toEqual([1]);

      expect(await Effect.runPromise(application.activation.activate({ revisionId: originalActive.basis.revisionId,
        expectedActiveHead: current.expectedActiveHead }))).toMatchObject({ status: "activated", disposition: "inserted" });
      const restored = await Effect.runPromise(application.activation.readActive());
      expect(restored.basis.revisionId).toBe(originalActive.basis.revisionId);
      expect(restored.basis.manifest.sourceArtifact.rootSha256).toBe(originalActive.basis.manifest.sourceArtifact.rootSha256);
      expect(restored.basis.activationSequence).toBeGreaterThan(current.basis.activationSequence);
      const closedSession = closed.sessions[0];
      if (closedSession === undefined) throw new Error("Missing durably aborted attempt for cold redispatch");
      const coldFailure = await Effect.runPromise(fixture.makeFiniteDispatcher().redispatchExactPointMutationAttempt({
        deploymentId: fixture.activation.anchor.deploymentId, scopeId, sessionId,
        attemptFence: closedSession.attemptFence.toString(),
      }))
        .then(() => null, cause => cause);
      expect(coldFailure).toBeInstanceOf(PointMutationExecutionClaimAcquisitionStaleV1Error);
      expect(coldFailure).toMatchObject({ reason: "lifecycle" });
      expect(await inspect()).toEqual(closed);
      expect(fixture.retryContexts).toHaveLength(0);
      expect(fixture.retryReturnedValues).toHaveLength(0);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual(callsBefore);
      expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns())).toEqual([1]);
      expect(fixture.getOpenTransactionDepth()).toBe(0);
    } finally { try { await loader.dispose(); } finally { await fixture.close(); } }
  }, 240_000);
});
