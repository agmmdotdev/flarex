import { Effect, Schema, Tracer } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogSchemaVersionSchema, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ReplacementScopeIdV1Schema, SnapshotTokenSchema, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { getAppRowAtSnapshotInTransactionEffect } from "../../src/storage/documents/appRows";
import { applyAppSchemaCandidateWriteGuardInTransactionEffect, captureAppSchemaCandidateWriteGuardLockedHead,
  installAppSchemaCandidateValidationEffect, prepareAppSchemaCandidateWriteGuardEffect } from "../../src/storage/catalog/appSchemaCandidateValidation";
import { acceptApplicationPublication, readAcceptedApplicationPublication } from "../../src/storage/materialization/publicationAcceptance";
import { materializeAcceptedApplicationPublicationRows, lockPointCommitIntrinsicIndexBuilds } from "../../src/storage/materialization/materialization";
import { prepareApplicationDocumentSettlementEffect } from "../../src/storage/materialization/settlementPlan";
import type { ApplicationDocumentMaterializationCommand } from "../../src/storage/materialization/model";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import { closeInstallationAdmission, lockInstallationForCurrentTransaction } from "../../src/installation/installationLifecycle";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../src/scope/scopeClock";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../src/scope/scopeAuthorityResolution";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxSystemAppSchemaCandidateValidations, fxSystemScopeClocks } from "../../src/database/schema";
import { runEffect } from "../support/effectTestRuntime";
import { publicationCoveragePhaseTrace } from "../performance/publicationCoveragePhaseTrace";
import type { ApplicationNativeMutationPGliteFixture, ApplicationNativeMutationPostgresFixture } from "../application/applicationNativeMutationTestFixture";

/** The original analysis/readiness/activation fixture supplies the active head.
 * This test deliberately rolls back the complete native provisional publication. */
export async function prepareActivatedCoverageProof(fixture: ApplicationNativeMutationPGliteFixture | ApplicationNativeMutationPostgresFixture):
  Promise<(entry?: Readonly<{ transact: (work: (tx: FlarexMetadataTransaction) => Promise<void>) => Promise<void> }>) => Promise<void>> {
  const scopeId = Schema.decodeUnknownSync(Schema.toType(ReplacementScopeIdV1Schema))(fixture.authority.scopeId);
  const table = fixture.schemaAuthority.tables.find(table => table.logicalName === "users");
  if (table === undefined) throw new Error("Activated fixture has no users table");
  const intrinsic = await runEffect(fixture.intrinsicCreationTimeIndexes.locate({ deploymentId: fixture.deploymentId,
    scopeId: fixture.authority.scopeId, tableId: table.tableId }));
  if (intrinsic === null) throw new Error("Activated fixture has no intrinsic definition");
  const candidateId = decodeCatalogSchemaVersionId("publication_activated_empty_candidate");
  await fixture.control.publishAppSchemaV1({ deploymentId: fixture.deploymentId, schemaVersionId: candidateId,
    version: CatalogSchemaVersionSchema.make(2), tables: [], indexes: [] });
  await runEffect(installAppSchemaCandidateValidationEffect(fixture.candidateValidation, {
    deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, schemaVersionId: candidateId }));
  const guard = await runEffect(prepareAppSchemaCandidateWriteGuardEffect(fixture.candidateSchemaWriteGuard,
    { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId }));
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(fixture.deploymentId, fixture.authorityPorts));
  const rowId = decodeAppRowIdHexV1("00000000000000000000000000000019");
  const creationTime = decodeAppCreationTimeV1(19);
  const document = await canonicalizeAppDocumentV1({ tableId: table.tableId, rowId, creationTime, fields: { name: "coverage" } });
  return async entry => {
    const database = fixture.target.drizzle;
    const inventory = async () => ({ rows: await database.select().from(fxAppRowRevisions),
      current: await database.select().from(fxAppRowCurrent), indexes: await database.select().from(fxAppIndexEntryRevisions),
      indexCurrent: await database.select().from(fxAppIndexEntryCurrent),
      candidates: await database.select().from(fxSystemAppSchemaCandidateValidations), clocks: await database.select().from(fxSystemScopeClocks) });
    const before = await inventory();
    const trace = publicationCoveragePhaseTrace();
    const rollback = new Error("Roll back activated publication coverage proof");
    const transact = entry?.transact ?? (work => database.transaction(work));
    await expect(transact(async tx => {
      if (entry === undefined) await runEffect(lockInstallationForCurrentTransaction(tx));
      try {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId));
        const snapshotToken = SnapshotTokenSchema.make({ scopeId, epoch: clock.epoch, commitSeq: clock.lastCommitSeq });
        const read = await runEffect(getAppRowAtSnapshotInTransactionEffect(tx, { tableId: table.tableId, rowId, snapshotToken }));
        const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
        const dependency: ApplicationDocumentMaterializationCommand["dependencies"][number]["dependency"] = {
          kind: "appRowPoint", documentId, observed: read.dependency.kind === "present"
            ? { kind: "present", revisionCommitSeq: read.dependency.revisionCommitSeq }
            : { kind: "missing", basis: read.dependency.basis } };
        const command: ApplicationDocumentMaterializationCommand = { authorityPins: {
          deploymentId: TransactionGrantDeploymentIdV1Schema.make(fixture.deploymentId), scopeId,
          schemaVersionId: fixture.schemaAuthority.schemaVersionId, snapshotToken },
          rowIntents: [{ kind: "live", documentId, tableId: table.tableId, rowId, dependency, creationTime, document }],
          dependencies: [{ documentId, tableId: table.tableId, rowId, dependency }] };
        const context = { record: clock, scopeUuid: projectScopeIdUuidV1(scopeId).scopeUuid };
        await lockPointCommitIntrinsicIndexBuilds(tx, context, [intrinsic], command);
        const settlement = await runEffect(prepareApplicationDocumentSettlementEffect(command, [], [], [], null, [intrinsic]));
        const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
        await runEffect(Effect.gen(function* () {
          const accepted = yield* acceptApplicationPublication(tx, { settlement, clock: context,
            intrinsic: [intrinsic], developer: [], unique: [], relations: null, indexRanges: [], relationDependencies: [],
            candidate: true, deadline: null, oldestAvailableCommitSeq: clock.oldestAvailableCommitSeq });
          const state = yield* Effect.fromResult(readAcceptedApplicationPublication(tx, accepted));
          const lockedHead = yield* Effect.fromResult(captureAppSchemaCandidateWriteGuardLockedHead(tx,
            fixture.candidateSchemaWriteGuard, located.authority, state.candidateHead));
          const candidate = yield* applyAppSchemaCandidateWriteGuardInTransactionEffect(tx, fixture.candidateSchemaWriteGuard,
            guard, located.authority, clock, commitSeq, [{ tableId: table.tableId, rowId, document }], lockedHead);
          expect(candidate.status).toBe("candidateFailed");
          trace.candidateFailed();
          yield* materializeAcceptedApplicationPublicationRows(tx, { accepted, commitSeq, publicationProfile: "activeApplication", options: {} });
          if (entry === undefined) trace.assertFullProof(1);
          else trace.assertProtectedSnapshot();
        }).pipe(Effect.provideService(Tracer.Tracer, trace.tracer)));
        expect(await tx.select().from(fxAppRowCurrent)).toHaveLength(before.current.length + 1);
        throw rollback;
      } finally { if (entry === undefined) closeInstallationAdmission(tx); }
    })).rejects.toBe(rollback);
    expect(await inventory()).toEqual(before);
  };
}
