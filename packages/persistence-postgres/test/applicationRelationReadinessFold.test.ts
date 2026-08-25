import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  type CatalogSchemaVersionId,
  CatalogSchemaVersionSchema,
} from "flarex-protocol/schema-manifest";
import { decodeCatalogEdgeDefinitionId } from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  LegacyV1StorageGenerationSchema,
  projectScopeIdUuidV1,
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import { locateAppIndexDefinitionByIdEffect } from
  "../src/appIndexDefinitions";
import { createAppUniqueConstraintDefinitionPortV1 } from
  "../src/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from
  "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  claimApplicationActiveSelection,
  claimApplicationRelationActiveSelection,
  makeApplicationActivationRepository,
  validateApplicationRelationActiveSelectionInTransaction,
  validateApplicationRelationActiveSelectionForReadiness,
} from "../src/applicationActivation";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import { makeApplicationReadinessRepository } from
  "../src/applicationReadiness";
import {
  type ApplicationRelationBindingPublication,
  publishApplicationRelationBindingEffect,
} from "../src/applicationRelationBinding";
import { createApplicationRelationBuildPort } from
  "../src/applicationRelationBuild";
import {
  applyApplicationRelationCommitEdgesInTransactionEffect,
  createApplicationRelationCommitPort,
  prepareApplicationRelationCommitResult,
} from "../src/applicationRelationCommit";
import {
  makeApplicationRelationPublicationRepository,
} from "../src/applicationRelationPublication";
import {
  hasApplicationRelationReadinessFoldAuthority,
  makeApplicationRelationReadinessFoldRepository,
  validateApplicationRelationReadinessForActivationInTransaction,
  validateStoredApplicationRelationReadinessForActivationInTransaction,
} from "../src/applicationRelationReadinessFold";
import { createApplicationRelationReadinessPort } from
  "../src/applicationRelationReadiness";
import { createApplicationRelationReadPort } from
  "../src/applicationRelationRead";
import {
  fxSystemApplicationFunctions,
  fxSystemApplicationPublications,
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations,
  fxSystemApplicationRevisionSchemas,
  fxSystemApplicationTaskCatalogs,
  fxSystemApplicationTaskDefinitions,
} from "../src/applicationRelationSchema";
import { createApplicationRelationSchemaAuthorityPort } from
  "../src/applicationRelationSchemaAuthority";
import {
  createApplicationRelationServingInspector,
  inspectApplicationRelationServingDefinitionInTransactionEffect,
} from "../src/applicationRelationServing";
import {
  createApplicationRelationTaskCatalogSnapshotPort,
  makeApplicationRelationTaskBindingRepository,
} from "../src/applicationRelationTaskBindings";
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
} from "../src/applicationTaskBindings";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from
  "../src/appRows";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import { isRetryableSqlTransactionCause } from
  "../src/locatedReadCommittedEffect";
import { createPhysicalDefinitionLifecyclePort } from
  "../src/physicalDefinitionLifecycle";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedSplitScopeClockTarget,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../src/pglite";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointCommitRollbackProofPortV1,
  createPointMutationAttemptReplacementPortV1,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
} from "../src/pointCommitTransaction";
import { getScopeAuthorityProvisioningReceipt } from
  "../src/scopeAuthorityProvisioningReceipt";
import type { SplitScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { lockScopeClockForUpdateInTransactionEffect } from
  "../src/scopeClock";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../src/applicationActivationSchema";
import {
  fxControlApplicationSchemaAuthoritiesV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemEdgeDefinitionReadiness,
  fxSystemScopeClocks,
  fxSystemTransactionJournals,
} from "../src/schema";
import {
  createSessionJournalStorePersistenceV1,
  SessionJournalSealV1Error,
  SessionJournalStorageCorruptionV1Error,
} from "../src/sessionJournalStore";
import {
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
} from "../src/transactionSessionActivation";
import { createStoredAttemptEvidenceLoaderV1 } from
  "../src/storedAttemptEvidence";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "../src/storedOccExecution";
import { createPointMutationExecutionClaimLivenessV1 } from
  "../src/transactionExecutionClaimLiveness";
import type { StableTableCatalogTransaction } from
  "../src/stableTableCatalog";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildRowId,
  relationBuildPublicationInput,
} from "./applicationRelationBuildTestSupport";
import {
  completeSessionJournalSeal,
  prepareSessionJournalSeal,
  runEffect,
  runEffectFailure,
} from "./effectTestRuntime";
import {
  relationAuthorityFromAnchor,
  selectorFromRelationAnchor,
} from "./pointCommitRelationTestSupport";
import {
  pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
  runningRelationConflictAttemptReplacementCommandFromStoredOccExecutionV1,
  runningRelationConflictRecoveryCommandFromStoredOccExecutionV1,
} from "./pointCommitTransactionTestSupport";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
} from "./transactionSessionActivationTestSupport";
import {
  issueSetupSeededSyscallValidatorProofV1,
} from "./applicationRevisionSyscallValidatorTestSupport";

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
  it("classifies PostgreSQL lock contention as retryable", () => {
    expect(isRetryableSqlTransactionCause({ code: "55P03" })).toBe(true);
    expect(isRetryableSqlTransactionCause({ code: "42P01" })).toBe(false);
  });

  it("journals and seals an exact relation read from the ready fold", async () => {
    const ready = await readyExactRelationReadFixture();
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

    const prepared = await prepareSessionJournalSeal(store, attempt);
    expect(prepared.journal).toMatchObject({
      finalSyscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      readDependencies: [{
        kind: "appRelationIncoming",
        edgeDefinitionId: binding.edgeDefinitionId,
        targetRowId,
        observedAdjacencyVersion: activation.anchor.snapshotToken.commitSeq,
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
  });

  it("reads through staged insert, retarget, and delete overlays", async () => {
    const ready = await readyExactRelationReadFixture();
    const targetRowId = relationBuildRowId(9_051);
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
    const targetRowId = relationBuildRowId(9_101);
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
        randomExecutionClaimOwner: uuidSequence(36),
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
    const targetRowId = relationBuildRowId(9_201);
    const lowerTargetRowId = relationBuildRowId(9_199);
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
      },
      {
        kind: "appRelationIncoming",
        edgeDefinitionId: ready.binding.edgeDefinitionId,
        targetRowId,
        observedAdjacencyVersion: 1n,
      },
    ]);
    await setExactRelationAdjacencyVersion(
      ready,
      targetRowId,
      CommitSeqSchema.make(2n),
    );
    const observedRelationQueries: string[] = [];
    const rollback = createPointCommitRollbackProofPortV1(
      ready.fixture.pointCommitAuthority,
      {
        applicationRelations: ready.fixture.relationCommit,
        observeQuery: (query) => {
          if (query.name === "validateRelationDependencies") {
            observedRelationQueries.push(query.sql);
          }
        },
      },
    );
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
      relationBuildRowId(19_101),
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
      relationBuildRowId(19_201),
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
      relationBuildRowId(19_301),
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

  it("exactly replays a two-export publication then fails closed at the unavailable runtime", async () => {
    const fixture = await relationReadinessFixture({ includeFunction: true });

    const result = await runEffect(fixture.fold.settle(fixture.input));

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "functionRuntimeUnavailable",
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

async function relationActivationInventory(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
) {
  const [roots, children, activations, heads] = await Promise.all([
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadiness,
    ),
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationReadinessRelations,
    ),
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationActivations,
    ),
    fixture.persistence.drizzle.select().from(
      fxSystemApplicationActiveHeads,
    ),
  ]);
  return Object.freeze({
    roots: roots.length,
    children: children.length,
    activations: activations.length,
    heads: heads.length,
  });
}

async function readyExactRelationReadFixture(
  options: RelationReadinessFixtureOptions = {},
) {
  const fixture = await relationReadinessFixture(options);
  await prepareReadinessEvidence(fixture);
  const readiness = await runEffect(fixture.fold.settle(fixture.input));
  if (readiness.status !== "ready") {
    throw new Error("Expected relation-aware Application readiness.");
  }
  await runEffect(fixture.relationActivation.activate({
    revisionId: readiness.revisionId,
    expectedActiveHead: null,
  }));
  const active = await runEffect(fixture.relationActivation.readActive());
  const binding = fixture.relation.binding.relationBindings[0];
  if (binding === undefined) throw new Error("Expected a relation binding.");
  const reads = createApplicationRelationReadPort(
    fixture.persistence.drizzle,
    fixture.pointCommitAuthority,
    fixture.relationCommit,
    fixture.fold,
  );
  const capability = await runEffect(reads.prepare({
    deploymentId: fixture.deploymentId,
    selection: active.selection,
    relationId: binding.relationId,
  }));
  const input = Object.freeze({
    deploymentId: fixture.deploymentId,
    scopeId: fixture.authority.scopeId,
    schemaVersionId: fixture.relation.binding.schemaVersionId,
  });
  const resolved = Result.getOrThrow(reads.resolve(capability, input));
  const definitions = await runEffect(fixture.relationCommit.locate({
    deploymentId: fixture.deploymentId,
    schemaVersionId: fixture.relation.binding.schemaVersionId,
  }));
  const expectedDefinitions = fixture.semanticReuse ? 1 : 2;
  if (definitions === null ||
    definitions.definitions.length !== expectedDefinitions) {
    throw new Error("Expected the exact relation definitions.");
  }
  return Object.freeze({
    fixture,
    readiness,
    active,
    binding,
    reads,
    capability,
    input,
    resolved,
    definitions,
  });
}

type ReadyExactRelationReadFixture = Awaited<
  ReturnType<typeof readyExactRelationReadFixture>
>;

async function applyExactRelationSourceCommit(
  ready: ReadyExactRelationReadFixture,
  targetRowId: ReturnType<typeof relationBuildRowId>,
  sourceOrdinal: number,
  commitSeq: ReturnType<typeof CommitSeqSchema.make>,
  includeTarget: boolean = commitSeq === 1n,
): Promise<ReturnType<typeof appDocumentIdV1FromRowIdentity>> {
  const sourceRowId = relationBuildRowId(sourceOrdinal);
  const sourceDocumentId = appDocumentIdV1FromRowIdentity({
    tableId: ready.binding.sourceTableId,
    rowId: sourceRowId,
  });
  const targetDocumentId = appDocumentIdV1FromRowIdentity({
    tableId: ready.binding.targetTableId,
    rowId: targetRowId,
  });
  const sourcePaths = ready.definitions.definitions.map((definition) => {
    const sourcePath = definition.edge.physical.sourcePath[0];
    if (sourcePath === undefined) {
      throw new Error("Expected one exact relation source field.");
    }
    return sourcePath.name;
  });
  const sourceFields = Object.freeze(Object.fromEntries(
    sourcePaths.map((name) => [name, targetDocumentId]),
  ));
  const sourceCreationTime = decodeAppCreationTimeV1(sourceOrdinal);
  const final = await canonicalizeAppDocumentV1({
    tableId: ready.binding.sourceTableId,
    rowId: sourceRowId,
    creationTime: sourceCreationTime,
    fields: sourceFields,
  });
  const targetCreationTime = decodeAppCreationTimeV1(9_101);
  const target = includeTarget
    ? await canonicalizeAppDocumentV1({
        tableId: ready.binding.targetTableId,
        rowId: targetRowId,
        creationTime: targetCreationTime,
        fields: { name: "natural relation target" },
      })
    : null;
  const transitions = Object.freeze([
    ...(target === null
      ? []
      : [Object.freeze({
          documentId: targetDocumentId,
          tableId: ready.binding.targetTableId,
          rowId: targetRowId,
          prior: null,
          final: target,
        })]),
    Object.freeze({
      documentId: sourceDocumentId,
      tableId: ready.binding.sourceTableId,
      rowId: sourceRowId,
      prior: null,
      final,
    }),
  ]);
  const prepared = Result.getOrThrow(prepareApplicationRelationCommitResult(
    ready.definitions,
    transitions,
  ));
  await ready.fixture.persistence.drizzle.transaction(async tx => {
    for (const transition of transitions) {
      const document = transition.final;
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: ready.fixture.authority.scopeId,
        tableId: transition.tableId,
        rowId: transition.rowId,
        writeEpoch: ready.fixture.authority.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
        creationTime: transition.documentId === targetDocumentId
          ? targetCreationTime
          : sourceCreationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      });
    }
    await runEffect(applyApplicationRelationCommitEdgesInTransactionEffect(
      ready.fixture.relationCommit,
      tx,
      {
        scopeId: ready.fixture.authority.scopeId,
        schemaVersionId: ready.fixture.relation.binding.schemaVersionId,
        commitSeq,
        prepared,
      },
    ));
    const advanced = await tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: commitSeq,
      updatedAt: new Date(),
    }).where(and(
      eq(fxSystemScopeClocks.scopeId, ready.fixture.authority.scopeId),
      eq(
        fxSystemScopeClocks.lastCommitSeq,
        CommitSeqSchema.make(commitSeq - 1n),
      ),
    )).returning({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq });
    if (advanced.length !== 1 || advanced[0]?.lastCommitSeq !== commitSeq) {
      throw new Error("Expected one exact relation source commit sequence.");
    }
  });
  return sourceDocumentId;
}

async function advanceExactRelationScopeClock(
  ready: ReadyExactRelationReadFixture,
  commitSeq: ReturnType<typeof CommitSeqSchema.make>,
): Promise<void> {
  const updated = await ready.fixture.persistence.drizzle.update(
    fxSystemScopeClocks,
  ).set({
    lastCommitSeq: commitSeq,
    updatedAt: new Date(),
  }).where(eq(
    fxSystemScopeClocks.scopeId,
    ready.fixture.authority.scopeId,
  )).returning({ lastCommitSeq: fxSystemScopeClocks.lastCommitSeq });
  if (updated.length !== 1 || updated[0]?.lastCommitSeq !== commitSeq) {
    throw new Error("Expected one exact relation scope clock update.");
  }
}

async function setExactRelationAdjacencyVersion(
  ready: ReadyExactRelationReadFixture,
  targetRowId: ReturnType<typeof relationBuildRowId>,
  commitSeq: ReturnType<typeof CommitSeqSchema.make>,
): Promise<void> {
  const updated = await ready.fixture.persistence.query<{
    readonly last_changed_commit_seq: string;
  }>(
    `update fx_app_edge_adjacency_version
        set last_changed_commit_seq = $5
      where scope_uuid = $1
        and edge_definition_id = $2
        and direction = $3
        and endpoint_row_id = $4
      returning last_changed_commit_seq::text`,
    [
      projectScopeIdUuidV1(ready.fixture.authority.scopeId).scopeUuid,
      ready.binding.edgeDefinitionId,
      "incoming",
      appRowIdHexV1ToBytes(targetRowId),
      commitSeq,
    ],
  );
  if (
    updated.rows.length !== 1 ||
    updated.rows[0]?.last_changed_commit_seq !== commitSeq.toString()
  ) {
    throw new Error("Expected one exact incoming adjacency version update.");
  }
}

interface RelationReadinessFixtureOptions {
  readonly includeFunction?: boolean;
  readonly semanticReuse?: boolean;
}

async function relationReadinessFixture(
  options: RelationReadinessFixtureOptions = {},
) {
  ensureRelationBuildTestWebCrypto();
  fixtureOrdinal += 1;
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_application_relation_fold_${fixtureOrdinal}`,
  );
  const provisioned = await createPGliteSplitScopeAuthorityProvisioner(
    persistence,
    {
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          createPGliteLocatedSplitScopeClockTarget(persistence, locator),
      },
      randomUuid: uuidSequence(1, 2),
    },
  ).ensure({
    deploymentId,
    projectId: `project_application_relation_fold_${fixtureOrdinal}`,
  });
  await persistence.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [provisioned.scope.scopeId],
  );
  const clock = await persistence.getScopeClock(provisioned.scope.scopeId);
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Expected relation-aware Application scope authority.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: clock.scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const locatedTarget = createLocatedAppSchemaCandidateValidationTarget(
    persistence.drizzle,
    LOCATOR,
  );
  const authorityPorts = Object.freeze({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: (scopeId: typeof authority.scopeId) =>
        getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId),
    },
    scopeClockTargets: { resolve: async () => locatedTarget },
  });
  const pointTarget = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    LOCATOR,
  );
  const pointCommitAuthority = Object.freeze({
    scopeMetadata: persistence,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: { resolve: async () => pointTarget },
  });
  const relationCommit = createApplicationRelationCommitPort(
    persistence.drizzle,
    pointCommitAuthority,
  );
  const servingInspector = createApplicationRelationServingInspector();
  const relationBuild = createApplicationRelationBuildPort(
    persistence.drizzle,
    authorityPorts,
    relationCommit,
    servingInspector,
  );
  const relations = createApplicationRelationReadinessPort(
    persistence.drizzle,
    authorityPorts,
    relationCommit,
    relationBuild,
  );
  let relationInput = await relationApplicationInput(
    deploymentId,
    fixtureOrdinal,
    options.includeFunction === true,
  );
  let relation: ApplicationRelationBindingPublication;
  if (options.semanticReuse === true) {
    const originInput = await relationBuildPublicationInput(
      deploymentId,
      fixtureOrdinal,
      { inverseName: "authoredPosts" },
    );
    const origin = await runEffect(publishApplicationRelationBindingEffect(
      relationBindingRepository(persistence.drizzle),
      originInput,
    ));
    await enableRelationPhysicalBuildsFor(
      relationCommit,
      relationBuild,
      deploymentId,
      origin.binding.schemaVersionId,
      1,
    );
    relationInput = await relationBuildPublicationInput(
      deploymentId,
      fixtureOrdinal + 1_000,
      {
        inverseName: "articlesAuthored",
        decisions: Object.freeze([{
          relationOrdinal: 1,
          evolution: Object.freeze({
            kind: "preserve" as const,
            fromSchemaVersionId: origin.binding.schemaVersionId,
            fromRelationOrdinal: 1,
            physical: "reuse" as const,
          }),
        }]),
      },
    );
    relation = await runEffect(publishApplicationRelationBindingEffect(
      relationBindingRepository(persistence.drizzle),
      relationInput,
    ));
  } else {
    relation = await runEffect(publishApplicationRelationBindingEffect(
      relationBindingRepository(persistence.drizzle),
      relationInput,
    ));
  }
  const canonicalManifest = Result.getOrThrow(
    canonicalizeApplicationManifestV2(relationInput.manifest),
  );
  const analyses = makeApplicationAnalysisRepository(persistence.drizzle, {
    randomUuid: uuidSequence(11, 12, 13),
  });
  const pending = await runEffect(analyses.begin({
    authority,
    requestKey: `request:application-relation-fold:${fixtureOrdinal}`,
    sourceArtifactRootSha256:
      canonicalManifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-analyzer",
    analyzerPolicyIdentity: "application-relation-analyzer-policy",
  }));
  const analyzed = await runEffect(analyses.settle(authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256:
      canonicalManifest.manifest.sourceArtifact.rootSha256,
    analyzerIdentity: "application-relation-analyzer",
    analyzerPolicyIdentity: "application-relation-analyzer-policy",
    canonicalManifest: canonicalManifest.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected analyzed relation-aware Application revision.");
  }
  expect(analyzed.manifestSha256).toBe(relationInput.manifestSha256);
  const publications = makeApplicationRelationPublicationRepository(
    persistence.drizzle,
    persistence.drizzle,
  );
  const publicationInput = Object.freeze({
      authority,
      deploymentId,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: canonicalManifest.manifest,
  });
  const publication = await runEffect(publications.publish(publicationInput));
  expect(await runEffect(publications.publish(publicationInput)))
    .toEqual(publication);
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [taskManifest()],
  }, taskSha256));
  const bindings = await runEffect(produceApplicationTaskBindingsV1({
    definition: preparedDefinition(),
    catalog,
    authority: {
      scopeId: publication.scopeId,
      revisionId: publication.revisionId,
      candidateId: publication.candidateId,
      analysisId: publication.analysisId,
      sourceArtifactRootSha256: publication.sourceArtifactRootSha256,
      publicationSha256: publication.publicationSha256,
    },
    runtimePolicy: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
    },
  }, taskSha256));
  const taskBindings = makeApplicationRelationTaskBindingRepository(
    persistence.drizzle,
    persistence.drizzle,
  );
  const taskBindingInput = Object.freeze({ authority, publication, bindings });
  const taskRegistration = await runEffect(
    taskBindings.register(taskBindingInput),
  );
  expect(await runEffect(taskBindings.register(taskBindingInput)))
    .toEqual(taskRegistration);
  const copiedPublication = await runEffect(Effect.result(
    taskBindings.register({
      ...taskBindingInput,
      publication: Object.freeze({ ...publication }),
    }),
  ));
  expect(Result.isFailure(copiedPublication)).toBe(true);
  if (Result.isFailure(copiedPublication)) {
    expect(copiedPublication.failure).toMatchObject({ reason: "invalidInput" });
  }

  const candidateValidation = createAppSchemaCandidateValidationPort({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
  });
  const candidateReadiness = createAppSchemaCandidateReadinessPort(
    candidateValidation,
  );
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    persistence.drizzle,
  );
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: persistence.drizzle,
      authority: authorityPorts,
    }, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1({
    scopeMetadata: persistence,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("Relation readiness must not open a commit session.");
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
  });
  const foldContext = Object.freeze({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
    schema: createApplicationRelationSchemaAuthorityPort(
      persistence.drizzle,
    ),
    taskCatalog: createApplicationRelationTaskCatalogSnapshotPort(),
    candidateValidation: candidateReadiness,
    pointCommit,
    physicalDefinitionLifecycle,
    relations,
  });
  const fold = makeApplicationRelationReadinessFoldRepository(foldContext);
  let legacyColdCalls = 0;
  const legacyReadiness = makeApplicationReadinessRepository({
    controlDb: persistence.drizzle,
    authority: authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({
      db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(run),
    }),
    taskCatalog: createApplicationTaskCatalogSnapshotPort(),
    candidateValidation: candidateReadiness,
    pointCommit,
    physicalDefinitionLifecycle,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: () => {
        legacyColdCalls += 1;
        return Effect.die(new Error(
          "Legacy cold materialization must not run for relation readiness.",
        ));
      },
    },
  });
  const relationActivation = makeApplicationActivationRepository({
    deploymentId,
    readiness: legacyReadiness,
    relationReadiness: fold,
    authority: authorityPorts,
  });
  return Object.freeze({
    persistence,
    deploymentId,
    authority,
    authorityPorts,
    pointCommitAuthority,
    pointTarget,
    relation,
    manifest: canonicalManifest.manifest,
    publication,
    publications,
    publicationInput,
    taskBindings,
    taskBindingInput,
    relationBuild,
    relationCommit,
    servingInspector,
    relations,
    candidateValidation,
    physicalDefinitionLifecycle,
    semanticReuse: options.semanticReuse === true,
    foldContext,
    fold,
    legacyReadiness,
    relationActivation,
    legacyActivation: makeApplicationActivationRepository({
      deploymentId,
      readiness: legacyReadiness,
      authority: authorityPorts,
    }),
    legacyColdCalls: () => legacyColdCalls,
    input: Object.freeze({
      deploymentId,
      revisionId: publication.revisionId,
    }),
  });
}

async function prepareReadinessEvidence(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  await closeEmptyUniqueConstraintSet(
    fixture.persistence.drizzle,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  await settleCandidateValidation(
    fixture.candidateValidation,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  await enableApplicationPhysicalBuilds(
    fixture.persistence.drizzle,
    fixture.authorityPorts,
    fixture.authority.scopeId,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
  );
  if (fixture.semanticReuse) {
    await settleRelationSemanticReadiness(fixture);
  } else {
    await enableRelationPhysicalBuilds(fixture);
  }
}

async function closeEmptyUniqueConstraintSet(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const prepared = await runEffect(
    prepareAppUniqueConstraintSetClosureV1Effect(db, {
      deploymentId,
      schemaVersionId,
    }),
  );
  await db.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
  ));
}

async function settleCandidateValidation(
  candidateValidation: ReturnType<typeof createAppSchemaCandidateValidationPort>,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const input = Object.freeze({ deploymentId, schemaVersionId });
  await runEffect(installAppSchemaCandidateValidationEffect(
    candidateValidation,
    input,
  ));
  for (let step = 0; step < 64; step += 1) {
    const result = await runEffect(advanceAppSchemaCandidateValidationEffect(
      candidateValidation,
      input,
    ));
    if (result.disposition !== "readyToSettle") continue;
    await runEffect(settleAppSchemaCandidateValidationEffect(
      candidateValidation,
      input,
    ));
    return;
  }
  throw new Error("Relation-aware candidate validation did not settle.");
}

async function enableApplicationPhysicalBuilds(
  controlDb: FlarexMetadataDatabase,
  authority: Parameters<typeof reconcilePublishedIndexBuildsV1Effect>[0][
    "authority"
  ],
  scopeId: ApplicationAnalysisAuthority["scopeId"],
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const ports = Object.freeze({ controlDb, authority });
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId,
    schemaVersionId,
  }));
  const requirements = await runEffect(
    loadPublishedPhysicalRequirementSnapshotV1(
      controlDb,
      Object.freeze({ deploymentId, schemaVersionId }),
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected relation-aware physical requirements.");
  }
  for (const definition of requirements.definitions) {
    const located = await runEffect(locateAppIndexDefinitionByIdEffect(
      controlDb,
      scopeId,
      definition.indexDefinitionId,
    ));
    if (located === null) {
      throw new Error("Relation-aware index definition is missing.");
    }
    for (let step = 0; step < 16; step += 1) {
      const input = Object.freeze({
        deploymentId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 16,
      });
      const built = located.access.kind === "developer"
        ? await runEffect(buildAppDeveloperOrderedIndexV1Effect(ports, input))
        : await runEffect(buildIntrinsicCreationTimeIndexV1Effect(ports, input));
      if (built.lifecycle === "enabled") break;
      if (step === 15) {
        throw new Error("Relation-aware physical build did not enable.");
      }
    }
  }
}

async function enableRelationPhysicalBuilds(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  await enableRelationPhysicalBuildsFor(
    fixture.relationCommit,
    fixture.relationBuild,
    fixture.deploymentId,
    fixture.relation.binding.schemaVersionId,
    fixture.semanticReuse ? 1 : 2,
  );
}

async function enableRelationPhysicalBuildsFor(
  relationCommit: ReturnType<typeof createApplicationRelationCommitPort>,
  relationBuild: ReturnType<typeof createApplicationRelationBuildPort>,
  deploymentId: Parameters<
    ReturnType<typeof createApplicationRelationCommitPort>["locate"]
  >[0]["deploymentId"],
  schemaVersionId: CatalogSchemaVersionId,
  expectedCount: number,
): Promise<void> {
  const definitions = await runEffect(relationCommit.locate({
    deploymentId,
    schemaVersionId,
  }));
  if (
    definitions === null || definitions.definitions.length !== expectedCount
  ) throw new Error("Expected the complete relation physical definition set.");
  for (const definition of definitions.definitions) {
    for (let step = 0; step < 128; step += 1) {
      const result = await runEffect(relationBuild.advance({
        deploymentId,
        schemaVersionId,
        edgeDefinitionId: definition.edge.edgeDefinitionId,
      }));
      if (result.lifecycle === "enabled") break;
      if (step === 127) {
        throw new Error("Relation physical readiness did not enable.");
      }
    }
  }
}

async function settleRelationSemanticReadiness(
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>,
): Promise<void> {
  const input = Object.freeze({
    deploymentId: fixture.deploymentId,
    applicationManifestSha256:
      fixture.relation.manifestBinding.applicationManifestSha256,
  });
  for (let step = 0; step < 128; step += 1) {
    const result = await runEffect(fixture.relations.advance(input));
    if (result.status === "complete") return;
    if (result.status === "not_ready") {
      throw new Error(`Semantic relation readiness blocked: ${result.reason}.`);
    }
  }
  throw new Error("Semantic relation readiness did not settle.");
}

async function relationApplicationInput(
  deploymentId: string,
  ordinal: number,
  includeFunction: boolean,
) {
  const base = await relationBuildPublicationInput(deploymentId, ordinal, {
    secondRelation: true,
    inverseName: "authoredPosts",
    secondInverseName: "reviewedPosts",
  });
  if (!includeFunction) return base;
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV2({
    ...base.manifest,
    functions: [relationFunction("a"), relationFunction("default")],
  }));
  return Object.freeze({
    ...base,
    manifest: canonical.manifest,
    manifestSha256: await sha256Hex(canonical.canonicalBytes),
  });
}

function relationFunction(
  exportName: "a" | "default",
): ApplicationManifestV2["functions"][number] {
  return Object.freeze({
    path: exportName === "default" ? "users" : `users:${exportName}`,
    moduleName: "users",
    exportName,
    kind: "query",
    visibility: "public",
    args: Object.freeze({ type: "any" as const }),
    returns: null,
    partition: null,
  });
}

function relationBindingRepository(db: FlarexMetadataDatabase) {
  return Object.freeze({
    db,
    runTransaction: <Value>(
      run: (tx: StableTableCatalogTransaction) => Promise<Value>,
    ): Promise<Value> => db.transaction(run),
  });
}

function preparedDefinition() {
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 32,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "users",
        functions: [{
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [{
        path: "users.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode(
          "export const get = () => null;\n",
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "users",
        artifactModulePath: "users.js",
      }],
      executionPath: "users.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}

function taskManifest() {
  return {
    version: 1,
    taskId: "tasks.users.get",
    handler: {
      logicalModulePath: "users",
      artifactModulePath: "users.js",
      exportName: "get",
    },
    payloadValidator: { type: "any" },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 300,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  } as const;
}

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    const prefix = (fixtureOrdinal % 10).toString();
    return `${prefix}0000000-0000-4000-8000-${sequence
      .toString()
      .padStart(12, "0")}`;
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  ));
  return encodeBytesToLowercaseHex(digest);
}
