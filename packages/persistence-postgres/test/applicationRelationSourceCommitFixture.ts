import { expect } from "vitest";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1, type AppDocumentIdV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalV1Effect, canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { decodeReplacementScopeIdV1, type CommitSeq, type ScopeId } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type { ApplicationRelationBindingPublication } from "../src/applicationRelationBinding";
import type { ApplicationRelationCommitPort, LocatedApplicationRelationDefinitionSet } from "../src/applicationRelationCommit";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createAppSchemaCandidateValidationPortForPointCommitAuthority, createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from "../src/appUniqueConstraintSetBuildV1";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createPointCommitFinishingTransitionPortV1, createPointCommitPublisherPortV1 } from "../src/pointCommitTransaction";
import { createSessionJournalStorePersistenceV1 } from "../src/sessionJournalStore";
import { createStoredAttemptEvidenceLoaderV1 } from "../src/storedAttemptEvidence";
import { createPointMutationSessionActivationPersistenceV1 } from "../src/transactionSessionActivation";
import { issueSetupSeededSyscallValidatorProofV1 } from "./applicationRevisionSyscallValidatorTestSupport";
import { completeSessionJournalSeal, prepareSessionJournalSeal, runEffect } from "./effectTestRuntime";
import { relationAuthorityFromAnchor, selectorFromRelationAnchor } from "./pointCommitRelationTestSupport";
import { pointCommitCommandFromStoredAttemptV1, pointCommitFinishingCommandFromStoredAttemptV1 } from "./pointCommitTransactionTestSupport";
import { TEST_GRANT_RETENTION_POLICY_V1, activatePointMutationSession, pointMutationSessionActivationFixture } from "./transactionSessionActivationTestSupport";

/** Deterministic UUID-v4 identities accepted by the real journal insert owner. */
export function exactRelationCommitRowId(ordinal: number): AppRowIdHexV1 {
  return decodeAppRowIdHexV1(`00000000000040008000${ordinal.toString(16).padStart(12, "0")}`);
}

interface RelationSourceCommitFixture {
  readonly controlDb: FlarexMetadataDatabase;
  readonly scopeId: ScopeId;
  readonly ports: Parameters<typeof createPointCommitPublisherPortV1>[0];
  readonly authority: Parameters<typeof createAppUniqueConstraintSetEligibilityPortV1>[0]["authority"];
  readonly publication: ApplicationRelationBindingPublication;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly relationCommit: ApplicationRelationCommitPort;
}

/** Driver-neutral fixture orchestration only: the native publisher owns all
 * materialization, coverage, publication, settlement and clock advancement. */
export async function publishExactRelationSourceCommit(
  fixture: RelationSourceCommitFixture,
  targetRowId: ReturnType<typeof exactRelationCommitRowId>,
  sourceOrdinal: number,
  expectedCommitSeq: CommitSeq,
  includeTarget = expectedCommitSeq === 1n,
): Promise<AppDocumentIdV1> {
  const { publication, ports } = fixture;
  const binding = publication.binding.relationBindings[0];
  if (binding === undefined) throw new Error("Missing relation binding");
  const sourceRowId = exactRelationCommitRowId(sourceOrdinal);
  const targetId = appDocumentIdV1FromRowIdentity({ tableId: binding.targetTableId, rowId: targetRowId });
  const sourceId = appDocumentIdV1FromRowIdentity({ tableId: binding.sourceTableId, rowId: sourceRowId });
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(publication.manifestBinding.deploymentId);
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(ports, { leaseDurationMilliseconds: 60_000 }),
    pointMutationSessionActivationFixture(deploymentId, decodeReplacementScopeIdV1(fixture.scopeId), {
      evidence: { schemaVersionId: publication.binding.schemaVersionId,
        requestKey: TransactionRequestKeyV1Schema.make(`relation-source:${sourceOrdinal}`) },
    }),
  );
  if (activation.status !== "created") throw new Error("Expected new source-write attempt");
  const identities = [...(includeTarget ? [targetRowId] : []), sourceRowId];
  const store = createSessionJournalStorePersistenceV1(ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid: () => {
      const rowId = identities.shift();
      if (rowId === undefined) throw new Error("Unexpected fixture identity request");
      const documentId = appDocumentIdV1FromRowIdentity({ tableId: binding.sourceTableId, rowId });
      return documentId.slice(String(binding.sourceTableId).length + 1);
    },
  });
  const attempt = await runEffect(store.openAttemptEffect({
    selector: selectorFromRelationAnchor(activation.anchor), executionClaim: activation.executionClaim,
    snapshotToken: activation.anchor.snapshotToken, schemaVersionId: publication.binding.schemaVersionId,
  }));
  const validator = issueSetupSeededSyscallValidatorProofV1({ scopeId: activation.anchor.scopeId,
    schemaVersionId: publication.binding.schemaVersionId });
  const tableName = (tableId: number) => {
    const table = publication.binding.tables.find(table => table.tableId === tableId);
    if (table === undefined) throw new Error("Missing fixture table");
    return table.logicalName;
  };
  if (includeTarget) {
    const table = await runEffect(store.resolvePointTableEffect(attempt, tableName(binding.targetTableId)));
    const inserted = await runEffect(store.runPointOperationEffect(table, { kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { name: "natural relation target" } }, validator));
    expect(inserted).toMatchObject({ kind: "completed", outcome: { kind: "inserted", documentId: targetId } });
  }
  const table = await runEffect(store.resolvePointTableEffect(attempt, tableName(binding.sourceTableId)));
  const fields = Object.fromEntries(fixture.definitions.definitions.map(definition => {
    const path = definition.edge.physical.sourcePath[0];
    if (path === undefined) throw new Error("Missing source field");
    return [path.name, targetId];
  }));
  const inserted = await runEffect(store.runPointOperationEffect(table, { kind: "insert",
    syscallSequence: CommitSyscallSequenceV1Schema.make(includeTarget ? 2n : 1n), fields }, validator));
  expect(inserted).toMatchObject({ kind: "completed", outcome: { kind: "inserted", documentId: sourceId } });
  const seal = await prepareSessionJournalSeal(store, attempt);
  const journal = await runEffect(canonicalizeSessionJournalV1Effect(seal.journal));
  const result = await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true }));
  await completeSessionJournalSeal(store, seal.preparation, journal, result);
  const authority = relationAuthorityFromAnchor(activation.anchor, publication.binding.schemaVersionId, activation.executionClaim);
  const loader = createStoredAttemptEvidenceLoaderV1(ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") throw new Error("Missing running source-write evidence");
  await runEffect(createPointCommitFinishingTransitionPortV1(ports).enterFinishing(
    await pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)));
  const finishing = await runEffect(loader.loadFinishingEffect(selectorFromRelationAnchor(activation.anchor)));
  if (finishing.kind !== "loaded") throw new Error("Missing finishing source-write evidence");
  const command = await pointCommitCommandFromStoredAttemptV1(authority, finishing.evidence);
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(fixture.controlDb);
  const candidateValidation = createAppSchemaCandidateValidationPortForPointCommitAuthority(fixture.controlDb, ports);
  const publisher = createPointCommitPublisherPortV1(ports, {
    intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.controlDb),
    developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.controlDb), uniqueConstraints,
    uniqueConstraintEligibility: createAppUniqueConstraintSetEligibilityPortV1({ controlDb: fixture.controlDb, authority: fixture.authority }, uniqueConstraints),
    applicationRelations: fixture.relationCommit,
    candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation, pointCommitAuthority: ports }),
  });
  const published = await runEffect(publisher.publish({ ...command, successfulResult: {
    valueCodecVersion: result.evidence.valueCodecVersion, value: result.valueJson, canonicalBytes: result.canonicalBytes,
    semanticSizeBytes: result.semanticSizeBytes, sha256Hex: result.evidence.sha256Hex,
  } }));
  expect(published).toMatchObject({ kind: "published", token: { commitSeq: expectedCommitSeq } });
  return sourceId;
}
