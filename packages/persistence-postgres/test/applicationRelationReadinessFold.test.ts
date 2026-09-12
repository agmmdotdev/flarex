import { makeStandardApplicationTaskSha256V1 } from "@flarex/standard-application-definition/internal/task-definition-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { ApplicationActivationSequenceV1Schema, CommitSyscallSequenceV1Schema, canonicalizeSessionJournalV1Effect, canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { CatalogSchemaVersionSchema } from "flarex-protocol/schema-manifest";
import { decodeCatalogEdgeDefinitionId } from "flarex-protocol/catalog";
import { CommitSeqSchema, decodeReplacementScopeIdV1, LegacyV1StorageGenerationSchema, projectScopeIdUuidV1, ScopeEpochSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";
import { exactRelationCommitRowId } from "./applicationRelationSourceCommitFixture";
import { applicationRelationActiveSelectionMatchesSnapshot, claimApplicationActiveSelection, claimApplicationRelationActiveSelection, makeApplicationActivationRepository, validateApplicationActiveSelectionInTransaction, validateApplicationRelationActiveSelectionInTransaction, validateApplicationRelationActiveSelectionForReadiness } from "../src/applicationActivation";
import { hasApplicationRelationReadinessFoldAuthority, makeApplicationRelationReadinessFoldRepository, validateApplicationRelationReadinessForActivationInTransaction, validateStoredApplicationRelationReadinessForActivationInTransaction } from "../src/applicationRelationReadinessFold";
import { createApplicationRelationReadinessPort } from "../src/applicationRelationReadiness";
import { createApplicationRelationReadPort } from "../src/applicationRelationRead";
import { fxSystemApplicationFunctions, fxSystemApplicationPublications, fxSystemApplicationReadiness, fxSystemApplicationReadinessRelations, fxSystemApplicationRevisionSchemas, fxSystemApplicationTaskCatalogs, fxSystemApplicationTaskDefinitions } from "../src/applicationRelationSchema";
import { inspectApplicationRelationServingDefinitionInTransactionEffect } from "../src/applicationRelationServing";
import { isRetryableSqlTransactionCause } from "../src/locatedReadCommittedEffect";
import { createPointCommitFinishingTransitionPortV1, createPointCommitRollbackProofPortV1, createPointMutationAttemptReplacementPortV1, PointCommitConflictV1Error, PointCommitCorruptionV1Error, PointCommitStaleAuthorityV1Error, PointMutationAttemptReplacementStaleAuthorityV1Error } from "../src/pointCommitTransaction";
import type { SplitScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { lockScopeClockForShareInTransactionEffect, lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads } from "../src/applicationActivationSchema";
import { fxControlApplicationSchemaAuthoritiesV1, fxSystemApplicationPublicationsV1, fxSystemApplicationReadinessV1, fxSystemApplicationTaskCatalogsV1, fxSystemApplicationTaskDefinitionsV1, fxSystemApplicationRelationSemanticReadiness, fxSystemEdgeDefinitionReadiness, fxSystemScopeClocks, fxSystemTransactionJournalRelationIncomingDependencies, fxSystemTransactionJournals } from "../src/schema";
import { createSessionJournalStorePersistenceV1, SessionJournalSealV1Error, SessionJournalStorageCorruptionV1Error } from "../src/sessionJournalStore";
import { createPointMutationExecutionClaimAcquisitionV1, createPointMutationSessionActivationPersistenceV1, createPointMutationSessionAttemptLoadPersistenceV1 } from "../src/transactionSessionActivation";
import { createStoredAttemptEvidenceLoaderV1 } from "../src/storedAttemptEvidence";
import { createStoredOccExecutionEvidenceLoaderV1 } from "../src/storedOccExecution";
import { relationBuildRowId } from "./applicationRelationBuildTestSupport";
import { completeSessionJournalSeal, prepareSessionJournalSeal, runEffect, runEffectFailure } from "./effectTestRuntime";
import { relationAuthorityFromAnchor, selectorFromRelationAnchor } from "./pointCommitRelationTestSupport";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1, pointCommitFinishingCommandFromStoredAttemptV1, pointMutationAttemptReplacementCommandFromPointCommitCommandV1, runningRelationConflictAttemptReplacementCommandFromStoredOccExecutionV1, runningRelationConflictRecoveryCommandFromStoredOccExecutionV1 } from "./pointCommitTransactionTestSupport";
import { TEST_GRANT_RETENTION_POLICY_V1, activatePointMutationSession, pointMutationSessionActivationFixture } from "./transactionSessionActivationTestSupport";
import { issueSetupSeededSyscallValidatorProofV1 } from "./applicationRevisionSyscallValidatorTestSupport";
import { readApplicationBindingProjectionInTransaction } from "../src/applicationBindingProjection";
import { isApplicationBindingReference } from "../src/frameworkSchema/binding/canonical";
import { relationActivationInventory, readyExactRelationReadFixture, prepareSealedRelationAttempt, applyExactRelationSourceCommit, advanceExactRelationScopeClock, setExactRelationAdjacencyVersion, relationReadinessFixture, prepareReadinessEvidence, prepareAdditionalRelationRevision, prepareLegacyRevisionInRelationFixture, settleCandidateValidation, uuidSequence } from "./applicationRelationReadinessFixture";
const LOCATOR = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "application_relation_readiness_fold_target",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;
const RUNTIME_HOST_IDENTITY = "flarex.test/application-relation-runtime-host";
const COMPATIBILITY_DATE = "2026-08-25";
const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

let fixtureOrdinal = 0;

describe("Application relation readiness fold", { timeout: 60_000 }, () => {
  it("retains scalar V3 policy identity through target publication and readiness", async () => {
    const fixture = await relationReadinessFixture({ writePolicy: true });
    await prepareReadinessEvidence(fixture);
    const ready = await runEffect(fixture.fold.settle(fixture.input));
    expect(ready.status).toBe("ready");
    const rows = await fixture.persistence.drizzle.select().from(fxSystemApplicationReadiness)
      .where(eq(fxSystemApplicationReadiness.scopeId, fixture.authority.scopeId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.readinessCodecVersion).toBe(3);
    expect(row.relationCount).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(row.readinessBytes))).toMatchObject({
      version: 3, writePolicySetSha256: fixture.manifest.version === 3 ? fixture.manifest.schema.writePolicySetSha256 : "invalid",
      relationSet: { relationCount: 0 },
    });
    expect((await runEffect(fixture.fold.readReady(fixture.input))).status).toBe("ready");
    const activationInput = { revisionId: fixture.input.revisionId, expectedActiveHead: null };
    const activated = await runEffect(fixture.relationActivation.activate(activationInput));
    expect(activated).toMatchObject({ status: "activated", activationSequence: 1n });
    expect(await runEffect(fixture.relationActivation.activate(activationInput))).toMatchObject({ disposition: "replayed" });
    const active = await runEffect(fixture.relationActivation.readActive());
    if (active === null) throw new Error("Expected policy active selection");
    const projection = await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
      return yield* readApplicationBindingProjectionInTransaction(active.selection, tx, clock);
    })));
    expect(isApplicationBindingReference(projection)).toBe(true);
    expect(projection.readiness).toMatchObject({ kind: "policy", relationCount: 0 });
  });

  it("classifies PostgreSQL lock contention as retryable", () => {
    expect(isRetryableSqlTransactionCause({ code: "55P03" })).toBe(true);
    expect(isRetryableSqlTransactionCause({ code: "42P01" })).toBe(false);
  });

  it("journals and seals an exact relation read from the ready fold", async () => {
    const ready = await readyExactRelationReadFixture();
    const projection = await ready.fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, ready.fixture.authority.scopeId);
      return yield* readApplicationBindingProjectionInTransaction(ready.active.selection, tx, clock);
    })));
    expect(isApplicationBindingReference(projection)).toBe(true);
    if (!("relationCount" in ready.active.basis)) throw new Error("Expected relation readiness fixture");
    expect(projection.readiness).toMatchObject({ kind: "relation", relationCount: ready.active.basis.relationCount });
    const {
      fixture,
      readiness,
      binding,
      reads,
      capability,
      input,
      resolved,
    } = ready;
    expect(resolved.definition.binding.relationId).toBe(binding.relationId);
    expect(resolved.storageGenerationFence).toBe(
      fixture.authority.storageGenerationFence,
    );
    expect(resolved.epoch).toBe(fixture.authority.epoch);
    expect(Result.isFailure(reads.resolve(
      Object.freeze({ ...capability }),
      input,
    ))).toBe(true);
    const validated = await fixture.persistence.drizzle.transaction(
      async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(tx, input.scopeId),
        );
        return runEffect(reads.validateInTransaction(
          capability,
          input,
          tx,
          clock,
        ));
      },
    );
    expect(validated.activeSelection.activationSequence).toBe(
      ready.active.basis.activationSequence,
    );
    expect(validated.activeSelection.activeHeadSha256).toEqual(
      ready.active.basis.headSha256,
    );
    validated.activeSelection.activeHeadSha256.fill(0);
    const revalidated = await fixture.persistence.drizzle.transaction(
      async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(tx, input.scopeId),
        );
        return runEffect(reads.validateInTransaction(
          capability,
          input,
          tx,
          clock,
        ));
      },
    );
    expect(revalidated.activeSelection.activeHeadSha256).toEqual(
      ready.active.basis.headSha256,
    );
    const forgedFailure = await fixture.persistence.drizzle.transaction(
      async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(tx, input.scopeId),
        );
        let transactionAccessed = false;
        const inaccessibleTx = new Proxy(tx, {
          get: (target, property, receiver) => {
            transactionAccessed = true;
            return Reflect.get(target, property, receiver);
          },
        });
        const failure = await runEffectFailure(reads.validateInTransaction(
          Object.freeze({ ...capability }),
          input,
          inaccessibleTx,
          clock,
        ));
        expect(transactionAccessed).toBe(false);
        return failure;
      },
    );
    expect(forgedFailure).toMatchObject({
      _tag: "ApplicationRelationReadUnavailableError",
      reason: "capabilityMismatch",
    });
    const selectionSnapshot = Result.getOrThrow(
      claimApplicationRelationActiveSelection(ready.active.selection),
    );
    const activeBasis = await fixture.persistence.drizzle.transaction(
      async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(tx, input.scopeId),
        );
        return runEffect(
          validateApplicationRelationActiveSelectionInTransaction(
            ready.active.selection,
            tx,
            clock,
          ),
        );
      },
    );
    const divergeDigest = (value: Uint8Array): Uint8Array => {
      const divergent = new Uint8Array(value);
      divergent[0] = (divergent[0] ?? 0) ^ 0xff;
      return divergent;
    };
    expect(applicationRelationActiveSelectionMatchesSnapshot(
      activeBasis,
      selectionSnapshot,
    )).toBe(true);
    for (const divergentSnapshot of [
      Object.freeze({
        ...selectionSnapshot,
        activationSequence: ApplicationActivationSequenceV1Schema.make(
          selectionSnapshot.activationSequence + 1n,
        ),
      }),
      Object.freeze({
        ...selectionSnapshot,
        relationFrontierCommitSeq: (
          BigInt(selectionSnapshot.relationFrontierCommitSeq) + 1n
        ).toString(),
      }),
      Object.freeze({
        ...selectionSnapshot,
        headSha256: divergeDigest(selectionSnapshot.headSha256),
      }),
      Object.freeze({
        ...selectionSnapshot,
        readinessSha256: divergeDigest(selectionSnapshot.readinessSha256),
      }),
      Object.freeze({
        ...selectionSnapshot,
        relationSetReadinessSha256: divergeDigest(
          selectionSnapshot.relationSetReadinessSha256,
        ),
      }),
      Object.freeze({
        ...selectionSnapshot,
        authority: Object.freeze({
          ...selectionSnapshot.authority,
          storageGenerationFence: StorageGenerationFenceSchema.make(
            selectionSnapshot.authority.storageGenerationFence + 1n,
          ),
        }),
      }),
    ]) {
      expect(applicationRelationActiveSelectionMatchesSnapshot(
        activeBasis,
        divergentSnapshot,
      )).toBe(false);
    }

    const randomUuid = uuidSequence(21, 22, 23);
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        fixture.pointCommitAuthority,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid,
          randomExecutionClaimOwner: randomUuid,
        },
      ),
      pointMutationSessionActivationFixture(
        fixture.deploymentId,
        decodeReplacementScopeIdV1(readiness.scopeId),
        { evidence: {
          schemaVersionId: fixture.relation.binding.schemaVersionId,
        } },
      ),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a new exact relation-read attempt.");
    }
    const store = createSessionJournalStorePersistenceV1(
      fixture.pointCommitAuthority,
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        applicationRelations: reads,
      },
    );
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: fixture.relation.binding.schemaVersionId,
    }));
    const relation = await runEffect(
      store.resolveApplicationRelationReadEffect(attempt, capability),
    );
    const targetRowId = relationBuildRowId(9_001);
    const operation = Object.freeze({
      kind: "relationIncoming" as const,
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      targetDocumentId: appDocumentIdV1FromRowIdentity({
        tableId: binding.targetTableId,
        rowId: targetRowId,
      }),
      limit: 1,
    });
    const executed = await runEffect(
      store.runApplicationRelationIncomingReadEffect(relation, operation),
    );
    const replayed = await runEffect(
      store.runApplicationRelationIncomingReadEffect(relation, operation),
    );
    expect(executed).toEqual({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "relationIncomingPage",
        items: [],
        exhausted: true,
      },
    });
    expect(replayed).toEqual({
      ...executed,
      delivery: "replayed",
    });
    if (executed.kind !== "completed") {
      throw new Error("Expected an executed relation page.");
    }

    const validOutcome = await canonicalizeFlarexValueV1(executed.outcome);
    const invalidPositionOutcome = await canonicalizeFlarexValueV1({
      kind: "relationIncomingPage",
      items: [{
        sourceDocumentId: appDocumentIdV1FromRowIdentity({
          tableId: binding.sourceTableId,
          rowId: relationBuildRowId(9_002),
        }),
        duplicateOrdinal: 0,
        position: 0,
      }],
      exhausted: true,
    });
    await fixture.persistence.query(
      `update fx_system_tx_journal_latest_receipt
          set outcome_bytes = $2, outcome_sha256 = $3
        where session_id = $1`,
      [
        activation.anchor.sessionId,
        invalidPositionOutcome.canonicalBytes,
        invalidPositionOutcome.sha256,
      ],
    );
    const invalidReplay = await runEffectFailure(
      store.runApplicationRelationIncomingReadEffect(relation, operation),
    );
    expect(invalidReplay).toBeInstanceOf(
      SessionJournalStorageCorruptionV1Error,
    );
    expect(invalidReplay).toMatchObject({
      reason: "latestReceiptEvidenceInvalid",
    });
    await fixture.persistence.query(
      `update fx_system_tx_journal_latest_receipt
          set outcome_bytes = $2, outcome_sha256 = $3
        where session_id = $1`,
      [
        activation.anchor.sessionId,
        validOutcome.canonicalBytes,
        validOutcome.sha256,
      ],
    );

    await fixture.persistence.query(
      `update fx_system_tx_journal_relation_incoming
          set observed_adjacency_version = $2
        where session_id = $1`,
      [
        activation.anchor.sessionId,
        activation.anchor.snapshotToken.commitSeq + 1n,
      ],
    );
    const invalidDependencyRead = await runEffectFailure(
      store.runApplicationRelationIncomingReadEffect(relation, {
        ...operation,
        syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
        targetDocumentId: appDocumentIdV1FromRowIdentity({
          tableId: binding.targetTableId,
          rowId: relationBuildRowId(9_003),
        }),
      }),
    );
    expect(invalidDependencyRead).toBeInstanceOf(
      SessionJournalStorageCorruptionV1Error,
    );
    expect(invalidDependencyRead).toMatchObject({
      reason: "relationDependencyInvalid",
    });
    const invalidDependencySeal = await runEffectFailure(
      store.prepareSealEffect(attempt),
    );
    expect(invalidDependencySeal).toBeInstanceOf(
      SessionJournalStorageCorruptionV1Error,
    );
    expect(invalidDependencySeal).toMatchObject({
      reason: "relationDependencyInvalid",
    });
    await fixture.persistence.query(
      `update fx_system_tx_journal_relation_incoming
          set observed_adjacency_version = $2
        where session_id = $1`,
      [
        activation.anchor.sessionId,
        activation.anchor.snapshotToken.commitSeq,
      ],
    );

    await fixture.persistence.query(
      `alter table fx_system_tx_journal_relation_incoming
         drop constraint fx_system_tx_journal_relation_incoming_identity_check`,
    );
    await fixture.persistence.query(
      `update fx_system_tx_journal_relation_incoming
          set active_head_sha256 = decode(repeat('00', 31), 'hex')
        where session_id = $1`,
      [activation.anchor.sessionId],
    );
    const malformedSelectionRead = await runEffectFailure(
      store.runApplicationRelationIncomingReadEffect(relation, {
        ...operation,
        syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
        targetDocumentId: appDocumentIdV1FromRowIdentity({
          tableId: binding.targetTableId,
          rowId: relationBuildRowId(9_004),
        }),
      }),
    );
    expect(malformedSelectionRead).toMatchObject({
      _tag: "SessionJournalStorageCorruptionV1Error",
      reason: "relationDependencyInvalid",
    });
    const malformedSelectionSeal = await runEffectFailure(
      store.prepareSealEffect(attempt),
    );
    expect(malformedSelectionSeal).toMatchObject({
      _tag: "SessionJournalStorageCorruptionV1Error",
      reason: "relationDependencyInvalid",
    });
    await fixture.persistence.query(
      `update fx_system_tx_journal_relation_incoming
          set active_head_sha256 = $2
        where session_id = $1`,
      [activation.anchor.sessionId, ready.active.basis.headSha256],
    );

    const prepared = await prepareSessionJournalSeal(store, attempt);
    expect(prepared.journal).toMatchObject({
      finalSyscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      readDependencies: [{
        kind: "appRelationIncoming",
        edgeDefinitionId: binding.edgeDefinitionId,
        targetRowId,
        observedAdjacencyVersion: activation.anchor.snapshotToken.commitSeq,
        activationSequence: ready.active.basis.activationSequence,
        activeHeadSha256Hex:
          encodeBytesToLowercaseHex(ready.active.basis.headSha256),
      }],
      readUsage: {
        documentsRead: 0,
        semanticBytesRead: 0,
      },
      writes: [],
    });
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await fixture.persistence.query(
      `update fx_system_tx_journal
          set relation_read_syscalls = relation_read_syscalls + 1
        where session_id = $1`,
      [activation.anchor.sessionId],
    );
    const staleCounter = await runEffectFailure(store.completeSealEffect(
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    ));
    expect(staleCounter).toBeInstanceOf(SessionJournalSealV1Error);
    expect(staleCounter).toMatchObject({ reason: "stalePreparation" });
    await fixture.persistence.query(
      `update fx_system_tx_journal
          set relation_read_syscalls = relation_read_syscalls - 1
        where session_id = $1`,
      [activation.anchor.sessionId],
    );
    await completeSessionJournalSeal(
      store,
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    );
    const roots = await fixture.persistence.drizzle.select({
      state: fxSystemTransactionJournals.state,
      relationReadSyscalls: fxSystemTransactionJournals.relationReadSyscalls,
      relationDependencyCount:
        fxSystemTransactionJournals.relationDependencyCount,
      relationBaseOccurrences:
        fxSystemTransactionJournals.relationBaseOccurrences,
    }).from(fxSystemTransactionJournals).where(eq(
      fxSystemTransactionJournals.sessionId,
      activation.anchor.sessionId,
    ));
    expect(roots).toEqual([{
      state: "sealed",
      relationReadSyscalls: 1,
      relationDependencyCount: 1,
      relationBaseOccurrences: 0,
    }]);

    await fixture.persistence.drizzle.delete(
      fxSystemApplicationActiveHeads,
    );
    const staleReplay = await runEffectFailure(
      store.runApplicationRelationIncomingReadEffect(relation, operation),
    );
    expect(staleReplay).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "validateSelection",
      reason: "concurrentHead",
    });
  });

  it("reads through staged insert, retarget, and delete overlays", async () => {
    const ready = await readyExactRelationReadFixture();
    const targetRowId = exactRelationCommitRowId(9_051);
    const sourceA = await applyExactRelationSourceCommit(
      ready,
      targetRowId,
      9_052,
      CommitSeqSchema.make(1n),
    );
    const sourceB = await applyExactRelationSourceCommit(
      ready,
      targetRowId,
      9_053,
      CommitSeqSchema.make(2n),
    );
    const sourceC = await applyExactRelationSourceCommit(
      ready,
      targetRowId,
      9_054,
      CommitSeqSchema.make(3n),
    );
    const randomUuid = uuidSequence(25, 26, 27);
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        ready.fixture.pointCommitAuthority,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid,
          randomExecutionClaimOwner: randomUuid,
        },
      ),
      pointMutationSessionActivationFixture(
        ready.fixture.deploymentId,
        decodeReplacementScopeIdV1(ready.readiness.scopeId),
        { evidence: {
          schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
        } },
      ),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a staged relation-read attempt.");
    }
    const store = createSessionJournalStorePersistenceV1(
      ready.fixture.pointCommitAuthority,
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        randomUuid: uuidSequence(28),
        applicationRelations: ready.reads,
      },
    );
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
    }));
    const table = await runEffect(store.resolvePointTableEffect(
      attempt,
      "posts",
    ));
    const relation = await runEffect(
      store.resolveApplicationRelationReadEffect(attempt, ready.capability),
    );
    const validator = issueSetupSeededSyscallValidatorProofV1({
      scopeId: activation.anchor.scopeId,
      schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
    });
    const targetDocumentId = appDocumentIdV1FromRowIdentity({
      tableId: ready.binding.targetTableId,
      rowId: targetRowId,
    });
    const otherTargetDocumentId = appDocumentIdV1FromRowIdentity({
      tableId: ready.binding.targetTableId,
      rowId: relationBuildRowId(9_055),
    });
    await runEffect(store.runPointOperationEffect(table, {
      kind: "patch",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      documentId: sourceA,
      patch: { author: otherTargetDocumentId },
    }, validator));
    await runEffect(store.runPointOperationEffect(table, {
      kind: "delete",
      syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
      documentId: sourceB,
    }, validator));
    const inserted = await runEffect(store.runPointOperationEffect(table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(3n),
      fields: {
        author: targetDocumentId,
        reviewer: targetDocumentId,
      },
    }, validator));
    if (
      inserted.kind !== "completed" ||
      inserted.outcome.kind !== "inserted"
    ) {
      throw new Error("Expected one staged relation source insertion.");
    }

    const read = await runEffect(
      store.runApplicationRelationIncomingReadEffect(relation, {
        kind: "relationIncoming",
        syscallSequence: CommitSyscallSequenceV1Schema.make(4n),
        targetDocumentId,
        limit: 10,
      }),
    );
    expect(read).toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "relationIncomingPage",
        exhausted: true,
      },
    });
    if (
      read.kind !== "completed" ||
      read.outcome.kind !== "relationIncomingPage"
    ) {
      throw new Error("Expected one staged relation page.");
    }
    expect(new Set(read.outcome.items.map(item => item.sourceDocumentId)))
      .toEqual(new Set([sourceC, inserted.outcome.documentId]));
  });

  it("replaces a naturally conflicted running relation read and retries from the new snapshot", async () => {
    const ready = await readyExactRelationReadFixture();
    const targetRowId = exactRelationCommitRowId(9_101);
    const firstSourceDocumentId = await applyExactRelationSourceCommit(
      ready,
      targetRowId,
      9_102,
      CommitSeqSchema.make(1n),
    );
    const randomUuid = uuidSequence(31, 32, 33);
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        ready.fixture.pointCommitAuthority,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid,
          randomExecutionClaimOwner: randomUuid,
        },
      ),
      pointMutationSessionActivationFixture(
        ready.fixture.deploymentId,
        decodeReplacementScopeIdV1(ready.readiness.scopeId),
        { evidence: {
          schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
        } },
      ),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a new natural-conflict attempt.");
    }
    expect(activation.anchor.snapshotToken.commitSeq).toBe(1n);
    const store = createSessionJournalStorePersistenceV1(
      ready.fixture.pointCommitAuthority,
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        applicationRelations: ready.reads,
      },
    );
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
    }));
    const relation = await runEffect(
      store.resolveApplicationRelationReadEffect(attempt, ready.capability),
    );
    const scopeUuid = projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid;
    const claimedAuthority = Object.freeze({
      kind: "claimedAttempt" as const,
      deploymentId: activation.anchor.deploymentId,
      scopeId: activation.anchor.scopeId,
      scopeUuid,
      sessionId: activation.anchor.sessionId,
      attemptFence: activation.anchor.attemptFence,
      storageGeneration: activation.anchor.storageGeneration,
      storageGenerationFence: activation.anchor.storageGenerationFence,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
      executionClaim: activation.executionClaim,
    });
    const execution = await runEffect(
      createStoredOccExecutionEvidenceLoaderV1(
        ready.fixture.pointCommitAuthority,
      ).loadEffect(claimedAuthority),
    );
    if (execution.kind !== "loaded") {
      throw new Error("Expected pristine running-attempt evidence.");
    }

    const secondSourceDocumentId = await applyExactRelationSourceCommit(
      ready,
      targetRowId,
      9_103,
      CommitSeqSchema.make(2n),
    );
    const operation = Object.freeze({
      kind: "relationIncoming" as const,
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      targetDocumentId: appDocumentIdV1FromRowIdentity({
        tableId: ready.binding.targetTableId,
        rowId: targetRowId,
      }),
      limit: 2,
    });
    const conflicted = await runEffect(
      store.runApplicationRelationIncomingReadEffect(relation, operation),
    );
    expect(conflicted).toMatchObject({
      kind: "conflicted",
      delivery: "executed",
      conflict: {
        kind: "relationConflict",
        edgeDefinitionId: ready.binding.edgeDefinitionId,
        targetRowId,
        expectedAdjacencyVersion: 1n,
        actualAdjacencyVersion: 2n,
        snapshotCommitSeq: 1n,
      },
    });
    if (conflicted.kind !== "conflicted") {
      throw new Error("Expected a persisted relation conflict.");
    }
    await ready.fixture.persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
           claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [activation.anchor.sessionId],
    );
    const acquisition = createPointMutationExecutionClaimAcquisitionV1(
      ready.fixture.pointCommitAuthority,
      {
        durationMilliseconds: 60_000,
        randomOwner: uuidSequence(34),
      },
    );
    const acquired = await runEffect(acquisition.acquireEffect(
      selectorFromRelationAnchor(activation.anchor),
    ));
    expect(acquired).toMatchObject({
      kind: "acquired",
      mode: "replaceRelationConflict",
      observation: {
        claimFence: activation.executionClaim.claimFence + 1n,
      },
    });
    if (
      acquired.kind !== "acquired" ||
      acquired.mode !== "replaceRelationConflict"
    ) {
      throw new Error("Expected a fresh relation-conflict takeover claim.");
    }
    await expect(runEffect(
      createPointMutationExecutionClaimAcquisitionV1(
        ready.fixture.pointCommitAuthority,
        {
          durationMilliseconds: 60_000,
          randomOwner: uuidSequence(35),
        },
      ).acquireEffect(selectorFromRelationAnchor(activation.anchor)),
    )).resolves.toMatchObject({
      kind: "busy",
      observation: {
        claimOwner: acquired.observation.claimOwner,
        claimFence: acquired.observation.claimFence,
      },
    });

    const freshAttempt = await runEffect(
      createPointMutationSessionAttemptLoadPersistenceV1(
        ready.fixture.pointCommitAuthority,
      ).loadEffect(selectorFromRelationAnchor(activation.anchor)),
    );
    if (freshAttempt.status !== "loaded") {
      throw new Error("Expected the fresh process to load the conflicted attempt.");
    }
    const recoveredAuthority = Object.freeze({
      kind: "claimedRelationConflict" as const,
      deploymentId: freshAttempt.anchor.deploymentId,
      scopeId: freshAttempt.anchor.scopeId,
      scopeUuid,
      sessionId: freshAttempt.anchor.sessionId,
      attemptFence: freshAttempt.anchor.attemptFence,
      storageGeneration: freshAttempt.anchor.storageGeneration,
      storageGenerationFence: freshAttempt.anchor.storageGenerationFence,
      snapshotToken: freshAttempt.anchor.snapshotToken,
      schemaVersionId: freshAttempt.executionPin.schemaVersionId,
      executionClaim: acquired.observation,
    });
    const executionLoader = createStoredOccExecutionEvidenceLoaderV1(
      ready.fixture.pointCommitAuthority,
    );
    await expect(runEffect(executionLoader.loadEffect(Object.freeze({
      ...recoveredAuthority,
      kind: "claimedAttempt" as const,
    })))).resolves.toEqual({
      kind: "notExecutable",
      reason: "notPristine",
    });
    await expect(runEffect(executionLoader.loadEffect(Object.freeze({
      ...recoveredAuthority,
      executionClaim: activation.executionClaim,
    })))).resolves.toEqual({
      kind: "authorityMismatch",
      reason: "executionClaimChanged",
    });
    const recoveredExecution = await runEffect(
      executionLoader.loadEffect(recoveredAuthority),
    );
    if (recoveredExecution.kind !== "loaded") {
      throw new Error("Expected exact stored conflict authority.");
    }
    expect(recoveredExecution.evidence.session.lifecycle).toBe("running");
    expect(recoveredAuthority).toMatchObject({
      attemptFence: activation.anchor.attemptFence,
      snapshotToken: activation.anchor.snapshotToken,
      executionClaim: acquired.observation,
    });

    const replacementSteps: string[] = [];
    const replacement = createPointMutationAttemptReplacementPortV1(
      ready.fixture.pointCommitAuthority,
      {
        leaseDurationMilliseconds: 60_000,
        randomExecutionClaimOwner: uuidSequence(36, 37),
        afterReplacementStep: event => {
          replacementSteps.push(event.step);
          return Promise.resolve();
        },
      },
    );
    const recovered = await runEffect(
      replacement.recoverRunningRelationConflict(
        runningRelationConflictRecoveryCommandFromStoredOccExecutionV1(
          recoveredAuthority,
          recoveredExecution.evidence,
        ),
      ),
    );
    expect(recovered).toMatchObject({
      request: {
        syscallSequence: operation.syscallSequence,
        edgeDefinitionId: ready.binding.edgeDefinitionId,
        targetRowId,
        limit: operation.limit,
      },
      conflict: {
        edgeDefinitionId: ready.binding.edgeDefinitionId,
        targetRowId,
        expectedAdjacencyVersion: 1n,
        actualAdjacencyVersion: 2n,
        snapshotCommitSeq: 1n,
      },
    });
    expect(Object.isFrozen(recovered)).toBe(true);
    expect(Object.isFrozen(recovered.request)).toBe(true);
    expect(Object.isFrozen(recovered.conflict)).toBe(true);
    const replacementCommand =
      runningRelationConflictAttemptReplacementCommandFromStoredOccExecutionV1(
        recoveredAuthority,
        recoveredExecution.evidence,
        recovered,
      );
    const [removedActiveHead] = await ready.fixture.persistence.drizzle
      .delete(fxSystemApplicationActiveHeads)
      .where(eq(
        fxSystemApplicationActiveHeads.scopeId,
        ready.readiness.scopeId,
      ))
      .returning();
    if (removedActiveHead === undefined) {
      throw new Error("Expected the active relation head to remove.");
    }
    const staleReplacement = await runEffectFailure(
      replacement.replaceRunningRelationConflict(replacementCommand),
    );
    expect(staleReplacement).toBeInstanceOf(
      PointMutationAttemptReplacementStaleAuthorityV1Error,
    );
    expect(staleReplacement).toMatchObject({
      reason: "activeRelationSelectionChanged",
    });
    expect(replacementSteps).toEqual([
      "clockLocked",
      "outcomeRechecked",
      "sessionLocked",
      "leaseLocked",
      "journalRootLocked",
    ]);
    await ready.fixture.persistence.drizzle
      .insert(fxSystemApplicationActiveHeads)
      .values(removedActiveHead);

    replacementSteps.length = 0;
    const replaced = await runEffect(
      replacement.replaceRunningRelationConflict(replacementCommand),
    );
    expect(replaced).toMatchObject({
      kind: "replaced",
      previousAttemptFence: activation.anchor.attemptFence,
      attemptFence: activation.anchor.attemptFence + 1n,
    });
    expect(replacementSteps).toEqual([
      "clockLocked",
      "outcomeRechecked",
      "sessionLocked",
      "leaseLocked",
      "journalRootLocked",
      "activeRelationSelectionValidated",
      "dependenciesValidated",
      "executionClaimDeleted",
      "sessionEnteredRetrying",
      "journalDeleted",
      "leaseDeleted",
      "attemptFenceAdvanced",
      "leaseInserted",
      "journalRootInserted",
      "executionClaimInserted",
      "sessionRunning",
      "beforeCommit",
    ]);
    if (replaced.kind !== "replaced") {
      throw new Error("Expected exact running-conflict replacement.");
    }
    const loaded = await runEffect(
      createPointMutationSessionAttemptLoadPersistenceV1(
        ready.fixture.pointCommitAuthority,
      ).loadEffect({
        deploymentId: activation.anchor.deploymentId,
        scopeId: activation.anchor.scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: replaced.attemptFence,
      }),
    );
    expect(loaded).toMatchObject({
      status: "loaded",
      anchor: { snapshotToken: { commitSeq: 2n } },
      attemptFacet: { kind: "pristineOpen" },
    });
    const retryStore = createSessionJournalStorePersistenceV1(
      ready.fixture.pointCommitAuthority,
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        applicationRelations: ready.reads,
      },
    );
    const retryAttempt = await runEffect(retryStore.openAttemptEffect({
      selector: selectorFromRelationAnchor(loaded.anchor),
      executionClaim: replaced.executionClaim,
      snapshotToken: loaded.anchor.snapshotToken,
      schemaVersionId: loaded.executionPin.schemaVersionId,
    }));
    const retryRelation = await runEffect(
      retryStore.resolveApplicationRelationReadEffect(
        retryAttempt,
        ready.capability,
      ),
    );
    const retried = await runEffect(
      retryStore.runApplicationRelationIncomingReadEffect(
        retryRelation,
        operation,
      ),
    );
    expect(retried).toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "relationIncomingPage",
        exhausted: true,
      },
    });
    if (retried.kind !== "completed") {
      throw new Error("Expected the replacement attempt to read successfully.");
    }
    expect(retried.outcome.items.map(item => item.sourceDocumentId)).toEqual([
      firstSourceDocumentId,
      secondSourceDocumentId,
    ]);
  });

  it("rejects an impossible final relation mismatch before exposing a retry conflict", async () => {
    const ready = await readyExactRelationReadFixture();
    const targetRowId = exactRelationCommitRowId(9_201);
    const lowerTargetRowId = exactRelationCommitRowId(9_199);
    await applyExactRelationSourceCommit(
      ready,
      targetRowId,
      9_202,
      CommitSeqSchema.make(1n),
    );
    await applyExactRelationSourceCommit(
      ready,
      lowerTargetRowId,
      9_203,
      CommitSeqSchema.make(2n),
      true,
    );
    const randomUuid = uuidSequence(41, 42, 43);
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        ready.fixture.pointCommitAuthority,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid,
          randomExecutionClaimOwner: randomUuid,
        },
      ),
      pointMutationSessionActivationFixture(
        ready.fixture.deploymentId,
        decodeReplacementScopeIdV1(ready.readiness.scopeId),
        { evidence: {
          schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
        } },
      ),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a new final-OCC relation attempt.");
    }
    expect(activation.anchor.snapshotToken.commitSeq).toBe(2n);
    const store = createSessionJournalStorePersistenceV1(
      ready.fixture.pointCommitAuthority,
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        applicationRelations: ready.reads,
      },
    );
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
    }));
    const relation = await runEffect(
      store.resolveApplicationRelationReadEffect(attempt, ready.capability),
    );
    const firstOperation = Object.freeze({
      kind: "relationIncoming" as const,
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      targetDocumentId: appDocumentIdV1FromRowIdentity({
        tableId: ready.binding.targetTableId,
        rowId: targetRowId,
      }),
      limit: 1,
    });
    const secondOperation = Object.freeze({
      kind: "relationIncoming" as const,
      syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
      targetDocumentId: appDocumentIdV1FromRowIdentity({
        tableId: ready.binding.targetTableId,
        rowId: lowerTargetRowId,
      }),
      limit: 1,
    });
    const firstRead = await runEffect(
      store.runApplicationRelationIncomingReadEffect(relation, firstOperation),
    );
    const secondRead = await runEffect(
      store.runApplicationRelationIncomingReadEffect(relation, secondOperation),
    );
    expect(firstRead).toMatchObject({ kind: "completed" });
    expect(secondRead).toMatchObject({ kind: "completed" });
    await ready.fixture.persistence.query(
      `update fx_system_tx_journal_relation_incoming
          set active_head_sha256 = decode(repeat('ef', 32), 'hex')
        where session_id = $1 and target_row_id = $2`,
      [
        activation.anchor.sessionId,
        appRowIdHexV1ToBytes(targetRowId),
      ],
    );
    const divergentSelection = await runEffectFailure(
      store.prepareSealEffect(attempt),
    );
    expect(divergentSelection).toMatchObject({
      _tag: "SessionJournalStorageCorruptionV1Error",
      reason: "relationDependencyInvalid",
    });
    await ready.fixture.persistence.query(
      `update fx_system_tx_journal_relation_incoming
          set active_head_sha256 = $3
        where session_id = $1 and target_row_id = $2`,
      [
        activation.anchor.sessionId,
        appRowIdHexV1ToBytes(targetRowId),
        ready.active.basis.headSha256,
      ],
    );
    const prepared = await prepareSessionJournalSeal(store, attempt);
    const journal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await completeSessionJournalSeal(
      store,
      prepared.preparation,
      journal,
      successfulResult,
    );
    const authority = relationAuthorityFromAnchor(
      activation.anchor,
      ready.fixture.relation.binding.schemaVersionId,
      activation.executionClaim,
    );
    const loader = createStoredAttemptEvidenceLoaderV1(
      ready.fixture.pointCommitAuthority,
    );
    const running = await runEffect(loader.loadEffect(authority));
    if (running.kind !== "loaded") {
      throw new Error("Expected sealed running relation evidence.");
    }
    await runEffect(
      createPointCommitFinishingTransitionPortV1(
        ready.fixture.pointCommitAuthority,
      ).enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          authority,
          running.evidence,
        ),
      ),
    );
    const finishing = await runEffect(loader.loadFinishingEffect(
      selectorFromRelationAnchor(activation.anchor),
    ));
    if (finishing.kind !== "loaded") {
      throw new Error("Expected finishing relation evidence.");
    }
    const command =
      await pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(
        authority,
        finishing.evidence,
      );
    expect(command.relationDependencies).toEqual([
      {
        kind: "appRelationIncoming",
        edgeDefinitionId: ready.binding.edgeDefinitionId,
        targetRowId: lowerTargetRowId,
        observedAdjacencyVersion: 2n,
        activationSequence: ready.active.basis.activationSequence,
        activeHeadSha256Hex:
          encodeBytesToLowercaseHex(ready.active.basis.headSha256),
      },
      {
        kind: "appRelationIncoming",
        edgeDefinitionId: ready.binding.edgeDefinitionId,
        targetRowId,
        observedAdjacencyVersion: 1n,
        activationSequence: ready.active.basis.activationSequence,
        activeHeadSha256Hex:
          encodeBytesToLowercaseHex(ready.active.basis.headSha256),
      },
    ]);
    const transactionSteps: string[] = [];
    const observedRelationQueries: string[] = [];
    const rollback = createPointCommitRollbackProofPortV1(
      ready.fixture.pointCommitAuthority,
      {
        applicationRelations: ready.fixture.relationCommit,
        afterTransactionStep: event => {
          transactionSteps.push(event.step);
          return Promise.resolve();
        },
        observeQuery: (query) => {
          if (query.name === "validateRelationDependencies") {
            observedRelationQueries.push(query.sql);
          }
        },
      },
    );
    const unchanged = await runEffect(rollback.prove(command));
    expect(unchanged).toEqual({ kind: "wouldCommit" });
    expect(transactionSteps[0]).toBe("clockLocked");
    expect(transactionSteps[1]).toBe("activeRelationSelectionValidated");
    expect(transactionSteps).toContain("dependenciesValidated");
    expect(transactionSteps.at(-1)).toBe("beforeRollback");
    expect(observedRelationQueries).toHaveLength(1);

    const staleRelationDependencies = Object.freeze(
      command.relationDependencies.map(dependency => Object.freeze({
        ...dependency,
        activationSequence: ApplicationActivationSequenceV1Schema.make(
          dependency.activationSequence + 1n,
        ),
      })),
    );
    const staleCommand = Object.freeze({
      ...command,
      relationDependencies: staleRelationDependencies,
    });
    transactionSteps.length = 0;
    observedRelationQueries.length = 0;
    const staleSelection = await runEffectFailure(
      rollback.prove(staleCommand),
    );
    expect(staleSelection).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
    expect(staleSelection).toMatchObject({
      reason: "activeRelationSelectionChanged",
    });
    expect(transactionSteps).toEqual(["clockLocked"]);
    expect(observedRelationQueries).toHaveLength(0);

    await setExactRelationAdjacencyVersion(
      ready,
      targetRowId,
      CommitSeqSchema.make(2n),
    );
    transactionSteps.length = 0;
    const impossible = await runEffectFailure(rollback.prove(command));
    expect(impossible).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(impossible).toMatchObject({ reason: "occEvidenceInvalid" });
    expect(observedRelationQueries).toHaveLength(1);

    await advanceExactRelationScopeClock(ready, CommitSeqSchema.make(3n));
    await setExactRelationAdjacencyVersion(
      ready,
      lowerTargetRowId,
      CommitSeqSchema.make(3n),
    );
    await setExactRelationAdjacencyVersion(
      ready,
      targetRowId,
      CommitSeqSchema.make(3n),
    );
    observedRelationQueries.length = 0;
    const retryable = await runEffectFailure(rollback.prove(command));
    expect(retryable).toBeInstanceOf(PointCommitConflictV1Error);
    expect(retryable).toMatchObject({
      conflict: {
        kind: "appRelationIncoming",
        edgeDefinitionId: ready.binding.edgeDefinitionId,
        targetRowId: lowerTargetRowId,
      },
      snapshotCommitSeq: 2n,
      currentCommitSeq: 3n,
    });
    expect(observedRelationQueries).toHaveLength(1);

    if (!(retryable instanceof PointCommitConflictV1Error)) {
      throw new Error("Expected one exact relation conflict for replacement.");
    }
    const replacementCommand =
      pointMutationAttemptReplacementCommandFromPointCommitCommandV1(
        command,
        retryable,
      );
    const replacementSteps: string[] = [];
    const replacement = createPointMutationAttemptReplacementPortV1(
      ready.fixture.pointCommitAuthority,
      {
        leaseDurationMilliseconds: 60_000,
        randomExecutionClaimOwner: uuidSequence(44, 45, 46),
        afterReplacementStep: event => {
          replacementSteps.push(event.step);
          return Promise.resolve();
        },
      },
    );
    const staleReplacement = await runEffectFailure(replacement.replace(
      Object.freeze({
        ...replacementCommand,
        relationDependencies: staleRelationDependencies,
      }),
    ));
    expect(staleReplacement).toBeInstanceOf(
      PointMutationAttemptReplacementStaleAuthorityV1Error,
    );
    expect(staleReplacement).toMatchObject({
      reason: "activeRelationSelectionChanged",
    });
    expect(replacementSteps).toEqual([
      "clockLocked",
      "outcomeRechecked",
      "sessionLocked",
    ]);

    replacementSteps.length = 0;
    const replaced = await runEffect(replacement.replace(replacementCommand));
    expect(replaced).toMatchObject({
      kind: "replaced",
      previousAttemptFence: activation.anchor.attemptFence,
      attemptFence: activation.anchor.attemptFence + 1n,
    });
    expect(replacementSteps.slice(0, 7)).toEqual([
      "clockLocked",
      "outcomeRechecked",
      "sessionLocked",
      "activeRelationSelectionValidated",
      "leaseLocked",
      "journalRootLocked",
      "dependenciesValidated",
    ]);
    replacementSteps.length = 0;
    await expect(runEffect(replacement.replace(Object.freeze({
      ...replacementCommand,
      relationDependencies: staleRelationDependencies,
    })))).resolves.toMatchObject({
      kind: "alreadyReplaced",
      previousAttemptFence: activation.anchor.attemptFence,
      attemptFence: activation.anchor.attemptFence + 1n,
    });
    expect(replacementSteps).not.toContain(
      "activeRelationSelectionValidated",
    );
  });

  it("keeps relation A1 stale across relation B2 and same-revision A3", async () => {
    const ready = await readyExactRelationReadFixture();
    const second = await prepareAdditionalRelationRevision(ready.fixture);
    expect(ready.active.basis.activationSequence).toBe(1n);
    const sealed = await prepareSealedRelationAttempt(ready);

    const relationB2 = await runEffect(ready.fixture.relationActivation.activate({
      revisionId: second.readiness.revisionId,
      expectedActiveHead: ready.active.expectedActiveHead,
    }));
    expect(relationB2).toMatchObject({
      status: "activated",
      disposition: "inserted",
      activationSequence: 2n,
      previousActivationSequence: 1n,
      revisionId: second.readiness.revisionId,
    });
    const activeB2 = await runEffect(
      ready.fixture.relationActivation.readActive(),
    );
    expect(Result.isSuccess(
      claimApplicationRelationActiveSelection(activeB2.selection),
    )).toBe(true);

    await ready.fixture.persistence.query(
      "alter table fx_app_edge_current rename to fx_app_edge_current_stale_guard",
    );
    let staleReplayB2: unknown;
    try {
      staleReplayB2 = await runEffectFailure(
        sealed.store.runApplicationRelationIncomingReadEffect(
          sealed.relation,
          sealed.operation,
        ),
      );
    } finally {
      await ready.fixture.persistence.query(
        "alter table fx_app_edge_current_stale_guard rename to fx_app_edge_current",
      );
    }
    expect(staleReplayB2).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "validateSelection",
      reason: "concurrentHead",
    });

    await runEffect(
      createPointCommitFinishingTransitionPortV1(
        ready.fixture.pointCommitAuthority,
      ).enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          sealed.authority,
          sealed.running.evidence,
        ),
      ),
    );
    const finishing = await runEffect(sealed.loader.loadFinishingEffect(
      selectorFromRelationAnchor(sealed.activation.anchor),
    ));
    if (finishing.kind !== "loaded") {
      throw new Error("Expected finishing A1 relation evidence.");
    }
    const command =
      await pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(
        sealed.authority,
        finishing.evidence,
      );
    expect(command.relationDependencies).toEqual([
      expect.objectContaining({
        kind: "appRelationIncoming",
        activationSequence: 1n,
        activeHeadSha256Hex:
          encodeBytesToLowercaseHex(ready.active.basis.headSha256),
      }),
    ]);
    const transactionSteps: string[] = [];
    const relationQueries: string[] = [];
    const rollback = createPointCommitRollbackProofPortV1(
      ready.fixture.pointCommitAuthority,
      {
        applicationRelations: ready.fixture.relationCommit,
        afterTransactionStep: event => {
          transactionSteps.push(event.step);
          return Promise.resolve();
        },
        observeQuery: query => {
          if (query.name === "validateRelationDependencies") {
            relationQueries.push(query.sql);
          }
        },
      },
    );
    const staleFinishB2 = await runEffectFailure(rollback.prove(command));
    expect(staleFinishB2).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
    expect(staleFinishB2).toMatchObject({
      reason: "activeRelationSelectionChanged",
    });
    expect(transactionSteps).toEqual(["clockLocked"]);
    expect(relationQueries).toHaveLength(0);

    const relationA3 = await runEffect(ready.fixture.relationActivation.activate({
      revisionId: ready.readiness.revisionId,
      expectedActiveHead: activeB2.expectedActiveHead,
    }));
    expect(relationA3).toMatchObject({
      status: "activated",
      disposition: "inserted",
      activationSequence: 3n,
      previousActivationSequence: 2n,
      revisionId: ready.readiness.revisionId,
    });
    const activeA3 = await runEffect(
      ready.fixture.relationActivation.readActive(),
    );
    expect(Result.isSuccess(
      claimApplicationRelationActiveSelection(activeA3.selection),
    )).toBe(true);
    const [staleA1AfterA3, staleB2AfterA3, currentA3] =
      await ready.fixture.persistence.drizzle.transaction(async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(
            tx,
            ready.fixture.authority.scopeId,
          ),
        );
        return Promise.all([
          runEffectFailure(validateApplicationRelationActiveSelectionInTransaction(
            ready.active.selection,
            tx,
            clock,
          )),
          runEffectFailure(validateApplicationRelationActiveSelectionInTransaction(
            activeB2.selection,
            tx,
            clock,
          )),
          runEffect(validateApplicationRelationActiveSelectionInTransaction(
            activeA3.selection,
            tx,
            clock,
          )),
        ]);
      });
    expect(staleA1AfterA3).toMatchObject({ reason: "concurrentHead" });
    expect(staleB2AfterA3).toMatchObject({ reason: "concurrentHead" });
    expect(currentA3.activationSequence).toBe(3n);

    transactionSteps.length = 0;
    relationQueries.length = 0;
    const staleFinishA3 = await runEffectFailure(rollback.prove(command));
    expect(staleFinishA3).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
    expect(staleFinishA3).toMatchObject({
      reason: "activeRelationSelectionChanged",
    });
    expect(transactionSteps).toEqual(["clockLocked"]);
    expect(relationQueries).toHaveLength(0);

    const activations = await ready.fixture.persistence.drizzle.select().from(
      fxSystemApplicationActivations,
    ).orderBy(asc(fxSystemApplicationActivations.activationSequence));
    expect(activations.map(activation => ({
      activationSequence: activation.activationSequence,
      previousActivationSequence: activation.previousActivationSequence,
      revisionId: activation.revisionId,
      readinessContractVersion: activation.readinessContractVersion,
    }))).toEqual([
      {
        activationSequence: 1n,
        previousActivationSequence: null,
        revisionId: ready.readiness.revisionId,
        readinessContractVersion: 2,
      },
      {
        activationSequence: 2n,
        previousActivationSequence: 1n,
        revisionId: second.readiness.revisionId,
        readinessContractVersion: 2,
      },
      {
        activationSequence: 3n,
        previousActivationSequence: 2n,
        revisionId: ready.readiness.revisionId,
        readinessContractVersion: 2,
      },
    ]);
    expect(new Set([
      ready.active.expectedActiveHead.headSha256,
      activeB2.expectedActiveHead.headSha256,
      activeA3.expectedActiveHead.headSha256,
    ]).size).toBe(3);
    const heads = await ready.fixture.persistence.drizzle.select().from(
      fxSystemApplicationActiveHeads,
    );
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({
      activationSequence: 3n,
      revisionId: ready.readiness.revisionId,
      readinessContractVersion: 2,
      relationCount: ready.readiness.relationCount,
    });
  });

  it("moves one active head from relation A1 through Legacy B2 to relation C3", async () => {
    const ready = await readyExactRelationReadFixture();
    const relationA1 = ready.active;
    expect(relationA1.basis.activationSequence).toBe(1n);

    const legacy = await prepareLegacyRevisionInRelationFixture(ready.fixture);

    const retainedRelationA1 = await runEffect(
      ready.fixture.relationActivation.readActive(),
    );
    expect(retainedRelationA1.expectedActiveHead).toEqual(
      relationA1.expectedActiveHead,
    );
    expect(Result.isSuccess(
      claimApplicationRelationActiveSelection(retainedRelationA1.selection),
    )).toBe(true);
    const validatedRelationA1 = await ready.fixture.persistence.drizzle
      .transaction(async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(
            tx,
            ready.fixture.authority.scopeId,
          ),
        );
        return runEffect(
          validateApplicationRelationActiveSelectionInTransaction(
            relationA1.selection,
            tx,
            clock,
          ),
        );
      });
    expect(validatedRelationA1.activationSequence).toBe(1n);

    const coldRelationActivation = makeApplicationActivationRepository({
      deploymentId: ready.fixture.deploymentId,
      readiness: ready.fixture.legacyReadiness,
      relationReadiness: makeApplicationRelationReadinessFoldRepository(
        ready.fixture.foldContext,
      ),
      authority: ready.fixture.authorityPorts,
    });
    const coldRelationA1 = await runEffect(coldRelationActivation.readActive());
    expect(coldRelationA1.expectedActiveHead).toEqual(
      relationA1.expectedActiveHead,
    );
    expect(Result.isSuccess(
      claimApplicationRelationActiveSelection(coldRelationA1.selection),
    )).toBe(true);

    const legacyB2 = await runEffect(
      ready.fixture.relationActivation.activate({
        revisionId: legacy.readiness.revisionId,
        expectedActiveHead: relationA1.expectedActiveHead,
      }),
    );
    expect(legacyB2).toMatchObject({
      status: "activated",
      disposition: "inserted",
      revisionId: legacy.readiness.revisionId,
      activationSequence: 2n,
      previousActivationSequence: 1n,
    });
    const activeLegacyB2 = await runEffect(
      ready.fixture.relationActivation.readActive(),
    );
    const legacyBasis = Result.getOrThrow(
      claimApplicationActiveSelection(activeLegacyB2.selection),
    );
    expect(legacyBasis).toMatchObject({
      revisionId: legacy.readiness.revisionId,
      activationSequence: 2n,
    });
    expect(Result.isFailure(
      claimApplicationRelationActiveSelection(activeLegacyB2.selection),
    )).toBe(true);
    const staleRelationA1 = await ready.fixture.persistence.drizzle
      .transaction(async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(
            tx,
            ready.fixture.authority.scopeId,
          ),
        );
        return runEffectFailure(
          validateApplicationRelationActiveSelectionInTransaction(
            relationA1.selection,
            tx,
            clock,
          ),
        );
      });
    expect(staleRelationA1).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "validateSelection",
      reason: "concurrentHead",
    });

    await settleCandidateValidation(
      ready.fixture.candidateValidation,
      ready.fixture.deploymentId,
      ready.fixture.relation.binding.schemaVersionId,
    );
    const retainedLegacyB2 = await runEffect(
      ready.fixture.relationActivation.readActive(),
    );
    expect(retainedLegacyB2.expectedActiveHead).toEqual(
      activeLegacyB2.expectedActiveHead,
    );
    expect(Result.isSuccess(
      claimApplicationActiveSelection(retainedLegacyB2.selection),
    )).toBe(true);

    const relationC = await prepareAdditionalRelationRevision(ready.fixture);
    const relationC3 = await runEffect(
      ready.fixture.relationActivation.activate({
        revisionId: relationC.readiness.revisionId,
        expectedActiveHead: retainedLegacyB2.expectedActiveHead,
      }),
    );
    expect(relationC3).toMatchObject({
      status: "activated",
      disposition: "inserted",
      revisionId: relationC.readiness.revisionId,
      activationSequence: 3n,
      previousActivationSequence: 2n,
    });
    const activeRelationC3 = await runEffect(
      ready.fixture.relationActivation.readActive(),
    );
    const relationBasis = Result.getOrThrow(
      claimApplicationRelationActiveSelection(activeRelationC3.selection),
    );
    expect(relationBasis).toMatchObject({
      revisionId: relationC.readiness.revisionId,
      activationSequence: 3n,
      relationCount: relationC.readiness.relationCount,
    });
    expect(Result.isFailure(
      claimApplicationActiveSelection(activeRelationC3.selection),
    )).toBe(true);

    const [staleLegacyB2, currentRelationC3] =
      await ready.fixture.persistence.drizzle.transaction(async tx => {
        const clock = await runEffect(
          lockScopeClockForShareInTransactionEffect(
            tx,
            ready.fixture.authority.scopeId,
          ),
        );
        return Promise.all([
          runEffectFailure(validateApplicationActiveSelectionInTransaction(
            retainedLegacyB2.selection,
            tx,
            clock,
          )),
          runEffect(validateApplicationRelationActiveSelectionInTransaction(
            activeRelationC3.selection,
            tx,
            clock,
          )),
        ]);
      });
    expect(staleLegacyB2).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "validateSelection",
      reason: "concurrentHead",
    });
    expect(currentRelationC3.activationSequence).toBe(3n);

    const activations = await ready.fixture.persistence.drizzle.select().from(
      fxSystemApplicationActivations,
    ).orderBy(asc(fxSystemApplicationActivations.activationSequence));
    expect(activations.map(row => ({
      activationSequence: row.activationSequence,
      previousActivationSequence: row.previousActivationSequence,
      revisionId: row.revisionId,
      readinessContractVersion: row.readinessContractVersion,
      legacyWitness: row.legacyReadinessSha256 !== null,
      relationWitness: row.relationReadinessSha256 !== null,
      relationSetWitness: row.relationSetReadinessSha256 !== null,
      relationCount: row.relationCount,
    }))).toEqual([
      {
        activationSequence: 1n,
        previousActivationSequence: null,
        revisionId: ready.readiness.revisionId,
        readinessContractVersion: 2,
        legacyWitness: false,
        relationWitness: true,
        relationSetWitness: true,
        relationCount: ready.readiness.relationCount,
      },
      {
        activationSequence: 2n,
        previousActivationSequence: 1n,
        revisionId: legacy.readiness.revisionId,
        readinessContractVersion: 1,
        legacyWitness: true,
        relationWitness: false,
        relationSetWitness: false,
        relationCount: null,
      },
      {
        activationSequence: 3n,
        previousActivationSequence: 2n,
        revisionId: relationC.readiness.revisionId,
        readinessContractVersion: 2,
        legacyWitness: false,
        relationWitness: true,
        relationSetWitness: true,
        relationCount: relationC.readiness.relationCount,
      },
    ]);
    expect(new Set([
      relationA1.expectedActiveHead.headSha256,
      legacyB2.expectedActiveHead.headSha256,
      relationC3.expectedActiveHead.headSha256,
    ]).size).toBe(3);
    const finalHeads = await ready.fixture.persistence.drizzle.select().from(
      fxSystemApplicationActiveHeads,
    );
    expect(finalHeads).toHaveLength(1);
    expect(finalHeads[0]).toMatchObject({
      activationSequence: 3n,
      revisionId: relationC.readiness.revisionId,
      readinessContractVersion: 2,
      relationCount: relationC.readiness.relationCount,
    });
  });

  it("atomically folds two ordered relations, exactly replays, and stays outside legacy activation", async () => {
    const fixture = await relationReadinessFixture();
    await prepareReadinessEvidence(fixture);

    const first = await runEffect(fixture.fold.settle(fixture.input));
    const replay = await runEffect(fixture.fold.settle(fixture.input));
    expect(first).toMatchObject({
      status: "ready",
      disposition: "inserted",
      relationCount: 2,
      schemaVersionId: fixture.relation.binding.schemaVersionId,
    });
    expect(replay).toMatchObject({
      status: "ready",
      disposition: "replayed",
      relationCount: 2,
    });
    if (first.status !== "ready" || replay.status !== "ready") {
      throw new Error("Expected relation-aware Application readiness.");
    }
    expect(replay.readinessSha256).toBe(first.readinessSha256);
    expect(replay.readinessBytes).toEqual(first.readinessBytes);
    expect(replay.relationSetReadinessSha256).toBe(
      first.relationSetReadinessSha256,
    );
    expect(replay.readyAt).toEqual(first.readyAt);
    expect(hasApplicationRelationReadinessFoldAuthority(
      fixture.fold,
      first,
    )).toBe(true);
    expect(hasApplicationRelationReadinessFoldAuthority(
      fixture.fold,
      Object.freeze({ ...first }),
    )).toBe(false);
    const callerBytes = first.readinessBytes;
    callerBytes[0] = callerBytes[0] === 0 ? 1 : 0;
    const callerReadyAt = first.readyAt;
    callerReadyAt.setTime(0);
    expect(hasApplicationRelationReadinessFoldAuthority(
      fixture.fold,
      first,
    )).toBe(true);
    expect(first.readinessBytes).toEqual(replay.readinessBytes);
    expect(first.readyAt).toEqual(replay.readyAt);
    const schemaAuthority = await runEffect(
      fixture.foldContext.schema.resolve({
        deploymentId: fixture.deploymentId,
        applicationManifestSha256: fixture.publication.manifestSha256,
        manifest: fixture.manifest,
      }),
    );
    const manifestTables = schemaAuthority.manifest.tableDefinitions.tables;
    const firstManifestTable = manifestTables[0];
    if (firstManifestTable === undefined) {
      throw new Error("Expected a relation-aware schema manifest table.");
    }
    expect(Object.isFrozen(schemaAuthority.manifest)).toBe(true);
    expect(Object.isFrozen(manifestTables)).toBe(true);
    expect(Object.isFrozen(firstManifestTable)).toBe(true);
    expect(Reflect.set(firstManifestTable, "testMutation", true)).toBe(false);
    expect(Reflect.has(firstManifestTable, "testMutation")).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(first.readinessBytes)))
      .toMatchObject({
        format: "flarex.application-readiness",
        version: 2,
        status: "ready",
        scopeId: fixture.authority.scopeId,
        deploymentId: fixture.deploymentId,
        revisionId: fixture.input.revisionId,
        manifestSha256: fixture.publication.manifestSha256,
        publicationSha256: fixture.publication.publicationSha256,
        applicationSchemaSha256:
          fixture.publication.applicationSchemaSha256,
        schemaVersionId: fixture.relation.binding.schemaVersionId,
        schemaManifestSha256:
          fixture.publication.schemaManifestSha256,
        manifestSchemaBindingSha256:
          fixture.publication.manifestSchemaBindingSha256,
        boundPublicationSha256:
          fixture.publication.boundPublicationSha256,
        relationSet: {
          version: 1,
          frontierCommitSeq: "0",
          relationCount: 2,
          readinessSha256: first.relationSetReadinessSha256,
        },
        coldReceipts: [],
      });

    const [roots, children, taskDefinitions] = await Promise.all([
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadiness,
      ),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadinessRelations,
      ).orderBy(asc(fxSystemApplicationReadinessRelations.relationOrdinal)),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationTaskDefinitions,
      ),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      readinessCodecVersion: 2,
      relationSetCodecVersion: 1,
      relationCount: 2,
      readinessBytes: first.readinessBytes,
    });
    expect(encodeBytesToLowercaseHex(
      roots[0]?.relationSetReadinessSha256 ?? new Uint8Array(),
    )).toBe(first.relationSetReadinessSha256);
    expect(children.map(child => child.relationOrdinal)).toEqual([1, 2]);
    expect(children.map(child => child.relationId)).toEqual(
      fixture.relation.binding.relationBindings.map(binding =>
        binding.relationId
      ),
    );
    expect(children.every(child =>
      child.readinessKind === "physical" &&
      child.physicalAttemptFence !== null &&
      child.semanticAttemptFence === null
    )).toBe(true);
    const firstChild = children[0];
    const secondChild = children[1];
    if (firstChild === undefined || secondChild === undefined) {
      throw new Error("Expected two persisted relation readiness children.");
    }
    await expect(fixture.persistence.drizzle.update(
      fxSystemApplicationReadinessRelations,
    ).set({
      relationReadinessSha256: secondChild.relationReadinessSha256,
    }).where(and(
      eq(fxSystemApplicationReadinessRelations.scopeId, firstChild.scopeId),
      eq(
        fxSystemApplicationReadinessRelations.revisionId,
        firstChild.revisionId,
      ),
      eq(
        fxSystemApplicationReadinessRelations.relationOrdinal,
        firstChild.relationOrdinal,
      ),
    ))).rejects.toThrow();
    expect(taskDefinitions).toHaveLength(1);
    expect(taskDefinitions[0]?.taskId).toBe("tasks.users.get");

    const activationResult = await runEffect(Effect.result(
      fixture.legacyActivation.activate({
        revisionId: fixture.input.revisionId,
        expectedActiveHead: null,
      }),
    ));
    expect(Result.isFailure(activationResult)).toBe(true);
    if (Result.isFailure(activationResult)) {
      expect(activationResult.failure).toMatchObject({
        _tag: "ApplicationReadinessError",
        operation: "settle",
        reason: "storedState",
      });
    }
    expect(fixture.legacyColdCalls()).toBe(0);
    const [legacySchemaAuthorities, legacyPublications, legacyTaskCatalogs,
      legacyTaskDefinitions, legacyReadiness, legacyActivations, legacyHeads] =
      await Promise.all([
        fixture.persistence.drizzle.select().from(
          fxControlApplicationSchemaAuthoritiesV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationPublicationsV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationTaskCatalogsV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationTaskDefinitionsV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationReadinessV1,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationActivations,
        ),
        fixture.persistence.drizzle.select().from(
          fxSystemApplicationActiveHeads,
        ),
      ]);
    expect(legacySchemaAuthorities).toHaveLength(0);
    expect(legacyPublications).toHaveLength(0);
    expect(legacyTaskCatalogs).toHaveLength(0);
    expect(legacyTaskDefinitions).toHaveLength(0);
    expect(legacyReadiness).toHaveLength(0);
    expect(legacyActivations).toHaveLength(0);
    expect(legacyHeads).toHaveLength(0);
  });

  it("cold-reconstructs, activates, validates, and serves one exact relation head", async () => {
    const fixture = await relationReadinessFixture();
    await prepareReadinessEvidence(fixture);
    const prepared = await runEffect(fixture.fold.settle(fixture.input));
    if (prepared.status !== "ready") {
      throw new Error("Expected prepared relation-aware Application readiness.");
    }
    const beforeColdRead = await relationActivationInventory(fixture);
    const stored = await runEffect(fixture.fold.readReady(fixture.input));
    if (stored.status !== "ready") {
      throw new Error("Expected stored relation-aware Application readiness.");
    }
    expect(stored).toMatchObject({
      status: "ready",
      disposition: "replayed",
      scopeId: prepared.scopeId,
      revisionId: prepared.revisionId,
      readinessSha256: prepared.readinessSha256,
      relationSetReadinessSha256: prepared.relationSetReadinessSha256,
      relationCount: prepared.relationCount,
    });
    expect(stored.readinessBytes).toEqual(prepared.readinessBytes);
    expect(stored.readyAt).toEqual(prepared.readyAt);

    const recreatedFold = makeApplicationRelationReadinessFoldRepository(
      fixture.foldContext,
    );
    const recreatedStored = await runEffect(recreatedFold.readReady(
      fixture.input,
    ));
    if (recreatedStored.status !== "ready") {
      throw new Error("Expected recreated repository cold reconstruction.");
    }
    expect(recreatedStored).toMatchObject({
      readinessSha256: prepared.readinessSha256,
      relationSetReadinessSha256: prepared.relationSetReadinessSha256,
      relationCount: prepared.relationCount,
    });
    expect(hasApplicationRelationReadinessFoldAuthority(
      fixture.fold,
      recreatedStored,
    )).toBe(false);
    expect(hasApplicationRelationReadinessFoldAuthority(
      recreatedFold,
      recreatedStored,
    )).toBe(true);
    expect(await relationActivationInventory(fixture)).toEqual(beforeColdRead);

    await fixture.persistence.drizzle.transaction(async tx => {
      const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(
        tx,
        fixture.authority.scopeId,
      ));
      const preparedValidation = await runEffect(
        validateApplicationRelationReadinessForActivationInTransaction(
          fixture.fold,
          prepared,
          tx,
          clock,
        ),
      );
      const storedValidation = await runEffect(
        validateStoredApplicationRelationReadinessForActivationInTransaction(
          fixture.fold,
          stored,
          tx,
          clock,
        ),
      );
      const recreatedValidation = await runEffect(
        validateStoredApplicationRelationReadinessForActivationInTransaction(
          recreatedFold,
          recreatedStored,
          tx,
          clock,
        ),
      );
      expect(preparedValidation).toMatchObject({
        status: "ready",
        basis: {
          revisionId: prepared.revisionId,
          relationCount: 2,
        },
      });
      expect(storedValidation).toMatchObject({
        status: "ready",
        basis: {
          revisionId: prepared.revisionId,
          relationCount: 2,
        },
      });
      expect(recreatedValidation).toMatchObject({
        status: "ready",
        basis: { revisionId: prepared.revisionId },
      });

      const wrongIssuanceKind = await runEffectFailure(
        validateApplicationRelationReadinessForActivationInTransaction(
          fixture.fold,
          stored,
          tx,
          clock,
        ),
      );
      const foreignRepository = await runEffectFailure(
        validateStoredApplicationRelationReadinessForActivationInTransaction(
          recreatedFold,
          stored,
          tx,
          clock,
        ),
      );
      const structuralCopy = await runEffectFailure(
        validateStoredApplicationRelationReadinessForActivationInTransaction(
          fixture.fold,
          Object.freeze({ ...stored }),
          tx,
          clock,
        ),
      );
      expect(wrongIssuanceKind).toMatchObject({
        _tag: "ApplicationRelationReadinessFoldError",
        operation: "validate",
        reason: "invalidComposition",
      });
      expect(foreignRepository).toMatchObject({
        _tag: "ApplicationRelationReadinessFoldError",
        operation: "validate",
        reason: "invalidComposition",
      });
      expect(structuralCopy).toMatchObject({
        _tag: "ApplicationRelationReadinessFoldError",
        operation: "validate",
        reason: "invalidComposition",
      });
    });

    const inserted = await runEffect(fixture.relationActivation.activate({
      revisionId: prepared.revisionId,
      expectedActiveHead: null,
    }));
    const replayed = await runEffect(fixture.relationActivation.activate({
      revisionId: prepared.revisionId,
      expectedActiveHead: null,
    }));
    expect(inserted).toMatchObject({
      status: "activated",
      disposition: "inserted",
      activationSequence: 1n,
      previousActivationSequence: null,
      readinessSha256: prepared.readinessSha256,
    });
    expect(replayed).toMatchObject({ ...inserted, disposition: "replayed" });

    const active = await runEffect(fixture.relationActivation.readActive());
    expect(active).toMatchObject({
      basis: {
        revisionId: prepared.revisionId,
        relationCount: 2,
        relationSetReadinessSha256: expect.any(Uint8Array),
      },
    });
    expect(Result.isFailure(
      claimApplicationActiveSelection(active.selection),
    )).toBe(true);
    expect(Result.isSuccess(
      claimApplicationRelationActiveSelection(active.selection),
    )).toBe(true);
    await expect(runEffect(
      validateApplicationRelationActiveSelectionForReadiness(
        fixture.fold,
        active.selection,
        fixture.deploymentId,
        fixture.authorityPorts,
      ),
    )).resolves.toMatchObject({ revisionId: prepared.revisionId });
    expect(await runEffectFailure(
      validateApplicationRelationActiveSelectionForReadiness(
        recreatedFold,
        active.selection,
        fixture.deploymentId,
        fixture.authorityPorts,
      ),
    )).toMatchObject({
      _tag: "ApplicationActivationError",
      reason: "invalidComposition",
    });
    expect(Result.isFailure(
      claimApplicationRelationActiveSelection(Object.freeze({
        ...active.selection,
      })),
    )).toBe(true);

    const activeBinding = fixture.relation.binding.relationBindings[0];
    if (activeBinding === undefined) {
      throw new Error("Expected an active relation binding.");
    }
    const inactiveEdgeDefinitionId = decodeCatalogEdgeDefinitionId(
      2_147_483_647,
    );
    const [validatedSelection, serving, inactive] =
      await fixture.persistence.drizzle.transaction(async tx => {
        const clock = await runEffect(
          lockScopeClockForUpdateInTransactionEffect(
            tx,
            fixture.authority.scopeId,
          ),
        );
        return Promise.all([
          runEffect(validateApplicationRelationActiveSelectionInTransaction(
            active.selection,
            tx,
            clock,
          )),
          runEffect(
            inspectApplicationRelationServingDefinitionInTransactionEffect(
              fixture.servingInspector,
              tx,
              {
                authority: active.basis.authority,
                clock,
                edgeDefinitionId: activeBinding.edgeDefinitionId,
              },
            ),
          ),
          runEffect(
            inspectApplicationRelationServingDefinitionInTransactionEffect(
              fixture.servingInspector,
              tx,
              {
                authority: active.basis.authority,
                clock,
                edgeDefinitionId: inactiveEdgeDefinitionId,
              },
            ),
          ),
        ]);
      });
    expect(validatedSelection).toMatchObject({
      revisionId: prepared.revisionId,
      activationSequence: 1n,
      relationCount: 2,
    });
    expect(serving).toEqual({
      status: "serving",
      edgeDefinitionId: activeBinding.edgeDefinitionId,
      activeRevisionId: prepared.revisionId,
    });
    expect(inactive).toEqual({
      status: "not_serving",
      reason: "definition_not_active",
      edgeDefinitionId: inactiveEdgeDefinitionId,
      activeRevisionId: prepared.revisionId,
    });

    const staleAuthorities = [
      Object.freeze({
        reason: "storageGeneration" as const,
        authority: Object.freeze({
          ...active.basis.authority,
          storageGeneration:
            LegacyV1StorageGenerationSchema.make("legacy_v1"),
        }),
      }),
      Object.freeze({
        reason: "storageGenerationFence" as const,
        authority: Object.freeze({
          ...active.basis.authority,
          storageGenerationFence: StorageGenerationFenceSchema.make(
            active.basis.authority.storageGenerationFence + 1n,
          ),
        }),
      }),
      Object.freeze({
        reason: "epoch" as const,
        authority: Object.freeze({
          ...active.basis.authority,
          epoch: ScopeEpochSchema.make("stale-serving-epoch"),
        }),
      }),
    ];
    for (const stale of staleAuthorities) {
      const failure = await fixture.persistence.drizzle.transaction(async tx => {
        const clock = await runEffect(
          lockScopeClockForUpdateInTransactionEffect(
            tx,
            active.basis.authority.scopeId,
          ),
        );
        return runEffectFailure(
          inspectApplicationRelationServingDefinitionInTransactionEffect(
            fixture.servingInspector,
            tx,
            {
              authority: stale.authority,
              clock,
              edgeDefinitionId: activeBinding.edgeDefinitionId,
            },
          ),
        );
      });
      expect(failure).toMatchObject({
        _tag: "ApplicationRelationServingStaleAuthorityError",
        reason: stale.reason,
      });
    }

    const movedFence = StorageGenerationFenceSchema.make(
      active.basis.authority.storageGenerationFence + 1n,
    );
    await fixture.persistence.drizzle.update(fxSystemScopeClocks).set({
      storageGenerationFence: movedFence,
    }).where(eq(
      fxSystemScopeClocks.scopeId,
      active.basis.authority.scopeId,
    ));
    const staleRoot = await fixture.persistence.drizzle.transaction(async tx => {
      const clock = await runEffect(
        lockScopeClockForUpdateInTransactionEffect(
          tx,
          active.basis.authority.scopeId,
        ),
      );
      return runEffectFailure(
        inspectApplicationRelationServingDefinitionInTransactionEffect(
          fixture.servingInspector,
          tx,
          {
            authority: Object.freeze({
              ...active.basis.authority,
              storageGenerationFence: movedFence,
            }),
            clock,
            edgeDefinitionId: activeBinding.edgeDefinitionId,
          },
        ),
      );
    });
    expect(staleRoot).toMatchObject({
      _tag: "ApplicationActiveHeadStateError",
      reason: "storedState",
    });

    const [activations, heads] = await Promise.all([
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationActivations,
      ),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationActiveHeads,
      ),
    ]);
    expect(activations).toHaveLength(1);
    expect(activations[0]).toMatchObject({
      readinessContractVersion: 2,
      legacyReadinessSha256: null,
      relationCount: 2,
    });
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({
      readinessContractVersion: 2,
      relationCount: 2,
    });
    expect(encodeBytesToLowercaseHex(
      activations[0]?.relationReadinessSha256 ?? new Uint8Array(),
    )).toBe(prepared.readinessSha256);
    expect(encodeBytesToLowercaseHex(
      activations[0]?.relationSetReadinessSha256 ?? new Uint8Array(),
    )).toBe(prepared.relationSetReadinessSha256);
    expect(encodeBytesToLowercaseHex(
      heads[0]?.relationSetReadinessSha256 ?? new Uint8Array(),
    )).toBe(prepared.relationSetReadinessSha256);
    expect(JSON.parse(new TextDecoder().decode(
      activations[0]?.activationBytes,
    ))).toMatchObject({
      format: "flarex.application-activation",
      version: 2,
      readinessContractVersion: 2,
      relationSetReadinessSha256: prepared.relationSetReadinessSha256,
      relationCount: 2,
    });
    expect(JSON.parse(new TextDecoder().decode(
      heads[0]?.headBytes,
    ))).toMatchObject({
      format: "flarex.application-active-head",
      version: 2,
      readinessContractVersion: 2,
      relationSetReadinessSha256: prepared.relationSetReadinessSha256,
      relationCount: 2,
    });
  });

  it("reacquires an active relation selection after the commit frontier advances", async () => {
    const ready = await readyExactRelationReadFixture();
    const beforeReplay = await relationActivationInventory(ready.fixture);
    await applyExactRelationSourceCommit(
      ready,
      exactRelationCommitRowId(19_101),
      19_102,
      CommitSeqSchema.make(1n),
    );
    const replayed = await runEffect(
      ready.fixture.relationActivation.activate({
        revisionId: ready.readiness.revisionId,
        expectedActiveHead: null,
      }),
    );
    expect(replayed).toMatchObject({
      status: "activated",
      disposition: "replayed",
      revisionId: ready.readiness.revisionId,
      activationSequence: 1n,
      previousActivationSequence: null,
      readinessSha256: ready.readiness.readinessSha256,
    });
    expect(await relationActivationInventory(ready.fixture)).toEqual(
      beforeReplay,
    );
    const buildInput = Object.freeze({
      deploymentId: ready.fixture.deploymentId,
      schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
      edgeDefinitionId: ready.binding.edgeDefinitionId,
    });
    expect(await runEffectFailure(
      ready.fixture.relationBuild.advance(buildInput),
    )).toMatchObject({
      _tag: "ApplicationRelationBuildServingDefinitionError",
      activeRevisionId: ready.readiness.revisionId,
    });
    const restartFaultPoints: string[] = [];
    expect(await runEffectFailure(ready.fixture.relationBuild.restart(
      buildInput,
      { faultAfter: point => { restartFaultPoints.push(point); } },
    ))).toMatchObject({
      _tag: "ApplicationRelationBuildServingDefinitionError",
      activeRevisionId: ready.readiness.revisionId,
    });
    expect(restartFaultPoints).toEqual(["afterScopeClockLock"]);

    const recreatedFold = makeApplicationRelationReadinessFoldRepository(
      ready.fixture.foldContext,
    );
    const restartedActivation = makeApplicationActivationRepository({
      deploymentId: ready.fixture.deploymentId,
      readiness: ready.fixture.legacyReadiness,
      relationReadiness: recreatedFold,
      authority: ready.fixture.authorityPorts,
    });
    const active = await runEffect(restartedActivation.readActive());
    expect(active).toMatchObject({
      basis: {
        revisionId: ready.readiness.revisionId,
        relationFrontierCommitSeq: "0",
      },
    });
    const reads = createApplicationRelationReadPort(
      ready.fixture.persistence.drizzle,
      ready.fixture.pointCommitAuthority,
      ready.fixture.relationCommit,
      recreatedFold,
    );
    await expect(runEffect(reads.prepare({
      deploymentId: ready.fixture.deploymentId,
      selection: active.selection,
      relationId: ready.binding.relationId,
    }))).resolves.toBeDefined();
  });

  it("rejects activation after an inactive relation builder restarts first", async () => {
    const fixture = await relationReadinessFixture();
    await prepareReadinessEvidence(fixture);
    const readiness = await runEffect(fixture.fold.settle(fixture.input));
    if (readiness.status !== "ready") {
      throw new Error("Expected ready relation evidence before restart.");
    }
    const binding = fixture.relation.binding.relationBindings[0];
    if (binding === undefined) throw new Error("Expected a relation binding.");
    const restarted = await runEffect(fixture.relationBuild.restart({
      deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.relation.binding.schemaVersionId,
      edgeDefinitionId: binding.edgeDefinitionId,
    }));
    expect(restarted).toMatchObject({
      status: "restarted",
      lifecycle: "cleaning",
    });
    expect(await runEffectFailure(fixture.relationActivation.activate({
      revisionId: readiness.revisionId,
      expectedActiveHead: null,
    }))).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "activate",
      reason: "notReady",
      revisionId: readiness.revisionId,
    });
    expect(await relationActivationInventory(fixture)).toEqual({
      roots: 1,
      children: 2,
      activations: 0,
      heads: 0,
    });
  });

  it("rejects a stale selection before minting a relation read capability", async () => {
    const ready = await readyExactRelationReadFixture();
    await ready.fixture.persistence.drizzle.delete(
      fxSystemApplicationActiveHeads,
    );
    const failure = await runEffectFailure(ready.reads.prepare({
      deploymentId: ready.fixture.deploymentId,
      selection: ready.active.selection,
      relationId: ready.binding.relationId,
    }));
    expect(failure).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "validateSelection",
      reason: "concurrentHead",
    });
  });

  it("rejects a stale relation capability before its first syscall writes evidence", async () => {
    const ready = await readyExactRelationReadFixture();
    const randomUuid = uuidSequence(71, 72, 73);
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        ready.fixture.pointCommitAuthority,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid,
          randomExecutionClaimOwner: randomUuid,
        },
      ),
      pointMutationSessionActivationFixture(
        ready.fixture.deploymentId,
        decodeReplacementScopeIdV1(ready.readiness.scopeId),
        { evidence: {
          schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
        } },
      ),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a stale-capability relation attempt.");
    }
    const store = createSessionJournalStorePersistenceV1(
      ready.fixture.pointCommitAuthority,
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        applicationRelations: ready.reads,
      },
    );
    const attempt = await runEffect(store.openAttemptEffect({
      selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim,
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
    }));
    const relation = await runEffect(
      store.resolveApplicationRelationReadEffect(attempt, ready.capability),
    );
    await ready.fixture.persistence.drizzle.delete(
      fxSystemApplicationActiveHeads,
    );

    const failure = await runEffectFailure(
      store.runApplicationRelationIncomingReadEffect(relation, {
        kind: "relationIncoming",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        targetDocumentId: appDocumentIdV1FromRowIdentity({
          tableId: ready.binding.targetTableId,
          rowId: relationBuildRowId(20_001),
        }),
        limit: 1,
      }),
    );
    expect(failure).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "validateSelection",
      reason: "concurrentHead",
    });
    expect(await ready.fixture.persistence.drizzle.select().from(
      fxSystemTransactionJournalRelationIncomingDependencies,
    )).toHaveLength(0);
    const roots = await ready.fixture.persistence.drizzle.select().from(
      fxSystemTransactionJournals,
    );
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      state: "open",
      lastSyscallSequence: 0n,
      relationReadSyscalls: 0,
      relationDependencyCount: 0,
    });
  });

  it("rolls relation activation back atomically and rejects a conflicting request", async () => {
    const fixture = await relationReadinessFixture();
    await prepareReadinessEvidence(fixture);
    const readiness = await runEffect(fixture.fold.settle(fixture.input));
    if (readiness.status !== "ready") {
      throw new Error("Expected relation readiness before rollback proof.");
    }
    const failingActivation = makeApplicationActivationRepository({
      deploymentId: fixture.deploymentId,
      readiness: fixture.legacyReadiness,
      relationReadiness: fixture.fold,
      authority: fixture.authorityPorts,
      faultAfter: point => {
        if (point === "headWritten") {
          throw new Error("deliberate relation activation rollback");
        }
      },
    });
    await expect(runEffect(failingActivation.activate({
      revisionId: readiness.revisionId,
      expectedActiveHead: null,
    }))).rejects.toBeDefined();
    expect(await relationActivationInventory(fixture)).toEqual({
      roots: 1,
      children: 2,
      activations: 0,
      heads: 0,
    });

    const inserted = await runEffect(fixture.relationActivation.activate({
      revisionId: readiness.revisionId,
      expectedActiveHead: null,
    }));
    const conflictingRequest = await runEffectFailure(
      fixture.relationActivation.activate({
        revisionId: readiness.revisionId,
        expectedActiveHead: Object.freeze({
          activationSequence: inserted.activationSequence,
          headSha256: "00".repeat(32),
        }),
      }),
    );
    expect(conflictingRequest).toMatchObject({
      _tag: "ApplicationActivationError",
      operation: "activate",
      reason: "alreadyActive",
    });
  });

  it("fails closed on active root, child, and schema-binding corruption", async () => {
    const candidateFixture = await readyExactRelationReadFixture();
    await candidateFixture.fixture.persistence.drizzle.update(
      fxSystemApplicationReadiness,
    ).set({
      candidateValidationReceiptSha256: new Uint8Array(32).fill(0xa5),
    }).where(eq(
      fxSystemApplicationReadiness.scopeId,
      candidateFixture.fixture.authority.scopeId,
    ));
    expect(await runEffectFailure(
      candidateFixture.fixture.relationActivation.readActive(),
    )).toMatchObject({
      _tag: "ApplicationRelationReadinessFoldError",
      operation: "readReady",
      reason: "conflictingReplay",
    });

    const rootFixture = await readyExactRelationReadFixture();
    await rootFixture.fixture.persistence.drizzle.update(
      fxSystemApplicationReadiness,
    ).set({ readinessBytes: new Uint8Array([0x7b]) }).where(eq(
      fxSystemApplicationReadiness.scopeId,
      rootFixture.fixture.authority.scopeId,
    ));
    expect(await runEffectFailure(
      rootFixture.fixture.relationActivation.readActive(),
    )).toMatchObject({
      _tag: "ApplicationRelationReadinessFoldError",
      operation: "readReady",
      reason: "conflictingReplay",
    });

    const childFixture = await readyExactRelationReadFixture();
    await childFixture.fixture.persistence.drizzle.delete(
      fxSystemApplicationReadinessRelations,
    ).where(and(
      eq(
        fxSystemApplicationReadinessRelations.scopeId,
        childFixture.fixture.authority.scopeId,
      ),
      eq(fxSystemApplicationReadinessRelations.relationOrdinal, 1),
    ));
    expect(await runEffectFailure(
      childFixture.fixture.relationActivation.readActive(),
    )).toMatchObject({
      _tag: "ApplicationRelationReadinessFoldError",
      operation: "readReady",
      reason: "storedState",
    });

    const bindingFixture = await readyExactRelationReadFixture();
    await bindingFixture.fixture.persistence.drizzle.update(
      fxSystemApplicationRevisionSchemas,
    ).set({
      schemaVersion: CatalogSchemaVersionSchema.make(
        bindingFixture.fixture.relation.binding.schemaVersion + 1,
      ),
    }).where(eq(
      fxSystemApplicationRevisionSchemas.scopeId,
      bindingFixture.fixture.authority.scopeId,
    ));
    expect(await runEffectFailure(
      bindingFixture.fixture.relationActivation.readActive(),
    )).toMatchObject({
      _tag: "ApplicationRelationReadinessFoldError",
      operation: "readReady",
      reason: "conflictingReplay",
    });
  });

  it("reauthenticates historical physical relation receipts before selection", async () => {
    const ready = await readyExactRelationReadFixture();
    await applyExactRelationSourceCommit(
      ready,
      exactRelationCommitRowId(19_201),
      19_202,
      CommitSeqSchema.make(1n),
    );
    await ready.fixture.persistence.drizzle.update(
      fxSystemEdgeDefinitionReadiness,
    ).set({ receiptBytes: new Uint8Array([0x7b]) }).where(and(
      eq(
        fxSystemEdgeDefinitionReadiness.scopeId,
        ready.fixture.authority.scopeId,
      ),
      eq(
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        ready.binding.edgeDefinitionId,
      ),
    ));
    for (const failure of [
      await runEffectFailure(ready.fixture.relationActivation.readActive()),
      await runEffectFailure(
        validateApplicationRelationActiveSelectionForReadiness(
          ready.fixture.fold,
          ready.active.selection,
          ready.fixture.deploymentId,
          ready.fixture.authorityPorts,
        ),
      ),
    ]) {
      expect(failure).toMatchObject({
        _tag: "ApplicationRelationBuildCorruptionError",
        reason: "receiptEvidence",
      });
    }
  });

  it("reauthenticates historical semantic relation receipts before selection", async () => {
    const ready = await readyExactRelationReadFixture({ semanticReuse: true });
    await applyExactRelationSourceCommit(
      ready,
      exactRelationCommitRowId(19_301),
      19_302,
      CommitSeqSchema.make(1n),
    );
    await ready.fixture.persistence.drizzle.update(
      fxSystemApplicationRelationSemanticReadiness,
    ).set({ receiptBytes: new Uint8Array([0x7b]) }).where(and(
      eq(
        fxSystemApplicationRelationSemanticReadiness.scopeId,
        ready.fixture.authority.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticReadiness.schemaVersionId,
        ready.fixture.relation.binding.schemaVersionId,
      ),
    ));
    for (const failure of [
      await runEffectFailure(ready.fixture.relationActivation.readActive()),
      await runEffectFailure(
        validateApplicationRelationActiveSelectionForReadiness(
          ready.fixture.fold,
          ready.active.selection,
          ready.fixture.deploymentId,
          ready.fixture.authorityPorts,
        ),
      ),
    ]) {
      expect(failure).toMatchObject({
        _tag: "ApplicationRelationReadinessCorruptionError",
        reason: "semanticReceipt",
      });
    }
  });

  it("authenticates a two-export publication before continuing to the candidate gate", async () => {
    const fixture = await relationReadinessFixture({ includeFunction: true });

    const result = await runEffect(fixture.fold.settle(fixture.input));

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "candidateValidationMissing",
      revisionId: fixture.input.revisionId,
    });
    expect(await fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadiness,
    )).toHaveLength(0);
    expect(await fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadinessV1,
    )).toHaveLength(0);
    expect(fixture.legacyColdCalls()).toBe(0);
  });

  it("bounds overfull persisted function sets before rejecting replay and fold", async () => {
    const fixture = await relationReadinessFixture();
    const storedPublications = await fixture.persistence.drizzle.select().from(
      fxSystemApplicationPublications,
    );
    const storedPublication = storedPublications[0];
    if (storedPublication === undefined) {
      throw new Error("Expected a relation-aware Application publication.");
    }
    await fixture.persistence.drizzle.insert(
      fxSystemApplicationFunctions,
    ).values({
      scopeId: fixture.authority.scopeId,
      revisionId: fixture.publication.revisionId,
      functionCatalogSha256: storedPublication.functionCatalogSha256,
      functionPath: "rogue:query",
      moduleName: "rogue",
      exportName: "query",
      functionKind: "query",
      visibility: "internal",
      entrySha256: new Uint8Array(32).fill(1),
      entryBytes: new Uint8Array([1]),
    });

    const publicationReplay = await runEffect(Effect.result(
      fixture.publications.publish(fixture.publicationInput),
    ));
    expect(Result.isFailure(publicationReplay)).toBe(true);
    if (Result.isFailure(publicationReplay)) {
      expect(publicationReplay.failure).toMatchObject({
        reason: "conflictingReplay",
      });
    }
    const fold = await runEffect(Effect.result(
      fixture.fold.settle(fixture.input),
    ));
    expect(Result.isFailure(fold)).toBe(true);
    if (Result.isFailure(fold)) {
      expect(fold.failure).toMatchObject({ reason: "storedState" });
    }
  });

  it("bounds overfull persisted task sets before rejecting replay and fold", async () => {
    const fixture = await relationReadinessFixture();
    const catalogs = await fixture.persistence.drizzle.select().from(
      fxSystemApplicationTaskCatalogs,
    );
    const catalog = catalogs[0];
    if (catalog === undefined) {
      throw new Error("Expected a relation-aware Application task catalog.");
    }
    await fixture.persistence.drizzle.insert(
      fxSystemApplicationTaskDefinitions,
    ).values({
      scopeId: fixture.authority.scopeId,
      revisionId: fixture.publication.revisionId,
      taskCatalogBindingSha256: catalog.taskCatalogBindingSha256,
      taskDefinitionBindingSha256: new Uint8Array(32).fill(2),
      taskId: "tasks.rogue",
      canonicalTaskManifestSha256: new Uint8Array(32).fill(3),
      logicalModulePath: "tasks/rogue.ts",
      sourceModulePath: "_flarex/tasks/rogue.js",
      exportName: "run",
      manifestBytes: new Uint8Array([1]),
      bindingBytes: new Uint8Array([1]),
    });

    const taskReplay = await runEffect(Effect.result(
      fixture.taskBindings.register(fixture.taskBindingInput),
    ));
    expect(Result.isFailure(taskReplay)).toBe(true);
    if (Result.isFailure(taskReplay)) {
      expect(taskReplay.failure).toMatchObject({ reason: "conflictingReplay" });
    }
    const fold = await runEffect(Effect.result(
      fixture.fold.settle(fixture.input),
    ));
    expect(Result.isFailure(fold)).toBe(true);
    if (Result.isFailure(fold)) {
      expect(fold.failure).toMatchObject({ reason: "storedState" });
    }
  });

  it("rejects a relation-readiness port from a different authority composition", async () => {
    const fixture = await relationReadinessFixture();
    const foreignAuthority = Object.freeze({ ...fixture.authorityPorts });
    const foreignRelations = createApplicationRelationReadinessPort(
      fixture.persistence.drizzle,
      foreignAuthority,
      fixture.relationCommit,
      fixture.relationBuild,
    );
    const foreignFold = makeApplicationRelationReadinessFoldRepository({
      ...fixture.foldContext,
      relations: foreignRelations,
    });

    const result = await runEffect(Effect.result(
      foreignFold.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationRelationReadinessFoldError",
        reason: "invalidComposition",
      });
    }
  });

  it("rolls back schema, root, and children when ordered child insertion fails", async () => {
    const fixture = await relationReadinessFixture();
    await prepareReadinessEvidence(fixture);
    await fixture.persistence.query(
      `alter table fx_system_application_readiness_relation
        add constraint fx_test_reject_second_relation_child
        check (relation_ordinal <> 2)`,
      [],
    );

    const result = await runEffect(Effect.result(
      fixture.fold.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationRelationReadinessFoldError",
        reason: "resourceFailure",
      });
    }
    const [schemas, roots, children] = await Promise.all([
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationRevisionSchemas,
      ),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadiness,
      ),
      fixture.persistence.drizzle.select().from(
        fxSystemApplicationReadinessRelations,
      ),
    ]);
    expect(schemas).toHaveLength(0);
    expect(roots).toHaveLength(0);
    expect(children).toHaveLength(0);
  });

  it("persists, replays, and digest-binds a semantic-reuse child", async () => {
    const fixture = await relationReadinessFixture({ semanticReuse: true });
    await prepareReadinessEvidence(fixture);

    const first = await runEffect(fixture.fold.settle(fixture.input));
    const replay = await runEffect(fixture.fold.settle(fixture.input));

    expect(first).toMatchObject({
      status: "ready",
      disposition: "inserted",
      relationCount: 1,
    });
    expect(replay).toMatchObject({
      status: "ready",
      disposition: "replayed",
      relationCount: 1,
    });
    const children = await fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadinessRelations,
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      relationOrdinal: 1,
      readinessKind: "semantic",
      physicalAttemptFence: null,
    });
    expect(children[0]?.semanticAttemptFence).not.toBeNull();
    const physicalRows = await fixture.persistence.drizzle.select().from(
      fxSystemEdgeDefinitionReadiness,
    );
    const child = children[0];
    const physical = physicalRows[0];
    if (child === undefined || physical === undefined) {
      throw new Error("Expected semantic and physical readiness evidence.");
    }
    await expect(fixture.persistence.drizzle.update(
      fxSystemApplicationReadinessRelations,
    ).set({
      relationReadinessSha256: physical.readinessSha256,
    }).where(and(
      eq(fxSystemApplicationReadinessRelations.scopeId, child.scopeId),
      eq(fxSystemApplicationReadinessRelations.revisionId, child.revisionId),
      eq(
        fxSystemApplicationReadinessRelations.relationOrdinal,
        child.relationOrdinal,
      ),
    ))).rejects.toThrow();
  });
});
