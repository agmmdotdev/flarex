import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect } from "vitest";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { canonicalizeSuccessfulResultV1Effect, CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type { StoredTransactionSessionScalarsV1 } from "flarex-protocol/transaction-session";

import { snapshotApplicationExecutionAuthorityJson } from "../../../src/application/applicationExecutionAuthoritySnapshot";
import { prepareFiniteApplicationMutationAdmission, readPreparedFiniteApplicationMutationInputs } from "../../../src/application/applicationMutationAdmission";
import { deriveApplicationSyscallValidator } from "../../../src/application/revision/applicationRevisionSyscallValidatorV1";
import { createPointCommitPublisherPortV1 } from "../../../src/commit/point/construction";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppRowCurrent, fxAppRowRevisions,
  fxSystemCommitAppRowChanges, fxSystemCommits, fxSystemCommitWakes, fxSystemIdempotency, fxSystemScopeClocks } from "../../../src/database/schema";
import { readFrozenFiniteAttempt } from "../../../src/execution/journal/frozenAttempt";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { createApplicationMutationSessionActivationPersistenceV1 } from "../../../src/execution/session/activation";
import type { FiniteEntryAttemptKernelContext } from "../../../src/execution/session/kernelContracts";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import { requireScopeAuthorizationRevocationEpochInTransactionEffect, selectScopeClockRows } from "../../../src/scope/scopeClock";
import { prepareFiniteAppSchemaCandidateWriteGuardPortEffect } from "../../../src/storage/catalog/appSchemaCandidateValidation";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import { applicationMutationActivationEvidenceFixture } from "../../application/applicationMutationActivationFixture";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence,
  ApplicationNativeMutationFixtureOptions } from "../../application/applicationNativeMutationTestFixture";
import { pointCommitAuthorityPinsFromStoredSessionV1, pointCommitSessionFromStoredSessionV1 } from "../../commit/point/support/commandEvidence";
import { relationAuthorityFromAnchor } from "../../commit/point/support/relations";
import { preparedHostTestRuntime } from "../preparation/preparedHostRuntimeTestSupport";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../session/support/activationEvidence";

const ALPHA_ROW = decodeAppRowIdHexV1("a1000000000000000000000000000001");
const BETA_ROW = decodeAppRowIdHexV1("b1000000000000000000000000000002");
export const FINITE_INDEXED_QUERY_OPTIONS = {
  runtimeHostIdentity: "flarex.test/finite-indexed-queries", compatibilityDate: "2026-06-14",
  includeTask: false, includeUserNameIndex: true,
  initialUserDocuments: [{ name: "Alpha", rowId: ALPHA_ROW }, { name: "Beta", rowId: BETA_ROW }],
} satisfies ApplicationNativeMutationFixtureOptions;

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;

export const makeFiniteIndexedQueriesHarness = Effect.fn("FiniteIndexedQueries.harness")(
  function* (native: Fixture) {
    const context = Object.freeze({ deploymentId: native.deploymentId, controlDb: native.control.drizzle,
      authority: native.authorityPorts, schema: native.schema });
    const retained = yield* Effect.acquireRelease(retainPreparedHost(preparedHostTestRuntime(native.target.drizzle),
      Effect.gen(function* () {
        const preparation = yield* prepareFiniteApplicationMutationAdmission(native.activation, "users:create", context);
        const candidateSchemaWriteGuard = yield* prepareFiniteAppSchemaCandidateWriteGuardPortEffect({
          candidateValidation: native.candidateValidation, pointCommitAuthority: native.sessionAuthority,
        }, { deploymentId: native.deploymentId, scopeId: native.authority.scopeId, profile: "fullArtifactProof" });
        return Object.freeze({ preparation, candidateSchemaWriteGuard });
      })), owner => owner.close);
    const prepared = yield* retained.use(host => Effect.fromResult(readPreparedFiniteApplicationMutationInputs(host.preparation, context)));
    const users = prepared.schema.tables.find(table => table.logicalName === "users");
    if (users === undefined) throw new Error("Missing actual finite users table");
    const alphaId = appDocumentIdV1FromRowIdentity({ tableId: users.tableId, rowId: ALPHA_ROW });
    const betaId = appDocumentIdV1FromRowIdentity({ tableId: users.tableId, rowId: BETA_ROW });
    const store = createSessionJournalStorePersistence(native.sessionAuthority, {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1, randomUuid: randomUUID, indexedQueries: native.indexedQueries,
    });
    const candidateSchemaWriteGuard = yield* retained.use(host => Effect.succeed(host.candidateSchemaWriteGuard));
    const publisher = createPointCommitPublisherPortV1(native.sessionAuthority, {
      ...native.servingOwners.materialization,
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(native.control.drizzle),
      uniqueConstraintEligibility: native.uniqueConstraintEligibility, candidateSchemaWriteGuard,
    });
    const open = Effect.fn("FiniteIndexedQueries.open")(function* () {
      const entry = yield* store.prepareFiniteEntryEffect([]);
      const authorizationRevocationEpoch = yield* runEffectTransaction<
        Effect.Success<ReturnType<typeof requireScopeAuthorizationRevocationEpochInTransactionEffect>>,
        Effect.Error<ReturnType<typeof requireScopeAuthorizationRevocationEpochInTransactionEffect>>,
        unknown, FlarexMetadataTransaction>(
        run => native.target.drizzle.transaction(run), "Finite indexed fixture grant preparation rolled back",
        tx => requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, native.authority.scopeId), cause => cause);
      const evidence = yield* Effect.tryPromise(() => applicationMutationActivationEvidenceFixture({
        deploymentId: TransactionGrantDeploymentIdV1Schema.make(native.deploymentId), executionAuthority: prepared.executionAuthority,
        authorizationRevocationEpoch, requestKey: randomUUID(), grantId: randomUUID(),
      }));
      const activated = yield* retained.use(host => createApplicationMutationSessionActivationPersistenceV1(native.sessionAuthority,
        { leaseDurationMilliseconds: 240_000, randomUuid: randomUUID }).activateFiniteEffect({
        deploymentId: TransactionGrantDeploymentIdV1Schema.make(native.deploymentId), scopeId: evidence.scopeId,
        preparedAdmission: host.preparation, admissionContext: context, evidence: evidence.evidence,
      }, entry));
      if (activated.activation.status !== "created" || activated.entry === undefined) throw new Error("Missing genuine finite entry");
      const confirmed = yield* Effect.fromResult(store.confirmedFiniteEntryAttempt(activated.entry, entry));
      expect(confirmed.context.session.executionProfile).toBe("finiteRoot");
      const validator = yield* deriveApplicationSyscallValidator({ scopeId: native.authority.scopeId,
        schemaVersionId: confirmed.context.executionPin.schemaVersionId, schemaManifest: confirmed.schemaManifest });
      const table = yield* store.resolvePointTableEffect(confirmed.attempt, "users");
      const index = yield* store.resolveDeveloperIndexEffect(table, "by_name");
      return { attempt: confirmed.attempt, table, index, validator, context: confirmed.context, activation: activated.activation, schemaManifest: confirmed.schemaManifest };
    });
    const freeze = Effect.fn("FiniteIndexedQueries.freeze")(function* (entry: Effect.Success<ReturnType<typeof open>>) {
      const result = yield* canonicalizeSuccessfulResultV1Effect(null);
      const frozenAttempt = yield* store.freezeFiniteRootEffect(entry.attempt, result);
      const view = readFrozenFiniteAttempt(frozenAttempt);
      if (view === undefined) throw new Error("Missing authentic frozen finite projection");
      const session = projectConfirmedSession(entry.context.session);
      const authority = relationAuthorityFromAnchor(entry.activation.anchor, entry.context.executionPin.schemaVersionId,
        entry.activation.executionClaim);
      return { view, command: { authorityPins: pointCommitAuthorityPinsFromStoredSessionV1(authority, session),
        session: pointCommitSessionFromStoredSessionV1(session, "running"), executionClaim: entry.activation.executionClaim, frozenAttempt } };
    });

    return Object.freeze({ store, open, freeze, publisher, alphaId, betaId, tableId: users.tableId });
  },
);

/** The actual finite entry, journal, frozen-root and publisher owners all run
 * here. No durable-journal sealing or fabricated finite capability is involved. */
export const finiteIndexedQueriesScenario = Effect.fn("FiniteIndexedQueries.scenario")(
  function* (native: Fixture) {
    return yield* Effect.scoped(Effect.gen(function* () {
      const { store, open, freeze, publisher, alphaId, betaId } = yield* makeFiniteIndexedQueriesHarness(native);
      const original = yield* open();
      const page = yield* store.runIndexedQueryEffect(original.index, { kind: "indexRange",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 1 });
      expect(page).toMatchObject({ kind: "completed", delivery: "executed",
        outcome: { documents: [{ name: "Alpha" }], isDone: false } });
      expect(yield* store.runPointOperationEffect(original.table, { kind: "patch",
        syscallSequence: CommitSyscallSequenceV1Schema.make(2n), documentId: alphaId,
        patch: { name: "Alpha stale mutation" } }, original.validator)).toMatchObject({ kind: "completed" });
      const stale = yield* freeze(original);
      expect(stale.view.applicationIndexRanges).toMatchObject([{ upper: { kind: "position", rowId: BETA_ROW, inclusive: true } }]);
      expect(stale.view.dependencies.filter(dependency => dependency.kind === "appRowPoint")
        .map(dependency => dependency.documentId)).toEqual([alphaId]);
      expect(stale.view.originalRows.map(row => row.rowId)).toEqual([ALPHA_ROW]);
      const indexOperation = stale.view.operations.find(operation => operation.kind === "index");
      expect(indexOperation).toMatchObject({ kind: "index", outcome: { kind: "indexRangePage", isDone: false } });

      const competing = yield* open();
      expect(yield* store.runPointOperationEffect(competing.table, { kind: "delete",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n), documentId: betaId }, competing.validator)).toMatchObject({ kind: "completed" });
      const deleted = yield* freeze(competing);
      expect(yield* publisher.publishFinite(deleted.command)).toMatchObject({ kind: "published" });
      const beforeConflict = yield* Effect.tryPromise(() => inventory(native));
      const conflict = yield* Effect.flip(publisher.publishFinite(stale.command));
      expect(conflict).toMatchObject({ _tag: "PointCommitConflictV1Error", conflict: { kind: "appIndexRange", reason: "overlap" } });
      expect(yield* Effect.tryPromise(() => inventory(native))).toEqual(beforeConflict);

      const fresh = yield* open();
      expect(yield* store.runIndexedQueryEffect(fresh.index, { kind: "indexRange",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 1 })).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Alpha" }], isDone: true } });
      const exhausted = yield* freeze(fresh);
      expect(exhausted.view.applicationIndexRanges).toMatchObject([{ lower: null, upper: null }]);
      expect(exhausted.view.dependencies.filter(dependency => dependency.kind === "appRowPoint")
        .map(dependency => dependency.documentId)).toEqual([alphaId]);
    }));
  },
);

/** Same scalar-only projection used by the existing finite permission fixture.
 * Inputs are the confirmed entry's actual row; the publisher authenticates them. */
function projectConfirmedSession(row: FiniteEntryAttemptKernelContext["session"]): StoredTransactionSessionScalarsV1 {
  if (row.lifecycle !== "running" || row.executionAuthorityGeneration !== "application_v1" ||
    row.validatedArgsCanonicalBytes === null || row.authorizationGrantCanonicalBytes === null ||
    row.applicationExecutionAuthorityJson === null || row.applicationExecutionAuthorityCanonicalBytes === null ||
    row.applicationExecutionAuthoritySha256 === null) throw new Error("Missing confirmed Application session data");
  return {
    lifecycle: row.lifecycle, executionAuthorityGeneration: "application_v1",
    applicationExecutionAuthorityJson: snapshotApplicationExecutionAuthorityJson(row.applicationExecutionAuthorityJson),
    applicationExecutionAuthorityCanonicalBytes: row.applicationExecutionAuthorityCanonicalBytes,
    applicationExecutionAuthoritySha256: row.applicationExecutionAuthoritySha256,
    storageGeneration: row.storageGeneration, storageGenerationFence: row.storageGenerationFence,
    functionPath: row.functionPath, functionKind: row.functionKind, schemaVersionId: row.schemaVersionId,
    policyVersion: row.policyVersion, identityAccessPolicySha256: row.identityAccessPolicySha256,
    validatedArgsValueCodecVersion: row.validatedArgsValueCodecVersion,
    validatedArgsCanonicalByteLength: row.validatedArgsCanonicalBytes.byteLength, validatedArgsSha256: row.validatedArgsSha256,
    authorizationGrantId: row.authorizationGrantId, authorizationGrantValueCodecVersion: row.authorizationGrantValueCodecVersion,
    authorizationGrantCanonicalByteLength: row.authorizationGrantCanonicalBytes.byteLength, authorizationGrantSha256: row.authorizationGrantSha256,
    authorizationRevocationEpoch: row.authorizationRevocationEpoch, authorizationGrantExpiresAtMilliseconds: row.authorizationGrantExpiresAt.getTime(),
    requestKey: row.requestKey, requestSha256: row.requestSha256, protocolVersion: row.protocolVersion,
    hardExpiresAtMilliseconds: row.hardExpiresAt.getTime(), createdAtMilliseconds: row.createdAt.getTime(), updatedAtMilliseconds: row.updatedAt.getTime(),
  };
}

export async function inventory(native: Fixture) {
  const database = native.target.drizzle;
  const { scopeUuid } = projectScopeIdUuidV1(native.authority.scopeId);
  return {
    rows: await database.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid)).orderBy(fxAppRowCurrent.rowId),
    revisions: await database.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)).orderBy(fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    indexes: await database.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid)).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
    indexRevisions: await database.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid)).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    commits: await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)).orderBy(fxSystemCommits.commitSeq),
    outcomes: await database.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid)).orderBy(fxSystemIdempotency.commitSeq),
    facts: await database.select().from(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid)).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.rowId),
    wakes: await database.select().from(fxSystemCommitWakes).where(eq(fxSystemCommitWakes.scopeUuid, scopeUuid)).orderBy(fxSystemCommitWakes.commitSeq),
    clock: await selectScopeClockRows(database).where(eq(fxSystemScopeClocks.scopeId, native.authority.scopeId)),
  };
}
