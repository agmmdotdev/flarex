import { expect } from "vitest";
import { Effect } from "effect";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalEffect, canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationPersistence } from "../application/applicationNativeMutationTestFixture";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxSystemCommits, fxSystemIdempotency, fxSystemScopeClocks } from "../../src/database/schema";
import { createPointCommitFinishingTransitionPortV1, createPointCommitPublisherPortV1 } from "../../src/commit/pointCommitTransaction";
import { createPointMutationSessionActivationPersistenceV1 } from "../../src/execution/transactionSessionActivation";
import { createSessionJournalStorePersistence } from "../../src/execution/sessionJournalStore";
import { createStoredAttemptEvidenceLoaderV1 } from "../../src/execution/storedAttemptEvidence";
import { lockScopeClockForUpdateInTransactionEffect } from "../../src/scope/scopeClock";
import { validateApplicationWriteOwnershipForCommit } from "../../src/application/ownership/Commit";
import { completeSessionJournalSeal, prepareSessionJournalSeal, runEffect, runEffectFailure } from "../support/effectTestRuntime";
import { activatePointMutationSession, pointMutationSessionActivationFixture, TEST_GRANT_RETENTION_POLICY_V1 } from "../execution/transactionSessionActivationTestSupport";
import { issueSetupSeededSyscallValidatorProofV1 } from "../application/revision/applicationRevisionSyscallValidatorTestSupport";
import { relationAuthorityFromAnchor, selectorFromRelationAnchor } from "../commit/pointCommitRelationTestSupport";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1, pointCommitFinishingCommandFromStoredAttemptV1 } from "../commit/pointCommitTransactionTestSupport";

interface LegacyWriterFixture {
  readonly target: ApplicationNativeMutationPersistence;
  readonly ports: Parameters<typeof createPointCommitPublisherPortV1>[0];
  readonly deploymentId: string;
  readonly scopeId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

/** Real sealed legacy attempts, not caller-authored generation or write sets. */
async function prepareLegacyWriter(fixture: LegacyWriterFixture, kind: "material" | "netZero" | "readOnly", key: string = kind) {
  const scopeId = decodeReplacementScopeIdV1(fixture.scopeId);
  const activation = await activatePointMutationSession(createPointMutationSessionActivationPersistenceV1(fixture.ports,
    { leaseDurationMilliseconds: 60_000 }), pointMutationSessionActivationFixture(
    TransactionGrantDeploymentIdV1Schema.make(fixture.deploymentId), scopeId,
    { evidence: { schemaVersionId: fixture.schemaVersionId, requestKey: TransactionRequestKeyV1Schema.make(`legacy-exclusion:${key}`) } }));
  if (activation.status !== "created") throw new Error("Expected fresh legacy attempt");
  const store = createSessionJournalStorePersistence(fixture.ports, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
  const attempt = await runEffect(store.openAttemptEffect({ selector: selectorFromRelationAnchor(activation.anchor),
    executionClaim: activation.executionClaim, snapshotToken: activation.anchor.snapshotToken, schemaVersionId: fixture.schemaVersionId }));
  if (kind !== "readOnly") {
    const table = await runEffect(store.resolvePointTableEffect(attempt, "users"));
    const validator = issueSetupSeededSyscallValidatorProofV1({ scopeId, schemaVersionId: fixture.schemaVersionId });
    const inserted = await runEffect(store.runPointOperationEffect(table, { kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { name: key } }, validator));
    if (inserted.kind !== "completed" || inserted.outcome.kind !== "inserted") throw new Error("Expected legacy insert");
    if (kind === "netZero") await runEffect(store.runPointOperationEffect(table, { kind: "delete",
      syscallSequence: CommitSyscallSequenceV1Schema.make(2n), documentId: inserted.outcome.documentId }, validator));
  }
  const seal = await prepareSessionJournalSeal(store, attempt);
  const journal = await runEffect(canonicalizeSessionJournalEffect(seal.journal));
  const result = await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true }));
  await completeSessionJournalSeal(store, seal.preparation, journal, result);
  const authority = relationAuthorityFromAnchor(activation.anchor, fixture.schemaVersionId, activation.executionClaim);
  const loader = createStoredAttemptEvidenceLoaderV1(fixture.ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") throw new Error("Missing legacy evidence");
  await runEffect(createPointCommitFinishingTransitionPortV1(fixture.ports).enterFinishing(
    await pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)));
  const finishing = await runEffect(loader.loadFinishingEffect(selectorFromRelationAnchor(activation.anchor)));
  if (finishing.kind !== "loaded") throw new Error("Missing finishing evidence");
  const base = await pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(authority, finishing.evidence);
  expect(base.authorityPins.executionAuthorityGeneration).toBe("legacy_dynamic_worker_v1");
  expect(base.rowIntents.length).toBe(kind === "material" ? 1 : 0);
  return { ...base, journalBytes: journal.canonicalBytes, successfulResult: {
    valueCodecVersion: result.evidence.valueCodecVersion, value: result.valueJson, canonicalBytes: result.canonicalBytes,
    semanticSizeBytes: result.semanticSizeBytes, sha256Hex: result.evidence.sha256Hex } };
}

export async function legacyWriterExclusionScenario(fixture: LegacyWriterFixture, activate?: () => Promise<unknown>) {
  const publisher = createPointCommitPublisherPortV1(fixture.ports);
  const previous = activate ? await prepareLegacyWriter(fixture, "material", "prior") : null;
  if (previous) expect(await runEffect(publisher.publish(previous))).toMatchObject({ kind: "published" });
  const material = await prepareLegacyWriter(fixture, "material");
  const netZero = await prepareLegacyWriter(fixture, "netZero");
  const readOnly = await prepareLegacyWriter(fixture, "readOnly");
  if (activate) await activate();
  const inventory = async () => ({ rows: await fixture.target.drizzle.select().from(fxAppRowCurrent),
    revisions: await fixture.target.drizzle.select().from(fxAppRowRevisions), indexes: await fixture.target.drizzle.select().from(fxAppIndexEntryCurrent),
    indexRevisions: await fixture.target.drizzle.select().from(fxAppIndexEntryRevisions), commits: await fixture.target.drizzle.select().from(fxSystemCommits),
    outcomes: await fixture.target.drizzle.select().from(fxSystemIdempotency), clocks: await fixture.target.drizzle.select().from(fxSystemScopeClocks) });
  const before = await inventory();
  for (const command of [material, netZero]) {
    expect(await runEffectFailure(publisher.publish(command))).toMatchObject({ reason: "applicationWritePolicyDenied" });
    expect(await runEffectFailure(publisher.prove(command))).toMatchObject({ reason: "applicationWritePolicyDenied" });
    expect(await inventory()).toEqual(before);
  }
  await expect(fixture.target.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    yield* lockScopeClockForUpdateInTransactionEffect(tx, decodeReplacementScopeIdV1(fixture.scopeId));
    yield* validateApplicationWriteOwnershipForCommit(tx, { scopeId: decodeReplacementScopeIdV1(fixture.scopeId),
      generation: "legacy_dynamic_worker_v1", authenticatedAttemptedTables: null, materialTables: [] });
  })))).rejects.toMatchObject({ reason: "writeDenied" });
  if (previous) expect(await runEffect(publisher.publish(previous))).toMatchObject({ kind: "replayed" });
  expect(await inventory()).toEqual(before);
  expect(await runEffect(publisher.publish(readOnly))).toMatchObject({ kind: "published" });
}
