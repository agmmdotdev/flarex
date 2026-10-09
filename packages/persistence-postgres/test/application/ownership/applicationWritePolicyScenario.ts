import { assertIndexMaintenanceIntegrity } from "../../storage/indexes/indexMaintenanceIntegrity";
import { expect } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { orderedIndexCompositionRefusals } from "../../storage/indexes/orderedIndexCompositionRefusals";
import { createAppDeveloperIndexDefinitionPortV1 } from "../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxSystemCommits, fxSystemIdempotency, fxSystemScopeClocks, fxSystemIndexBuildStates } from "../../../src/database/schema";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalEffect, canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { relationReadinessFixture, enableApplicationPhysicalBuilds, prepareReadinessEvidence, prepareAdditionalRelationRevision, uuidSequence } from "../relations/applicationRelationReadinessFixture";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { runEffect, runEffectFailure, prepareSessionJournalSeal, completeSessionJournalSeal } from "../../support/effectTestRuntime";
import { makeApplicationActivationRepository } from "../../../src/application/applicationActivation";
import { readApplicationBindingProjectionInTransaction } from "../../../src/application/applicationBindingProjection";
import { isApplicationBindingReference } from "../../../src/installation/frameworkSchema/binding/canonical";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../src/scope/scopeClock";
import { readApplicationWriteOwnershipInTransaction } from "../../../src/application/ownership/Repository";
import { ApplicationWriteOwnershipHistoryBudget } from "../../../src/application/ownership/Policy";
import { validateApplicationWriteOwnershipForCommit } from "../../../src/application/ownership/Commit";
import { fxSystemApplicationWriteOwnership } from "../../../src/application/ownership/Schema";
import { fxSystemApplicationActiveHeads, fxSystemApplicationActivations, fxSystemApplicationReadBindings } from "../../../src/application/applicationActivationSchema";
import { createPointMutationSessionActivationPersistenceV1 } from "../../../src/execution/transactionSessionActivation";
import { activatePointMutationSession, pointMutationSessionActivationFixture, TEST_GRANT_RETENTION_POLICY_V1 } from "../../execution/transactionSessionActivationTestSupport";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import { selectorFromRelationAnchor, relationAuthorityFromAnchor } from "../../commit/pointCommitRelationTestSupport";
import { relationBuildRowId } from "../relations/applicationRelationBuildTestSupport";
import { issueSetupSeededSyscallValidatorProofV1 } from "../revision/applicationRevisionSyscallValidatorTestSupport";
import { fxSystemTransactionJournals, fxSystemTransactionSessions } from "../../../src/database/schema";
import { selectApplicationMutationAdmission } from "../../../src/application/applicationMutationAdmission";
import { makeApplicationSchemaAuthorityPublisher } from "../../../src/application/applicationSchemaAuthority";
import { createStoredAttemptEvidenceLoaderV1 } from "../../../src/execution/storedAttemptEvidence";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1, pointCommitFinishingCommandFromStoredAttemptV1 } from "../../commit/pointCommitTransactionTestSupport";
import { createPointCommitFinishingTransitionPortV1, createPointCommitPublisherPortV1 } from "../../../src/commit/pointCommitTransaction";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { hashPolicyFixture } from "./applicationWritePolicyFixture";
import { encodeCanonicalJson, isJson, isJsonObject } from "flarex-protocol/json";
import { canonicalizeApplicationWriteOwnership } from "../../../src/application/ownership/Codec";

/** One resource owner and the same capability scenario on both database drivers. */
export async function applicationWritePolicyScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  hooks: Readonly<{ activate?: (fixture: Awaited<ReturnType<typeof relationReadinessFixture>>, activate: () => Promise<unknown>) => Promise<void>;
    publish?: (fixture: Awaited<ReturnType<typeof relationReadinessFixture>>, publish: () => Promise<unknown>) => Promise<unknown> }> = {}) {
  const fixture = await relationReadinessFixture({ persistence, writePolicy: true });
  // A real legacy attempt may already contain writes when policy activates.
  // Its insert/delete pair has no material rows, but both attempted writes
  // remain authenticated by the journal seal.
  const staleUuid = uuidSequence(601, 602, 603);
  const stale = await activatePointMutationSession(createPointMutationSessionActivationPersistenceV1(fixture.pointCommitAuthority,
    { leaseDurationMilliseconds: 60_000, randomUuid: staleUuid, randomExecutionClaimOwner: staleUuid }),
  pointMutationSessionActivationFixture(fixture.deploymentId, decodeReplacementScopeIdV1(fixture.authority.scopeId), {
    evidence: { schemaVersionId: fixture.relation.binding.schemaVersionId,
      requestKey: TransactionRequestKeyV1Schema.make("policy-stale-net-zero"),
      functionPath: TransactionFunctionPathV1Schema.make("functions:write") },
  }));
  if (stale.status !== "created") throw new Error("Expected fresh stale-writer session");
  const staleStore = createSessionJournalStorePersistence(fixture.pointCommitAuthority, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
  const staleAttempt = await runEffect(staleStore.openAttemptEffect({ selector: selectorFromRelationAnchor(stale.anchor),
    executionClaim: stale.executionClaim, snapshotToken: stale.anchor.snapshotToken, schemaVersionId: fixture.relation.binding.schemaVersionId }));
  const stalePosts = await runEffect(staleStore.resolvePointTableEffect(staleAttempt, "posts"));
  const schema = await runEffect(fixture.foldContext.schema.resolve({ deploymentId: fixture.deploymentId,
    applicationManifestSha256: fixture.publicationInput.manifestSha256, manifest: fixture.manifest }));
  const staleValidator = issueSetupSeededSyscallValidatorProofV1({ scopeId: fixture.authority.scopeId,
    schemaVersionId: fixture.relation.binding.schemaVersionId, schemaManifest: schema.manifest });
  const staleInserted = await runEffect(staleStore.runPointOperationEffect(stalePosts, { kind: "insert",
    syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { title: "net zero" } }, staleValidator));
  if (staleInserted.kind !== "completed" || staleInserted.outcome.kind !== "inserted") throw new Error("Expected stale insert");
  await runEffect(staleStore.runPointOperationEffect(stalePosts, { kind: "delete", documentId: staleInserted.outcome.documentId,
    syscallSequence: CommitSyscallSequenceV1Schema.make(2n) }, staleValidator));
  const stalePrepared = await prepareSessionJournalSeal(staleStore, staleAttempt);
  const staleJournal = await runEffect(canonicalizeSessionJournalEffect(stalePrepared.journal));
  const staleResult = await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true }));
  await completeSessionJournalSeal(staleStore, stalePrepared.preparation, staleJournal, staleResult);
  await prepareReadinessEvidence(fixture);
  const ready = await runEffect(fixture.fold.settle(fixture.input));
  expect(ready.status).toBe("ready");
  const input = { revisionId: fixture.input.revisionId, expectedActiveHead: null };
  const faulty = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, readiness: fixture.legacyReadiness,
    relationReadiness: fixture.fold, authority: fixture.authorityPorts,
    faultAfter: point => { if (point === "headWritten") throw new Error("policy activation rollback"); } });
  const beforeActivationBuilds = await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId);
  await expect(runEffect(faulty.activate(input))).rejects.toBeDefined();
  expect(await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId)).toEqual(beforeActivationBuilds);
  expect(await persistence.drizzle.select().from(fxSystemApplicationWriteOwnership)).toHaveLength(0);
  expect(await persistence.drizzle.select().from(fxSystemApplicationActiveHeads)).toHaveLength(0);
  expect(await persistence.drizzle.select().from(fxSystemApplicationActivations)).toHaveLength(0);
  const partial = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, readiness: fixture.legacyReadiness,
    relationReadiness: fixture.fold, authority: fixture.authorityPorts,
    faultAfter: point => { if (point === "indexMaintenanceWritten") throw new Error("index maintenance rollback"); } });
  await expect(runEffect(partial.activate(input))).rejects.toBeDefined();
  expect(await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId)).toEqual(beforeActivationBuilds);
  expect(await persistence.drizzle.select().from(fxSystemApplicationActiveHeads)).toHaveLength(0);
  const activate = async () => {
    const result = await runEffect(fixture.relationActivation.activate(input));
    expect(result).toMatchObject({ status: "activated", activationSequence: 1n });
    return result;
  };
  if (hooks.activate) await hooks.activate(fixture, activate); else await activate();
  expect(await runEffect(fixture.relationActivation.activate(input))).toMatchObject({ disposition: "replayed" });
  const active = await runEffect(fixture.relationActivation.readActive());
  const project = () => persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
    return yield* readApplicationBindingProjectionInTransaction(active.selection, tx, clock);
  })));
  // Reusing the same issued evidence must never consume a lifetime-wide budget.
  for (let iteration = 0; iteration < 24; iteration++) expect(isApplicationBindingReference(await project())).toBe(true);
  expect((await project()).readiness).toMatchObject({ kind: "policy", relationCount: 0 });
  const ownership = await persistence.drizzle.transaction(tx => runEffect(readApplicationWriteOwnershipInTransaction(tx,
    fixture.authority.scopeId, new ApplicationWriteOwnershipHistoryBudget())));
  expect(ownership.ownership?.frame.claims).toHaveLength(1);
  const managed = fixture.relation.binding.tables.find(table => table.logicalName === "posts");
  const ordinary = fixture.relation.binding.tables.find(table => table.logicalName === "audit");
  if (!managed || !ordinary) throw new Error("Expected managed and ordinary tables");
  const guard = (generation: "application_v1" | "legacy_dynamic_worker_v1", attempted: ReadonlyArray<typeof managed.tableId> | null,
    material: ReadonlyArray<typeof managed.tableId> = []) => persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
      return yield* validateApplicationWriteOwnershipForCommit(tx, { scopeId: fixture.authority.scopeId, generation,
        authenticatedAttemptedTables: attempted, materialTables: material });
    })));
  await guard("application_v1", [ordinary.tableId]);
  await expect(guard("application_v1", [managed.tableId])).rejects.toMatchObject({ reason: "writeDenied" });
  await expect(guard("application_v1", [], [managed.tableId])).rejects.toMatchObject({ reason: "writeDenied" });
  await expect(guard("application_v1", null)).rejects.toMatchObject({ reason: "writeDenied" });
  await expect(guard("legacy_dynamic_worker_v1", [])).rejects.toMatchObject({ reason: "writeDenied" });

  const randomUuid = uuidSequence(501, 502, 503);
  const session = await activatePointMutationSession(createPointMutationSessionActivationPersistenceV1(fixture.pointCommitAuthority,
    { leaseDurationMilliseconds: 60_000, randomUuid, randomExecutionClaimOwner: randomUuid }),
  pointMutationSessionActivationFixture(fixture.deploymentId, decodeReplacementScopeIdV1(fixture.authority.scopeId), {
    evidence: { schemaVersionId: fixture.relation.binding.schemaVersionId,
      functionPath: TransactionFunctionPathV1Schema.make("functions:write") },
  }));
  if (session.status !== "created") throw new Error("Expected fresh session");
  const admission = await runEffect(selectApplicationMutationAdmission(active.selection, "functions:write", {
    deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle, authority: fixture.authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({ db: fixture.control.drizzle, runTransaction: run => fixture.control.drizzle.transaction(run) }),
    relationSchema: fixture.foldContext.schema,
  }));
  // Fixture-only session installation uses the real admitted, canonical authority.
  await persistence.drizzle.update(fxSystemTransactionSessions).set({ executionAuthorityGeneration: "application_v1",
    packageId: null, artifactRuntime: null, artifactId: null, sourcePackageHash: null, executionModule: null,
    applicationExecutionAuthorityJson: admission.executionAuthority.authority,
    applicationExecutionAuthorityCanonicalBytes: admission.executionAuthority.canonicalBytes,
    applicationExecutionAuthoritySha256: admission.executionAuthority.sha256,
  }).where(eq(fxSystemTransactionSessions.sessionId, session.anchor.sessionId));
  const store = createSessionJournalStorePersistence(fixture.pointCommitAuthority, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
  const attempt = await runEffect(store.openAttemptEffect({ selector: selectorFromRelationAnchor(session.anchor),
    executionClaim: session.executionClaim, snapshotToken: session.anchor.snapshotToken, schemaVersionId: fixture.relation.binding.schemaVersionId }));
  const posts = await runEffect(store.resolvePointTableEffect(attempt, "posts"));
  const audit = await runEffect(store.resolvePointTableEffect(attempt, "audit"));
  const validator = issueSetupSeededSyscallValidatorProofV1({ scopeId: fixture.authority.scopeId,
    schemaVersionId: fixture.relation.binding.schemaVersionId, schemaManifest: admission.schema.manifest });
  const documentId = appDocumentIdV1FromRowIdentity({ tableId: managed.tableId, rowId: relationBuildRowId(41) });
  const sequence = CommitSyscallSequenceV1Schema.make(1n);
  const before = await persistence.drizzle.select().from(fxSystemTransactionJournals);
  for (const operation of [
    { kind: "insert", fields: { title: "denied" } }, { kind: "patch", documentId, patch: { title: "denied" } },
    { kind: "replace", documentId, fields: { title: "denied" } }, { kind: "delete", documentId },
  ] as const) {
    expect(await runEffectFailure(store.runPointOperationEffect(posts, { ...operation, syscallSequence: sequence }, validator)))
      .toMatchObject({ _tag: "ApplicationTableWriteDeniedError", operation: operation.kind });
  }
  expect(await persistence.drizzle.select().from(fxSystemTransactionJournals)).toEqual(before);
  const inserted = await runEffect(store.runPointOperationEffect(audit, { kind: "insert", syscallSequence: sequence, fields: { title: "after denial" } }, validator));
  expect(inserted).toMatchObject({ kind: "completed", outcome: { kind: "inserted" } });
  expect(await runEffect(store.runPointOperationEffect(posts, { kind: "get", documentId,
    syscallSequence: CommitSyscallSequenceV1Schema.make(2n) }, validator))).toMatchObject({ kind: "completed" });
  const prepared = await prepareSessionJournalSeal(store, attempt);
  const journal = await runEffect(canonicalizeSessionJournalEffect(prepared.journal));
  const result = await runEffect(canonicalizeSuccessfulResultV1Effect({ ok: true }));
  await completeSessionJournalSeal(store, prepared.preparation, journal, result);
  const authority = relationAuthorityFromAnchor(session.anchor, fixture.relation.binding.schemaVersionId, session.executionClaim);
  const loader = createStoredAttemptEvidenceLoaderV1(fixture.pointCommitAuthority);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") throw new Error("Expected authenticated running evidence");
  const unique = createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle);
  const intrinsicCreationTimeIndexes = createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle);
  const developerIndexes = createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle);
  const otherOptions = { uniqueConstraints: unique, uniqueConstraintEligibility: createAppUniqueConstraintSetEligibilityPortV1({ controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts }, unique), applicationRelations: fixture.relationCommit };
  const options = { ...otherOptions, intrinsicCreationTimeIndexes, developerIndexes };
  const finishing = createPointCommitFinishingTransitionPortV1(fixture.pointCommitAuthority, options);
  await runEffect(finishing.enterFinishing(await pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)));
  const finished = await runEffect(loader.loadFinishingEffect(selectorFromRelationAnchor(session.anchor)));
  if (finished.kind !== "loaded") throw new Error("Expected finishing evidence");
  const base = await pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(authority, finished.evidence);
  const successfulResult = { valueCodecVersion: result.evidence.valueCodecVersion, value: { ok: true }, canonicalBytes: result.canonicalBytes,
    semanticSizeBytes: result.semanticSizeBytes, sha256Hex: result.evidence.sha256Hex };
  const command = { ...base, journalBytes: journal.canonicalBytes, successfulResult };
  const publisher = createPointCommitPublisherPortV1(fixture.pointCommitAuthority, options);
  expect(command.authorityPins.executionAuthorityGeneration).toBe("application_v1");
  expect(command.rowIntents.length).toBeGreaterThan(0);
  const publicationState = async () => ({
    rows: await persistence.drizzle.select().from(fxAppRowCurrent),
    revisions: await persistence.drizzle.select().from(fxAppRowRevisions),
    indexes: await persistence.drizzle.select().from(fxAppIndexEntryCurrent),
    indexRevisions: await persistence.drizzle.select().from(fxAppIndexEntryRevisions),
    commits: await persistence.drizzle.select().from(fxSystemCommits),
    outcomes: await persistence.drizzle.select().from(fxSystemIdempotency),
    clocks: await persistence.drizzle.select().from(fxSystemScopeClocks),
  });
  const beforeCompositionRefusal = await publicationState();
  const activeBuilds = await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId);
  expect(activeBuilds.length).toBeGreaterThan(0);
  expect(activeBuilds.every(build => build.maintenanceActivationSequence === 1n)).toBe(true);
  const intrinsic = await runEffect(intrinsicCreationTimeIndexes.locate({ deploymentId: fixture.deploymentId,
    scopeId: fixture.authority.scopeId, tableId: ordinary.tableId }));
  if (intrinsic === null) throw new Error("Expected required audit creation-time definition");
  const savedBuild = activeBuilds.find(build => build.indexDefinitionId === intrinsic.indexDefinitionId);
  if (savedBuild === undefined) throw new Error("Missing active intrinsic build");
  await expect(persistence.drizzle.delete(fxSystemIndexBuildStates).where(and(
    eq(fxSystemIndexBuildStates.scopeId, fixture.authority.scopeId),
    eq(fxSystemIndexBuildStates.indexDefinitionId, intrinsic.indexDefinitionId),
  ))).rejects.toBeDefined();
  expect(await publicationState()).toEqual(beforeCompositionRefusal);
  // Existing enabled rows without certification cannot fall back to per-write progress.
  await persistence.drizzle.update(fxSystemIndexBuildStates).set({ maintenanceActivationSequence: null, })
    .where(eq(fxSystemIndexBuildStates.indexDefinitionId, intrinsic.indexDefinitionId));
  try {
    expect(await runEffectFailure(publisher.publish(command))).toMatchObject({ reason: "definitionSetUnavailable" });
    expect(await publicationState()).toEqual(beforeCompositionRefusal);
  } finally {
    const saved = savedBuild;
    await persistence.drizzle.update(fxSystemIndexBuildStates).set(saved).where(eq(fxSystemIndexBuildStates.indexDefinitionId, intrinsic.indexDefinitionId));
  }
  const foreign = await createMigratedPGlitePersistence();
  const invalidPublishers = orderedIndexCompositionRefusals(intrinsicCreationTimeIndexes, developerIndexes, foreign.drizzle)
    .map(invalid => createPointCommitPublisherPortV1(fixture.pointCommitAuthority, { ...otherOptions, ...invalid }));
  const { applicationControlDb: _applicationControlDb, ...missingControlAuthority } = fixture.pointCommitAuthority;
  invalidPublishers.push(createPointCommitPublisherPortV1(missingControlAuthority, options));
  for (const invalid of invalidPublishers) {
    expect(await runEffectFailure(invalid.publish(command))).toMatchObject({ reason: "orderedIndexCompositionInvalid" });
    expect(await runEffectFailure(invalid.prove({ ...base, journalBytes: journal.canonicalBytes })))
      .toMatchObject({ reason: "orderedIndexCompositionInvalid" });
    expect(await publicationState()).toEqual(beforeCompositionRefusal);
  }
  const staleAuthority = relationAuthorityFromAnchor(stale.anchor, fixture.relation.binding.schemaVersionId, stale.executionClaim);
  const staleRunning = await runEffect(loader.loadEffect(staleAuthority));
  if (staleRunning.kind !== "loaded") throw new Error("Expected stale running evidence");
  await runEffect(finishing.enterFinishing(await pointCommitFinishingCommandFromStoredAttemptV1(staleAuthority, staleRunning.evidence)));
  const staleFinished = await runEffect(loader.loadFinishingEffect(selectorFromRelationAnchor(stale.anchor)));
  if (staleFinished.kind !== "loaded") throw new Error("Expected stale finishing evidence");
  const staleBase = await pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(staleAuthority, staleFinished.evidence);
  expect(staleBase.rowIntents).toHaveLength(0);
  const staleCommand = { ...staleBase, journalBytes: staleJournal.canonicalBytes, successfulResult };
  expect(await runEffectFailure(publisher.publish(staleCommand))).toMatchObject({ reason: "applicationWritePolicyDenied" });
  // Install only a real admitted Application authority. The same authenticated
  // net-zero journal must still be denied before material row coalescing wins.
  await persistence.drizzle.update(fxSystemTransactionSessions).set({ executionAuthorityGeneration: "application_v1",
    packageId: null, artifactRuntime: null, artifactId: null, sourcePackageHash: null, executionModule: null,
    applicationExecutionAuthorityJson: admission.executionAuthority.authority,
    applicationExecutionAuthorityCanonicalBytes: admission.executionAuthority.canonicalBytes,
    applicationExecutionAuthoritySha256: admission.executionAuthority.sha256,
  }).where(eq(fxSystemTransactionSessions.sessionId, stale.anchor.sessionId));
  const applicationFinished = await runEffect(loader.loadFinishingEffect(selectorFromRelationAnchor(stale.anchor)));
  if (applicationFinished.kind !== "loaded") throw new Error("Expected Application finishing evidence");
  const applicationBase = await pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(staleAuthority, applicationFinished.evidence);
  expect(applicationBase.authorityPins.executionAuthorityGeneration).toBe("application_v1");
  expect(applicationBase.rowIntents).toHaveLength(0);
  expect(await runEffectFailure(publisher.publish({ ...applicationBase, journalBytes: staleJournal.canonicalBytes, successfulResult })))
    .toMatchObject({ reason: "applicationWritePolicyDenied" });
  await expect(runEffect(publisher.publish({ ...command, journalBytes: new Uint8Array([0]) }))).rejects.toBeDefined();
  const { journalBytes: _journalBytes, ...withoutJournal } = base;
  await expect(runEffect(publisher.publish({ ...withoutJournal, successfulResult }))).rejects.toMatchObject({ reason: "applicationWritePolicyDenied" });
  const publish = () => runEffect(publisher.publish(command));
  const published = hooks.publish ? await hooks.publish(fixture, publish) : await publish();
  expect(published).toMatchObject({ kind: "published" });
  expect(await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId)).toEqual(activeBuilds);
  await assertIndexMaintenanceIntegrity(persistence.drizzle, intrinsic);
  const beforeBuilderReplay = await publicationState();
  await enableApplicationPhysicalBuilds(fixture.control.drizzle, fixture.authorityPorts, fixture.authority.scopeId, fixture.deploymentId, fixture.relation.binding.schemaVersionId);
  expect(await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId)).toEqual(activeBuilds);
  expect(await publicationState()).toEqual(beforeBuilderReplay);
  expect(await runEffect(publisher.publish(command))).toMatchObject({ kind: "replayed" });
  for (const invalid of invalidPublishers) {
    expect(await runEffect(invalid.publish(command))).toMatchObject({ kind: "replayed" });
  }
  // Corrupt retained ownership refuses independently of a valid earlier admission.
  await persistence.drizzle.transaction(async tx => {
    const rows = await tx.select().from(fxSystemApplicationWriteOwnership).where(eq(fxSystemApplicationWriteOwnership.scopeId, fixture.authority.scopeId));
    const row = rows[0];
    if (!row) throw new Error("Missing ownership test row");
    await tx.update(fxSystemApplicationWriteOwnership).set({ claimsBytes: new TextEncoder().encode("{}") })
      .where(and(eq(fxSystemApplicationWriteOwnership.scopeId, row.scopeId), eq(fxSystemApplicationWriteOwnership.activationSequence, row.activationSequence)));
    expect(await runEffectFailure(validateApplicationWriteOwnershipForCommit(tx, { scopeId: fixture.authority.scopeId,
      generation: "application_v1", authenticatedAttemptedTables: [ordinary.tableId], materialTables: [] })))
      .toMatchObject({ reason: "invalidEvidence" });
    await tx.update(fxSystemApplicationWriteOwnership).set({ claimsBytes: row.claimsBytes })
      .where(eq(fxSystemApplicationWriteOwnership.scopeId, row.scopeId));
  });
  // Rehashing derived projections cannot erase claims: the read binding pins
  // the activation digest and the failed rewrite rolls back the whole attempt.
  const erasureInventory = async () => ({
    heads: await persistence.drizzle.select().from(fxSystemApplicationActiveHeads)
      .where(eq(fxSystemApplicationActiveHeads.scopeId, fixture.authority.scopeId)),
    activations: await persistence.drizzle.select().from(fxSystemApplicationActivations)
      .where(eq(fxSystemApplicationActivations.scopeId, fixture.authority.scopeId))
      .orderBy(fxSystemApplicationActivations.activationSequence),
    claims: await persistence.drizzle.select().from(fxSystemApplicationWriteOwnership)
      .where(eq(fxSystemApplicationWriteOwnership.scopeId, fixture.authority.scopeId))
      .orderBy(fxSystemApplicationWriteOwnership.activationSequence),
    readBindings: await persistence.drizzle.select().from(fxSystemApplicationReadBindings)
      .where(eq(fxSystemApplicationReadBindings.scopeId, fixture.authority.scopeId))
      .orderBy(fxSystemApplicationReadBindings.activationSequence),
  });
  const beforeErasure = await erasureInventory();
  await expect(persistence.drizzle.transaction(async tx => {
    const [activation] = await tx.select().from(fxSystemApplicationActivations).where(eq(fxSystemApplicationActivations.scopeId, fixture.authority.scopeId));
    const [head] = await tx.select().from(fxSystemApplicationActiveHeads).where(eq(fxSystemApplicationActiveHeads.scopeId, fixture.authority.scopeId));
    const [claim] = await tx.select().from(fxSystemApplicationWriteOwnership).where(eq(fxSystemApplicationWriteOwnership.scopeId, fixture.authority.scopeId));
    if (!activation || !head || !claim || !ownership.ownership) throw new Error("Missing tamper fixture");
    const erased = await runEffect(canonicalizeApplicationWriteOwnership({ ...ownership.ownership.frame, claims: [] }));
    const activationFrame: unknown = JSON.parse(new TextDecoder().decode(activation.activationBytes));
    const headFrame: unknown = JSON.parse(new TextDecoder().decode(head.headBytes));
    if (!isJson(activationFrame) || !isJsonObject(activationFrame) || !isJson(headFrame) || !isJsonObject(headFrame)) throw new Error("Expected frames");
    const changedActivation = { ...activationFrame, writeOwnershipSha256: erased.sha256Hex };
    const changedActivationSha256 = Buffer.from(hashPolicyFixture(changedActivation), "hex");
    const changedHead = { ...headFrame, writeOwnershipSha256: erased.sha256Hex, activationSha256: changedActivationSha256.toString("hex") };
    const bytes = (frame: typeof changedHead | typeof changedActivation) => new TextEncoder().encode(encodeCanonicalJson(frame, () => { throw new Error("Invalid fixture frame"); }));
    await tx.delete(fxSystemApplicationActiveHeads).where(eq(fxSystemApplicationActiveHeads.scopeId, head.scopeId));
    await tx.update(fxSystemApplicationWriteOwnership).set({ claimsBytes: erased.canonicalBytes, claimsSha256: erased.sha256 }).where(eq(fxSystemApplicationWriteOwnership.scopeId, claim.scopeId));
    await tx.update(fxSystemApplicationActivations).set({ writeOwnershipSha256: erased.sha256,
      activationBytes: bytes(changedActivation), activationSha256: changedActivationSha256 }).where(eq(fxSystemApplicationActivations.scopeId, activation.scopeId));
    await tx.insert(fxSystemApplicationActiveHeads).values({ ...head, writeOwnershipSha256: erased.sha256,
      activationSha256: changedActivationSha256, headBytes: bytes(changedHead), headSha256: Buffer.from(hashPolicyFixture(changedHead), "hex") });
  })).rejects.toMatchObject({ cause: { code: "23503", constraint: "fx_application_read_binding_activation_fk" } });
  expect(await erasureInventory()).toEqual(beforeErasure);
  // Grow through the real publication/readiness/activation owners to the exact
  // restore limit: one head plus 21 activation/claim/readiness triples = 64.
  let head = (await runEffect(fixture.relationActivation.readActive())).basis;
  let secondActivation: Parameters<typeof fixture.relationActivation.activate>[0] | undefined;
  for (let ordinal = 1; ordinal <= 20; ordinal++) {
    const revision = await prepareAdditionalRelationRevision(fixture, ordinal);
    if (ordinal === 1) secondActivation = { revisionId: revision.publication.revisionId,
      expectedActiveHead: { activationSequence: head.activationSequence, headSha256: Buffer.from(head.headSha256).toString("hex") } };
    expect((await runEffect(fixture.relationActivation.readActive())).basis).toEqual(head);
    await runEffect(fixture.relationActivation.activate({ revisionId: revision.publication.revisionId,
      expectedActiveHead: { activationSequence: head.activationSequence, headSha256: Buffer.from(head.headSha256).toString("hex") } }));
    head = (await runEffect(fixture.relationActivation.readActive())).basis;
    expect(head.activationSequence).toBe(BigInt(ordinal + 1));
    const bindings = await persistence.drizzle.select().from(fxSystemIndexBuildStates);
    expect(bindings.every(build => build.maintenanceActivationSequence === head.activationSequence)).toBe(true);
    if (ordinal === 1) {
      // Pre-cutover active rows have a real sealed prefix but no fabricated certificate.
      // The following fresh activation must certify them through the normal owner.
      await persistence.drizzle.update(fxSystemIndexBuildStates).set({ maintenanceActivationSequence: null, });
    }
  }
  const beforeReplayBuilds = await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId);
  expect(await runEffect(fixture.relationActivation.activate(input))).toMatchObject({ disposition: "replayed", activationSequence: 1n });
  if (!secondActivation?.expectedActiveHead) throw new Error("Missing historical second activation");
  expect(await runEffectFailure(fixture.relationActivation.activate({ ...secondActivation,
    expectedActiveHead: { ...secondActivation.expectedActiveHead, headSha256: "0".repeat(64) } }))).toMatchObject({ reason: "expectedHead" });
  const firstActivationIdentity = and(eq(fxSystemApplicationActivations.scopeId, fixture.authority.scopeId), eq(fxSystemApplicationActivations.activationSequence, 1n));
  const originalActivation = (await persistence.drizzle.select().from(fxSystemApplicationActivations).where(firstActivationIdentity))[0];
  if (!originalActivation) throw new Error("Missing historical activation");
  await persistence.drizzle.update(fxSystemApplicationActivations).set({ activationBytes: new TextEncoder().encode("{}") }).where(firstActivationIdentity);
  try { expect(await runEffectFailure(fixture.relationActivation.activate(input))).toMatchObject({ reason: "storedState" }); }
  finally { await persistence.drizzle.update(fxSystemApplicationActivations).set(originalActivation).where(firstActivationIdentity); }
  expect(await persistence.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId)).toEqual(beforeReplayBuilds);
  expect((await runEffect(fixture.relationActivation.readActive())).basis).toEqual(head);

  const lastHead = await persistence.drizzle.select().from(fxSystemApplicationActiveHeads);
  const next = await prepareAdditionalRelationRevision(fixture, 21);
  await expect(runEffect(fixture.relationActivation.activate({ revisionId: next.publication.revisionId,
    expectedActiveHead: { activationSequence: head.activationSequence, headSha256: Buffer.from(head.headSha256).toString("hex") } }))).rejects.toBeDefined();
  expect(await persistence.drizzle.select().from(fxSystemApplicationActiveHeads)).toEqual(lastHead);
  expect(await persistence.drizzle.select().from(fxSystemApplicationWriteOwnership)).toHaveLength(21);
  expect((await runEffect(fixture.relationActivation.readActive())).basis.activationSequence).toBe(21n);
  expect(await runEffect(fixture.relationActivation.activate(input))).toMatchObject({ disposition: "replayed", activationSequence: 1n });
  await guard("application_v1", [ordinary.tableId]);
  // A retained legacy catalog is authoritative even without an Application
  // publication row. Merely creating a new policy manifest cannot take it over.
  const reused = await relationReadinessFixture({ persistence, writePolicy: true });
  const legacySchema = makeApplicationSchemaAuthorityPublisher({ db: reused.control.drizzle,
    runTransaction: run => reused.control.drizzle.transaction(run) });
  await runEffect(legacySchema.publish({ deploymentId: reused.deploymentId, manifest: {
    ...reused.manifest, version: 1, schema: { version: 1, tables: reused.manifest.schema.tables, indexes: reused.manifest.schema.indexes },
  } }));
  await prepareReadinessEvidence(reused);
  await expect(runEffect(reused.fold.settle(reused.input))).rejects.toBeDefined();
  expect(await persistence.drizzle.select().from(fxSystemApplicationWriteOwnership)
    .where(eq(fxSystemApplicationWriteOwnership.scopeId, reused.authority.scopeId))).toHaveLength(0);
  expect(await persistence.drizzle.select().from(fxSystemApplicationActiveHeads)
    .where(eq(fxSystemApplicationActiveHeads.scopeId, reused.authority.scopeId))).toHaveLength(0);
  return fixture;
}
